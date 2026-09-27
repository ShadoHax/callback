import type { NormalizedBox } from "./object-overlay";

/** Keeps the AR cue readable through small optical-flow jitter and brief lost frames. */
export class ArBoxStabilizer {
  private box: NormalizedBox | null = null;
  private lastSeen = 0;

  get current() { return this.box && { ...this.box }; }

  observe(next: NormalizedBox, now: number, kind: "tracking" | "detection" = "tracking") {
    if (!this.box) { this.box = { ...next }; this.lastSeen = now; return this.current!; }
    const previous = this.box;
    const oldCenter = { x: previous.x + previous.width / 2, y: previous.y + previous.height / 2 };
    const newCenter = { x: next.x + next.width / 2, y: next.y + next.height / 2 };
    const distance = Math.hypot(newCenter.x - oldCenter.x, newCenter.y - oldCenter.y);
    const alpha = distance > .22 ? .72 : kind === "detection" ? .38 : .27;
    this.box = {
      x: previous.x + (next.x - previous.x) * alpha,
      y: previous.y + (next.y - previous.y) * alpha,
      width: previous.width + (next.width - previous.width) * alpha,
      height: previous.height + (next.height - previous.height) * alpha,
    };
    this.lastSeen = now;
    return this.current!;
  }

  missing(now: number, graceMs = 850) {
    if (this.box && now - this.lastSeen <= graceMs) return this.current;
    this.clear();
    return null;
  }

  clear() { this.box = null; this.lastSeen = 0; }
}
