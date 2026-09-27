import { describe, expect, it } from "vitest";
import { capturedViewIsCurrent, LiveARCapture } from "../src/lib/live-ar-capture";
import type { HoverFrame } from "../src/lib/hover-capture";
const frame = (offset = 0): HoverFrame => ({ pixels: new Uint8Array([40+offset, 100+offset, 60+offset, 150+offset]), mean: 90+offset, contrast: 40 });
function hold(gate: LiveARCapture, image: HoverFrame, start: number, eligible = true) {
  const observations = [0,160,320,640].map(dt => gate.observe(image, start+dt, eligible));
  return observations.find(result => result.capture) ?? observations.at(-1)!;
}
describe("live video recognition gate", () => {
  it("rejects a late box for a substantially changed visible frame", () => {
    expect(capturedViewIsCurrent(frame(), frame(18))).toBe(true);
    expect(capturedViewIsCurrent(frame(), frame(45))).toBe(false);
  });
  it("emits a steady frame without any local detection or allowed object class", () => {
    const gate = new LiveARCapture();
    expect(hold(gate, frame(), 0).capture).toBe(true);
  });
  it("does not repeat the same view or overlap model requests", () => {
    const gate = new LiveARCapture();
    expect(hold(gate, frame(), 0).capture).toBe(true);
    expect(hold(gate, frame(35), 4000).capture).toBe(false);
    gate.complete();
    expect(hold(gate, frame(35), 5000).capture).toBe(true);
    gate.complete();
    expect(hold(gate, frame(35), 10000).capture).toBe(false);
  });
  it("invalidates a changed view even when the physical class stays bottle", () => {
    const gate = new LiveARCapture(); hold(gate, frame(), 0); gate.complete();
    expect(gate.observe(frame(35), 3100).sceneChanged).toBe(false);
    expect(gate.observe(frame(35), 3260).sceneChanged).toBe(false);
    expect(gate.observe(frame(35), 3420).capture).toBe(false);
    expect(gate.observe(frame(35), 3580).sceneChanged).toBe(false);
    expect(gate.observe(frame(35), 3740).sceneChanged).toBe(false);
    expect(gate.observe(frame(35), 3900).sceneChanged).toBe(false);
    const changed = gate.observe(frame(35), 4060);
    expect(changed.sceneChanged).toBe(true);
    expect(changed.capture).toBe(true);
  });
  it("keeps a reminder during a brief pan and ignores a dark transition", () => {
    const gate = new LiveARCapture(); hold(gate, frame(), 0); gate.complete();
    expect(gate.observe(frame(35), 3000).sceneChanged).toBe(false);
    expect(gate.observe(frame(35), 3160).sceneChanged).toBe(false);
    expect(gate.observe(frame(), 3320).sceneChanged).toBe(false);
    expect(gate.observe({ ...frame(35), mean: 5 }, 3480).sceneChanged).toBe(false);
    expect(gate.observe(frame(), 3640).sceneChanged).toBe(false);
  });
  it("waits during motion and darkness, and respects an open details drawer", () => {
    const gate = new LiveARCapture();
    for (let time=0; time<3000; time+=160) expect(gate.observe(frame(time % 320 ? 30 : 0), time).capture).toBe(false);
    expect(hold(gate, {...frame(),mean:5}, 4000).capture).toBe(false);
    expect(hold(gate, frame(), 5000, false).capture).toBe(false);
    expect(gate.observe(frame(), 5800, true).capture).toBe(true);
  });
  it("allows the same object again after explicit retry", () => {
    const gate = new LiveARCapture(); hold(gate, frame(), 0); gate.complete(); gate.retry();
    expect(hold(gate, frame(), 4000).capture).toBe(true);
  });
  it("retries an uncertain result once without looping a paused final frame", () => {
    const gate = new LiveARCapture();
    expect(hold(gate, frame(), 0).capture).toBe(true);
    gate.unmatched(); gate.complete();
    expect(hold(gate, frame(), 1000).capture).toBe(false);
    expect(hold(gate, frame(), 2400).capture).toBe(true);
    gate.unmatched(); gate.complete();
    expect(hold(gate, frame(), 5000).capture).toBe(false);
    expect(hold(gate, frame(20), 7000).capture).toBe(true);
  });
});

it("clears an old memory after sustained darkness without sending a dark frame", () => {
  const gate = new LiveARCapture(); hold(gate, frame(), 0); gate.complete();
  const dark = { ...frame(), mean: 5, contrast: 0 };
  for (let i = 0; i < 6; i++) expect(gate.observe(dark, 2000 + i * 160)).toEqual({ capture: false, sceneChanged: false });
  expect(gate.observe(dark, 2960)).toEqual({ capture: false, sceneChanged: true });
});
