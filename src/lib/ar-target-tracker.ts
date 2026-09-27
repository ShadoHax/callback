import { validateNormalizedBox, type NormalizedBox } from "./object-overlay";
import type * as OpenCV from "@techstark/opencv-js";

type CvMat = OpenCV.Mat;

/** Small structural surface of OpenCV.js, allowing the runtime to be lazy loaded. */
export type TrackerCv = Pick<typeof OpenCV, "Mat" | "Size" | "TermCriteria" | "CV_8UC1" | "CV_32FC2"
  | "COLOR_RGBA2GRAY" | "TermCriteria_EPS" | "TermCriteria_COUNT" | "matFromImageData"
  | "cvtColor" | "goodFeaturesToTrack" | "calcOpticalFlowPyrLK">;

export type TrackerResult =
  | { status: "tracking"; box: NormalizedBox; pointCount: number }
  | { status: "lost"; box: null; reason: "insufficient_features" | "flow_failed" | "unstable_motion" | "out_of_bounds" | "frame_changed" | "not_seeded" };

const MIN_POINTS = 6;
const MAX_POINTS = 80;
const MAX_FRAME_EDGE = 640;
const MAX_FLOW_ERROR = 30;
const MAX_FORWARD_BACK_ERROR = 1.5;

type Point = { x: number; y: number };

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function validateFrame(frame: ImageData) {
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || frame.width <= 0 || frame.height <= 0 || Math.max(frame.width, frame.height) > MAX_FRAME_EDGE
    || frame.data.length < frame.width * frame.height * 4) {
    throw new Error("Tracking frames must be valid RGBA ImageData with an edge of at most 640 pixels.");
  }
}

function grayscale(cv: TrackerCv, frame: ImageData) {
  const rgba = cv.matFromImageData(frame);
  const gray = new cv.Mat();
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    return gray;
  } catch (error) {
    gray.delete();
    throw error;
  } finally {
    rgba.delete();
  }
}

function featurePoints(cv: TrackerCv, gray: CvMat, box: NormalizedBox, width: number, height: number) {
  const mask = cv.Mat.zeros(height, width, cv.CV_8UC1);
  const points = new cv.Mat();
  try {
    const left = Math.max(0, Math.floor(box.x * width));
    const top = Math.max(0, Math.floor(box.y * height));
    const right = Math.min(width, Math.ceil((box.x + box.width) * width));
    const bottom = Math.min(height, Math.ceil((box.y + box.height) * height));
    for (let y = top; y < bottom; y++) mask.data.fill(255, y * width + left, y * width + right);
    cv.goodFeaturesToTrack(gray, points, MAX_POINTS, 0.01, 4, mask, 3, false, 0.04);
    return points;
  } catch (error) {
    points.delete();
    throw error;
  } finally {
    mask.delete();
  }
}

function pointAt(mat: CvMat, index: number): Point {
  return { x: mat.data32F[index * 2], y: mat.data32F[index * 2 + 1] };
}

export class ArTargetTracker {
  private previousGray: CvMat | null = null;
  private previousPoints: CvMat | null = null;
  private currentBox: NormalizedBox | null = null;
  private width = 0;
  private height = 0;
  private lostReason: Extract<TrackerResult, { status: "lost" }>["reason"] = "not_seeded";
  private disposed = false;

  constructor(private readonly cv: TrackerCv, initialFrame: ImageData, initialBox: NormalizedBox) {
    this.reseed(initialFrame, initialBox);
  }

  get status(): "tracking" | "lost" { return this.currentBox ? "tracking" : "lost"; }
  get box(): NormalizedBox | null { return this.currentBox ? { ...this.currentBox } : null; }

  private clear() {
    this.previousGray?.delete(); this.previousGray = null;
    this.previousPoints?.delete(); this.previousPoints = null;
    this.currentBox = null;
  }

  private lose(reason: Extract<TrackerResult, { status: "lost" }>["reason"]): TrackerResult {
    this.clear(); this.lostReason = reason;
    return { status: "lost", box: null, reason };
  }

  /** Start tracking a newly grounded object. False means the patch lacks reliable corners. */
  reseed(frame: ImageData, box: NormalizedBox): boolean {
    if (this.disposed) throw new Error("Tracker has been disposed.");
    validateFrame(frame);
    const valid = validateNormalizedBox(box);
    this.clear();
    this.width = frame.width; this.height = frame.height;
    let gray: CvMat | null = null;
    let points: CvMat | null = null;
    try {
      gray = grayscale(this.cv, frame);
      points = featurePoints(this.cv, gray, valid, this.width, this.height);
      if (points.rows < MIN_POINTS) {
        this.lostReason = "insufficient_features";
        return false;
      }
      this.previousGray = gray; gray = null;
      this.previousPoints = points; points = null;
      this.currentBox = valid;
      return true;
    } catch {
      this.lostReason = "flow_failed";
      return false;
    } finally {
      gray?.delete(); points?.delete();
    }
  }

  /** Advance by one camera frame; a lost target stays lost until explicitly reseeded. */
  update(frame: ImageData): TrackerResult {
    if (this.disposed) throw new Error("Tracker has been disposed.");
    if (!this.currentBox || !this.previousGray || !this.previousPoints) {
      return { status: "lost", box: null, reason: this.lostReason };
    }
    try { validateFrame(frame); } catch { return this.lose("frame_changed"); }
    if (frame.width !== this.width || frame.height !== this.height) return this.lose("frame_changed");

    let nextGray: CvMat | null = null;
    const temporaries: CvMat[] = [];
    const temporary = () => {
      const mat = new this.cv.Mat();
      temporaries.push(mat);
      return mat;
    };
    let retained: CvMat | null = null;
    try {
      const forward = temporary();
      const forwardStatus = temporary();
      const forwardError = temporary();
      const backward = temporary();
      const backwardStatus = temporary();
      const backwardError = temporary();
      nextGray = grayscale(this.cv, frame);
      const window = new this.cv.Size(21, 21);
      const criteria = new this.cv.TermCriteria(this.cv.TermCriteria_EPS | this.cv.TermCriteria_COUNT, 30, 0.01);
      this.cv.calcOpticalFlowPyrLK(this.previousGray, nextGray, this.previousPoints, forward,
        forwardStatus, forwardError, window, 3, criteria);
      this.cv.calcOpticalFlowPyrLK(nextGray, this.previousGray, forward, backward,
        backwardStatus, backwardError, window, 3, criteria);

      const candidates: { before: Point; after: Point; dx: number; dy: number }[] = [];
      const count = Math.min(this.previousPoints.rows, forward.rows, backward.rows);
      for (let index = 0; index < count; index++) {
        if (!forwardStatus.data[index] || !backwardStatus.data[index] || forwardError.data32F[index] > MAX_FLOW_ERROR) continue;
        const before = pointAt(this.previousPoints, index);
        const after = pointAt(forward, index);
        const returned = pointAt(backward, index);
        if (![before.x, before.y, after.x, after.y, returned.x, returned.y].every(Number.isFinite)) continue;
        if (Math.hypot(before.x - returned.x, before.y - returned.y) > MAX_FORWARD_BACK_ERROR) continue;
        if (after.x < 0 || after.y < 0 || after.x >= this.width || after.y >= this.height) continue;
        candidates.push({ before, after, dx: after.x - before.x, dy: after.y - before.y });
      }
      if (candidates.length < MIN_POINTS) return this.lose("insufficient_features");
      const dx = median(candidates.map((point) => point.dx));
      const dy = median(candidates.map((point) => point.dy));
      const residuals = candidates.map((point) => Math.hypot(point.dx - dx, point.dy - dy));
      const limit = Math.max(2.5, median(residuals) * 2.5);
      const inliers = candidates.filter((_, index) => residuals[index] <= limit);
      if (inliers.length < MIN_POINTS || Math.hypot(dx, dy) > Math.min(this.width, this.height) * 0.25) {
        return this.lose("unstable_motion");
      }
      const moveX = median(inliers.map((point) => point.dx));
      const moveY = median(inliers.map((point) => point.dy));
      const box = { ...this.currentBox,
        x: this.currentBox.x + moveX / this.width,
        y: this.currentBox.y + moveY / this.height };
      if (box.x < 0 || box.y < 0 || box.x + box.width > 1 || box.y + box.height > 1) {
        return this.lose("out_of_bounds");
      }
      retained = new this.cv.Mat(inliers.length, 1, this.cv.CV_32FC2);
      for (let index = 0; index < inliers.length; index++) {
        retained.data32F[index * 2] = inliers[index].after.x;
        retained.data32F[index * 2 + 1] = inliers[index].after.y;
      }
      this.previousGray.delete(); this.previousPoints.delete();
      this.previousGray = nextGray; nextGray = null;
      this.previousPoints = retained; retained = null;
      this.currentBox = box;
      return { status: "tracking", box: { ...box }, pointCount: inliers.length };
    } catch {
      return this.lose("flow_failed");
    } finally {
      nextGray?.delete(); retained?.delete();
      temporaries.forEach((mat) => mat.delete());
    }
  }

  dispose() {
    if (this.disposed) return;
    this.clear(); this.disposed = true;
  }
}

export function createArTargetTracker(cv: TrackerCv, initialFrame: ImageData, initialBox: NormalizedBox) {
  return new ArTargetTracker(cv, initialFrame, initialBox);
}
