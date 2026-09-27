import type { TrackerCv } from "./ar-target-tracker";
let pending: Promise<TrackerCv> | undefined;
export function loadOpenCV(): Promise<TrackerCv> {
  return pending ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/opencv.js"; script.async = true;
    const timeout = setTimeout(() => { pending = undefined; reject(new Error("OpenCV took too long to load. Try again.")); }, 45000);
    script.onerror = () => { clearTimeout(timeout); pending = undefined; script.remove(); reject(new Error("Could not load on-device tracking.")); };
    script.onload = () => {
      try {
        const runtime = (window as unknown as { cv: TrackerCv & { onRuntimeInitialized?: () => void } }).cv;
        const finish = () => {
          clearTimeout(timeout);
          // Emscripten's legacy module has a self-resolving .then(); never await/resolve it.
          const { Mat, Size, TermCriteria, CV_8UC1, CV_32FC2, COLOR_RGBA2GRAY, TermCriteria_EPS, TermCriteria_COUNT, matFromImageData, cvtColor, goodFeaturesToTrack, calcOpticalFlowPyrLK } = runtime;
          resolve({ Mat, Size, TermCriteria, CV_8UC1, CV_32FC2, COLOR_RGBA2GRAY, TermCriteria_EPS, TermCriteria_COUNT, matFromImageData, cvtColor, goodFeaturesToTrack, calcOpticalFlowPyrLK });
        };
        if (runtime.Mat) finish(); else runtime.onRuntimeInitialized = finish;
      } catch (error) { clearTimeout(timeout); pending = undefined; reject(error); }
    };
    document.head.appendChild(script);
  });
}
