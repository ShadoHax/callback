// Small grayscale frames gate costly scans. This detects a steady view, not objects or identity.
export type HoverFrame = { pixels: Uint8Array; mean: number; contrast: number };
export type HoverStatus = "moving" | "hold" | "steady" | "seen" | "cooldown" | "busy" | "limit" | "too_dark" | "no_detail";
export type HoverObservation = { status: HoverStatus; capture: boolean; sceneChanged: boolean; remaining: number; viewId?: number; revisited?: boolean };

const STABLE_MS = 400;
const MIN_STABLE_SAMPLES = 3;
const COOLDOWN_MS = 3000;
export const HOVER_SESSION_LIMIT = 12;
const MOTION_DELTA = 6;
const STABILITY_DRIFT_DELTA = 10;
const SAME_VIEW_DELTA = 14;
const SCENE_CHANGE_DELTA = 18;
const MAX_REMEMBERED_VIEWS = 24;

export function grayscaleFrame(data: ImageData): HoverFrame {
  const pixels = new Uint8Array(data.width * data.height);
  let sum = 0;
  for (let index = 0; index < pixels.length; index++) {
    const offset = index * 4;
    const value = Math.round(data.data[offset] * 0.299 + data.data[offset + 1] * 0.587 + data.data[offset + 2] * 0.114);
    pixels[index] = value;
    sum += value;
  }
  const mean = sum / pixels.length;
  let variance = 0;
  for (const pixel of pixels) variance += (pixel - mean) ** 2;
  return { pixels, mean, contrast: Math.sqrt(variance / pixels.length) };
}

export function frameDistance(a: HoverFrame, b: HoverFrame): number {
  if (a.pixels.length !== b.pixels.length) return Infinity;
  let difference = 0;
  for (let index = 0; index < a.pixels.length; index++) difference += Math.abs(a.pixels[index] - b.pixels[index]);
  return difference / a.pixels.length;
}

export class HoverCaptureController {
  private previous: HoverFrame | null = null;
  private stableAnchor: HoverFrame | null = null;
  private captured: { id: number; frame: HoverFrame }[] = [];
  private activeView: { id: number; frame: HoverFrame } | null = null;
  private nextViewId = 1;
  private previousActive: { id: number; frame: HoverFrame } | null = null;
  private stableSince = 0;
  private stableSamples = 0;
  private lastObservedAt: number | null = null;
  private changedSamples = 0;
  private sceneNotified = false;
  private awayFromActive = false;
  private lastCaptureAt = -Infinity;
  private count = 0;
  private inFlight = false;

  get remaining() { return Math.max(0, HOVER_SESSION_LIMIT - this.count); }
  get waitingForCapture() { return this.inFlight; }

  resetStability() {
    this.previous = null;
    this.stableAnchor = null;
    this.stableSamples = 0;
    this.lastObservedAt = null;
    this.changedSamples = 0;
  }

  // An explicit Resume grants another bounded batch; previous scene fingerprints stay remembered.
  resumeBudget() { this.count = 0; this.resetStability(); }
  // A memory revision invalidates old lookups while preserving the cost budget.
  resetViews() {
    this.captured = [];
    this.activeView = null;
    this.previousActive = null;
    this.sceneNotified = false;
    this.awayFromActive = false;
    this.resetStability();
  }
  completeCapture() { this.inFlight = false; }
  discardCapture(refund = false) {
    if (!this.inFlight) return;
    this.inFlight = false;
    if (refund) this.count = Math.max(0, this.count - 1);
    this.captured.pop();
    this.activeView = this.previousActive;
    this.previousActive = null;
    this.sceneNotified = false;
  }
  failCapture() { this.discardCapture(true); }

  observe(frame: HoverFrame, now: number, eligible: boolean): HoverObservation {
    const answer = (status: HoverStatus, capture = false, sceneChanged = false, viewId?: number, revisited = false): HoverObservation =>
      ({ status, capture, sceneChanged, remaining: this.remaining, viewId, revisited });
    if (frame.mean < 35) { this.resetStability(); return answer("too_dark"); }
    if (frame.contrast < 12) { this.resetStability(); return answer("no_detail"); }
    if (this.lastObservedAt !== null && now - this.lastObservedAt > 350) this.resetStability();
    this.lastObservedAt = now;

    let sceneChanged = false;
    if (this.activeView && !this.sceneNotified) {
      this.changedSamples = frameDistance(frame, this.activeView.frame) >= SCENE_CHANGE_DELTA ? this.changedSamples + 1 : 0;
      if (this.changedSamples >= 2) { this.sceneNotified = true; this.awayFromActive = true; sceneChanged = true; }
    }

    const moving = this.previous !== null && (
      frameDistance(frame, this.previous) > MOTION_DELTA ||
      (this.stableAnchor !== null && frameDistance(frame, this.stableAnchor) > STABILITY_DRIFT_DELTA)
    );
    if (moving || !this.previous) {
      this.stableSince = now;
      this.stableSamples = 1;
      this.stableAnchor = frame;
    } else this.stableSamples++;
    this.previous = frame;
    if (moving) return answer("moving", false, sceneChanged);
    if (this.stableSamples < MIN_STABLE_SAMPLES || now - this.stableSince < STABLE_MS) return answer("hold", false, sceneChanged);
    if (!eligible || this.inFlight) return answer("busy", false, sceneChanged);
    const known = this.captured.find((old) => frameDistance(frame, old.frame) <= SAME_VIEW_DELTA);
    if (known) {
      const revisited = this.awayFromActive || this.activeView?.id !== known.id;
      if (revisited) {
        this.activeView = known;
        this.awayFromActive = false;
        this.sceneNotified = false;
        this.changedSamples = 0;
      }
      return answer("seen", false, sceneChanged, known.id, revisited);
    }
    if (this.remaining === 0) return answer("limit", false, sceneChanged);
    if (now - this.lastCaptureAt < COOLDOWN_MS) return answer("cooldown", false, sceneChanged);

    this.inFlight = true;
    this.count++;
    this.lastCaptureAt = now;
    const view = { id: this.nextViewId++, frame };
    this.previousActive = this.activeView;
    this.captured.push(view);
    if (this.captured.length > MAX_REMEMBERED_VIEWS) this.captured.shift();
    this.activeView = view;
    this.sceneNotified = false;
    this.awayFromActive = false;
    this.changedSamples = 0;
    return answer("steady", true, sceneChanged, view.id);
  }
}
