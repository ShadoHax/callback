import { frameDistance, type HoverFrame } from "./hover-capture";

/** A late recognition box belongs to the captured view only while the visible frame is still close. */
export function capturedViewIsCurrent(captured: HoverFrame, current: HoverFrame) {
  return frameDistance(captured, current) <= 36;
}

/** Camera motion gates recognition; the local detector never gates which objects Muse can see. */
export class LiveARCapture {
  private anchor: HoverFrame | null = null;
  private previous: HoverFrame | null = null;
  private accepted: HoverFrame | null = null;
  private stableAt = 0;
  private changedSamples = 0;
  private changedAt: number | null = null;
  private notified = false;
  private busy = false;
  private samples = 0;
  private lastCaptureAt = -Infinity;
  private lastUnmatched: HoverFrame | null = null;
  private unmatchedAttempts = 0;
  complete() { this.busy = false; }
  retry() { this.accepted = null; this.notified = false; this.changedAt = null; this.changedSamples = 0; this.lastCaptureAt = -Infinity; this.lastUnmatched = null; this.unmatchedAttempts = 0; }
  /** A model miss allows one delayed retry of an unchanged view, then waits for a new view. */
  unmatched() {
    if (!this.accepted) return;
    this.unmatchedAttempts = this.lastUnmatched && frameDistance(this.accepted, this.lastUnmatched) < 12 ? this.unmatchedAttempts + 1 : 1;
    this.lastUnmatched = this.accepted;
    if (this.unmatchedAttempts < 2) this.accepted = null;
    this.notified = false; this.changedAt = null; this.changedSamples = 0;
  }
  observe(frame: HoverFrame, now: number, eligible = true) {
    let sceneChanged = false;
    if (frame.mean < 25 || frame.contrast < 9) {
      this.anchor = null; this.previous = null;
      if (this.accepted && !this.notified) {
        this.changedAt ??= now; this.changedSamples++;
        if (this.changedSamples >= 7 && now - this.changedAt >= 900) { this.notified = true; sceneChanged = true; }
      }
      return { capture: false, sceneChanged };
    }
    if (this.accepted && !this.notified) {
      if (frameDistance(frame, this.accepted) > 30) {
        this.changedAt ??= now;
        this.changedSamples++;
        // A short pan or blur should not detach the current memory. A sustained
        // different scene must clear it before another object can be recognized.
        if (this.changedSamples >= 7 && now - this.changedAt >= 900) { this.notified = true; sceneChanged = true; }
      } else { this.changedAt = null; this.changedSamples = 0; }
    }
    const drift = frameDistance(frame, this.previous ?? frame);
    this.previous = frame;
    if (!this.anchor || drift > 24) { this.anchor = frame; this.stableAt = now; this.samples = 1; return { capture: false, sceneChanged }; }
    this.samples++;
    if (!eligible || this.busy || (this.changedAt !== null && !this.notified)
      || now - this.stableAt < 420 || this.samples < 3 || now - this.lastCaptureAt < 1800)
      return { capture: false, sceneChanged };
    if (this.accepted && frameDistance(frame, this.accepted) < 12 && !this.notified) return { capture: false, sceneChanged };
    this.accepted = frame; this.busy = true; this.notified = false; this.changedSamples = 0; this.changedAt = null; this.lastCaptureAt = now;
    return { capture: true, sceneChanged };
  }
}
