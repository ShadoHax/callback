import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetDetection } from "../src/lib/target-detector";

const mocks = vi.hoisted(() => ({
  setBackend: vi.fn(), ready: vi.fn(), load: vi.fn(), detect: vi.fn(),
}));

vi.mock("@tensorflow/tfjs-core", () => ({ setBackend: mocks.setBackend, ready: mocks.ready }));
vi.mock("@tensorflow/tfjs-backend-webgl", () => ({}));
vi.mock("@tensorflow/tfjs-backend-cpu", () => ({}));
vi.mock("@tensorflow-models/coco-ssd", () => ({ load: mocks.load }));

const frame = { width: 1000, height: 500 } as HTMLCanvasElement;
const cup = { class: "cup", score: 0.98, bbox: [100, 50, 200, 150] };

function expectBox(result: TargetDetection, expected: { x: number; y: number; width: number; height: number }) {
  expect(result.status).toBe("found");
  if (result.status !== "found") return;
  expect(result.box.x).toBeCloseTo(expected.x);
  expect(result.box.y).toBeCloseTo(expected.y);
  expect(result.box.width).toBeCloseTo(expected.width);
  expect(result.box.height).toBeCloseTo(expected.height);
}

beforeEach(() => {
  vi.resetModules();
  mocks.setBackend.mockReset().mockResolvedValue(true);
  mocks.ready.mockReset().mockResolvedValue(undefined);
  mocks.detect.mockReset();
  mocks.load.mockReset().mockResolvedValue({ detect: mocks.detect });
});

describe("on-device target selection", () => {
  it("selects the prominent banana or coffee with one inference and returns its scenario label", async () => {
    mocks.detect.mockResolvedValue([
      { class: "banana", score: 0.93, bbox: [10, 20, 70, 60] },
      { class: "cup", score: 0.79, bbox: [400, 50, 280, 250] },
      { class: "dining table", score: 0.99, bbox: [0, 0, 1000, 500] },
    ]);
    const { detectTargets } = await import("../src/lib/target-detector");
    const result = await detectTargets(frame, ["banana", "coffee"]);
    expect(result).toMatchObject({ status: "found", label: "coffee", score: 0.79 });
    expectBox(result, { x: 0.4, y: 0.1, width: 0.28, height: 0.5 });
    expect(mocks.detect).toHaveBeenCalledTimes(1);
  });

  it("bounds the confirmation crop to the exact detected frame", async () => {
    const { targetCropRect } = await import("../src/lib/target-detector");
    expect(targetCropRect({ x: 0.1, y: 0.2, width: 0.2, height: 0.4 }, 1000, 500))
      .toEqual({ x: 70, y: 70, width: 260, height: 260 });
    expect(targetCropRect({ x: 0, y: 0, width: 0.2, height: 0.2 }, 1000, 500))
      .toEqual({ x: 0, y: 0, width: 230, height: 115 });
  });

  it.each(["coffee", "coffee cup", "coffee mug", " CUP "])("maps %s to the cup class and returns an image-normalized box", async (target) => {
    mocks.detect.mockResolvedValue([cup]);
    const { detectTarget, targetClass } = await import("../src/lib/target-detector");
    expect(targetClass(target)).toBe("cup");
    const result = await detectTarget(frame, target);
    expect(result).toMatchObject({ status: "found", label: "cup", score: 0.98 });
    expectBox(result, { x: 0.1, y: 0.1, width: 0.2, height: 0.3 });
    expect(mocks.detect).toHaveBeenCalledWith(frame, 20, 0.4);
    expect(mocks.load).toHaveBeenCalledWith({ base: "lite_mobilenet_v2" });
  });

  it("ignores a higher-scoring different object when locating the requested target", async () => {
    mocks.detect.mockResolvedValue([
      { class: "dining table", score: 0.99, bbox: [0, 0, 1000, 500] },
      { class: "cup", score: 0.72, bbox: [700, 100, 100, 100] },
    ]);
    const { detectTarget } = await import("../src/lib/target-detector");
    const result = await detectTarget(frame, "coffee");
    expect(result).toMatchObject({ status: "found", label: "cup", score: 0.72 });
    expectBox(result, { x: 0.7, y: 0.2, width: 0.1, height: 0.2 });
  });

  it("returns absent for a requested class missing from the photo", async () => {
    mocks.detect.mockResolvedValue([cup]);
    const { detectTarget } = await import("../src/lib/target-detector");
    expect(await detectTarget(frame, "laptop")).toMatchObject({ status: "absent", message: expect.stringContaining("No laptop detected") });
  });

  it("returns ambiguous when multiple instances of the requested class remain", async () => {
    mocks.detect.mockResolvedValue([cup, { ...cup, score: 0.63, bbox: [500, 150, 150, 130] }]);
    const { detectTarget } = await import("../src/lib/target-detector");
    expect(await detectTarget(frame, "coffee")).toMatchObject({ status: "ambiguous", message: expect.stringContaining("Found 2 cups") });
  });

  it("does not load a model or infer a box for an unsupported concept", async () => {
    const { detectTarget, targetClass } = await import("../src/lib/target-detector");
    expect(targetClass("espresso machine")).toBeNull();
    expect(await detectTarget(frame, "espresso machine")).toMatchObject({ status: "unsupported", ms: 0 });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.detect).not.toHaveBeenCalled();
  });

  it("clips a partially visible target to normalized image bounds", async () => {
    mocks.detect.mockResolvedValue([{ class: "cup", score: 0.9, bbox: [-20, 50, 120, 150] }]);
    const { detectTarget } = await import("../src/lib/target-detector");
    expectBox(await detectTarget(frame, "coffee"), { x: 0, y: 0.1, width: 0.1, height: 0.3 });
  });
});

it("locates a bottle without a banana/coffee allowlist", async () => {
  mocks.detect.mockResolvedValue([{ class: "bottle", score: .91, bbox: [400, 80, 140, 300] }, { class: "person", score: .99, bbox: [0,0,1000,500] }]);
  const { detectForeground } = await import("../src/lib/target-detector");
  expect(await detectForeground(frame)).toMatchObject({status:"found",label:"bottle"});
});
