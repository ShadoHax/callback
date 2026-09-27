import { describe, expect, it } from "vitest";
import { ArBoxStabilizer } from "../src/lib/ar-box-stabilizer";

const box = (x: number) => ({ x, y: .25, width: .25, height: .3 });

describe("AR box stabilizer", () => {
  it("damps small tracker jitter and keeps a cue for a brief missed frame", () => {
    const filter = new ArBoxStabilizer();
    filter.observe(box(.2), 100);
    expect(filter.observe(box(.24), 150).x).toBeCloseTo(.2108);
    expect(filter.missing(800)?.x).toBeCloseTo(.2108);
    expect(filter.missing(1100)).toBeNull();
  });

  it("responds quickly to actual movement and resets across objects", () => {
    const filter = new ArBoxStabilizer();
    filter.observe(box(.1), 100);
    expect(filter.observe(box(.5), 200).x).toBeGreaterThan(.35);
    filter.clear();
    expect(filter.observe(box(.75), 300)).toEqual(box(.75));
  });
});
