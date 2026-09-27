import { afterEach, expect, it, vi } from "vitest";
import { createArTargetTracker, type TrackerCv } from "../src/lib/ar-target-tracker";

class FakeMat {
  static all: FakeMat[] = [];
  rows: number;
  cols: number;
  data: Uint8Array;
  data32F: Float32Array;
  deleted = false;

  constructor(rows = 0, cols = 0) {
    this.rows = rows; this.cols = cols;
    this.data = new Uint8Array(rows * cols);
    this.data32F = new Float32Array(rows * cols * 2);
    FakeMat.all.push(this);
  }

  static zeros(rows: number, cols: number) { return new FakeMat(rows, cols); }
  delete() {
    if (this.deleted) throw new Error("Mat deleted twice");
    this.deleted = true;
  }
}

const basePoints = [
  [25, 25], [30, 26], [35, 28], [40, 30], [45, 33], [50, 38], [28, 45], [52, 50],
];

function fakeCv(options: { dx?: number; dy?: number; validCount?: number; corners?: number; points?: number[][]; outlierIndex?: number } = {}) {
  let flowCalls = 0;
  const cv = {
    Mat: FakeMat,
    Size: class {},
    TermCriteria: class {},
    CV_8UC1: 0, CV_32FC2: 1, COLOR_RGBA2GRAY: 2, TermCriteria_EPS: 2, TermCriteria_COUNT: 1,
    matFromImageData: (frame: ImageData) => new FakeMat(frame.height, frame.width),
    cvtColor: (_source: FakeMat, destination: FakeMat) => { destination.rows = 100; destination.cols = 100; },
    goodFeaturesToTrack: (_image: FakeMat, corners: FakeMat, _maximum: number, _quality: number,
      _distance: number, mask: FakeMat) => {
      const points = (options.points ?? basePoints).slice(0, options.corners ?? basePoints.length);
      expect(mask.data[points[0][1] * 100 + points[0][0]]).toBe(255);
      expect(mask.data[5 * 100 + 5]).toBe(0);
      corners.rows = points.length; corners.cols = 1;
      corners.data32F = new Float32Array(points.flat());
    },
    calcOpticalFlowPyrLK: (_previous: FakeMat, _next: FakeMat, input: FakeMat,
      output: FakeMat, status: FakeMat, error: FakeMat) => {
      const forward = flowCalls++ % 2 === 0;
      output.rows = input.rows; output.cols = 1;
      output.data32F = new Float32Array(input.data32F.length);
      status.data = new Uint8Array(input.rows);
      error.data32F = new Float32Array(input.rows);
      for (let index = 0; index < input.rows; index++) {
        const valid = index < (options.validCount ?? input.rows);
        status.data[index] = valid ? 1 : 0;
        output.data32F[index * 2] = input.data32F[index * 2] + (forward ? 1 : -1) * (options.dx ?? 5)
          + (forward && index === options.outlierIndex ? 18 : 0);
        output.data32F[index * 2 + 1] = input.data32F[index * 2 + 1] + (forward ? 1 : -1) * (options.dy ?? 3);
      }
    },
  };
  return cv as unknown as TrackerCv;
}

const frame = () => ({ width: 100, height: 100, data: new Uint8ClampedArray(100 * 100 * 4) }) as ImageData;
const box = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

afterEach(() => { FakeMat.all = []; vi.restoreAllMocks(); });

it("tracks a coherent translation and deletes all OpenCV Mats on dispose", () => {
  const tracker = createArTargetTracker(fakeCv(), frame(), box);
  expect(tracker.status).toBe("tracking");
  expect(tracker.update(frame())).toEqual({ status: "tracking", box: { x: 0.25, y: 0.23, width: 0.4, height: 0.4 }, pointCount: 8 });
  tracker.dispose();
  expect(FakeMat.all.every((mat) => mat.deleted)).toBe(true);
});

it("excludes a point that fails the forward/backward consistency check", () => {
  const tracker = createArTargetTracker(fakeCv({ outlierIndex: 7 }), frame(), box);
  expect(tracker.update(frame())).toEqual({ status: "tracking", box: { x: 0.25, y: 0.23, width: 0.4, height: 0.4 }, pointCount: 7 });
  tracker.dispose();
  expect(FakeMat.all.every((mat) => mat.deleted)).toBe(true);
});

it("reports loss when too few forward/backward tracks survive and waits for a reseed", () => {
  const tracker = createArTargetTracker(fakeCv({ validCount: 4 }), frame(), box);
  expect(tracker.update(frame())).toEqual({ status: "lost", box: null, reason: "insufficient_features" });
  expect(tracker.update(frame())).toEqual({ status: "lost", box: null, reason: "insufficient_features" });
  expect(tracker.reseed(frame(), box)).toBe(true);
  expect(tracker.status).toBe("tracking");
  tracker.dispose();
  expect(FakeMat.all.every((mat) => mat.deleted)).toBe(true);
});

it("rejects a moved box outside the image and does not retain stale geometry", () => {
  const rightSidePoints = [[72, 25], [75, 26], [78, 28], [80, 30], [83, 33], [85, 38], [74, 45], [82, 50]];
  const tracker = createArTargetTracker(fakeCv({ dx: 10, dy: 0, points: rightSidePoints }), frame(), { x: 0.7, y: 0.2, width: 0.25, height: 0.4 });
  expect(tracker.update(frame())).toEqual({ status: "lost", box: null, reason: "out_of_bounds" });
  expect(tracker.box).toBeNull();
  tracker.dispose();
  expect(FakeMat.all.every((mat) => mat.deleted)).toBe(true);
});

it("rejects oversized tracking frames before allocating Mats", () => {
  expect(() => createArTargetTracker(fakeCv(), { width: 641, height: 100, data: new Uint8ClampedArray(641 * 100 * 4) } as ImageData, box))
    .toThrow(/at most 640/);
  expect(FakeMat.all).toHaveLength(0);
});
