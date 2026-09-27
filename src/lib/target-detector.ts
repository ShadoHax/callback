import type { NormalizedBox } from "./object-overlay";

export type TargetDetection = { status: "found"; box: NormalizedBox; label: string; score: number; ms: number } | { status: "absent" | "ambiguous" | "unsupported"; message: string; ms: number };
/** Pixel crop around the exact frame used for detection, with context for server confirmation. */
export function targetCropRect(box: NormalizedBox, width: number, height: number, padding = .15) {
  const left = Math.max(0, Math.floor((box.x - box.width * padding) * width));
  const top = Math.max(0, Math.floor((box.y - box.height * padding) * height));
  const right = Math.min(width, Math.ceil((box.x + box.width * (1 + padding)) * width));
  const bottom = Math.min(height, Math.ceil((box.y + box.height * (1 + padding)) * height));
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}
const aliases: Record<string, string> = { coffee: "cup", "coffee cup": "cup", "coffee mug": "cup", mug: "cup", tea: "cup", "tea cup": "cup", "water bottle": "bottle", cellphone: "cell phone", phone: "cell phone", notebook: "book" };
const classes = new Set(["person","bicycle","car","motorcycle","airplane","bus","train","truck","boat","traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv","laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"]);
export function targetClass(target: string) { const normalized = target.trim().toLowerCase(); return aliases[normalized] ?? (classes.has(normalized) ? normalized : null); }
let loading: Promise<import("@tensorflow-models/coco-ssd").ObjectDetection> | undefined;
export function loadTargetDetector() {
  return loading ??= (async () => {
    const tf = await import("@tensorflow/tfjs-core");
    await import("@tensorflow/tfjs-backend-webgl");
    await import("@tensorflow/tfjs-backend-cpu");
    try { if (!await tf.setBackend("webgl")) await tf.setBackend("cpu"); } catch { await tf.setBackend("cpu"); }
    await tf.ready();
    const coco = await import("@tensorflow-models/coco-ssd");
    return coco.load({ base: "lite_mobilenet_v2" });
  })().catch((error) => { loading = undefined; throw error; });
}
type Prediction = { class: string; score: number; bbox: [number, number, number, number] };

function normalizedHit(frame: HTMLCanvasElement, hit: Prediction, label: string, ms: number): TargetDetection {
  const [x, y, width, height] = hit.bbox;
  const left = Math.max(0, x / frame.width), top = Math.max(0, y / frame.height);
  const right = Math.min(1, (x + width) / frame.width), bottom = Math.min(1, (y + height) / frame.height);
  if (right <= left || bottom <= top) return { status: "absent", message: "The target is outside the image.", ms };
  return { status: "found", box: { x: left, y: top, width: right - left, height: bottom - top }, label, score: hit.score, ms };
}

/** Pick the most prominent supported concept with a single local model inference. */
export async function detectTargets(frame: HTMLCanvasElement, targets: readonly string[]): Promise<TargetDetection> {
  const desired = new Map<string, string>();
  for (const target of targets) {
    const kind = targetClass(target);
    if (kind && !desired.has(kind)) desired.set(kind, target);
  }
  if (!desired.size) return { status: "unsupported", message: "No supported targets were provided.", ms: 0 };
  const started = performance.now();
  const detector = await loadTargetDetector();
  const predictions = await detector.detect(frame, 20, .4);
  const candidates = predictions.filter((item) => desired.has(item.class) && item.score >= .4 && item.bbox[2] > 0 && item.bbox[3] > 0);
  const ms = performance.now() - started;
  if (!candidates.length) return { status: "absent", message: `No ${targets.join(" or ")} detected. Try another angle.`, ms };
  // Favor a clear object close to the camera over a tiny high-confidence background object.
  candidates.sort((a, b) => {
    const prominence = (item: Prediction) => item.score * Math.sqrt(Math.min(1, item.bbox[2] * item.bbox[3] / (frame.width * frame.height)));
    return prominence(b) - prominence(a);
  });
  const hit = candidates[0];
  return normalizedHit(frame, hit, desired.get(hit.class)!, ms);
}
/** The caller picks the concept. The local model returns only matching physical classes. */
export async function detectTarget(frame: HTMLCanvasElement, target: string): Promise<TargetDetection> {
  const started = performance.now();
  const desired = targetClass(target);
  if (!desired) return { status: "unsupported", message: `“${target}” needs a supported object label or a grounding adapter.`, ms: 0 };
  const detector = await loadTargetDetector();
  const predictions = await detector.detect(frame, 20, .4);
  const candidates = predictions.filter((item) => item.class === desired && item.score >= .4);
  const ms = performance.now() - started;
  if (!candidates.length) return { status: "absent", message: `No ${desired} detected. Try another angle.`, ms };
  if (candidates.length > 1) return { status: "ambiguous", message: `Found ${candidates.length} ${desired}s. Move closer to the one you mean.`, ms };
  return normalizedHit(frame, candidates[0], desired, ms);
}

/** Local boxes are optional tracking hints, not an allowlist for server vision. */
export async function detectForeground(frame: HTMLCanvasElement): Promise<TargetDetection> {
  const started = performance.now();
  const detector = await loadTargetDetector();
  const predictions = await detector.detect(frame, 20, .4);
  const background = new Set(["person", "dining table", "chair", "couch", "bed", "toilet"]);
  const candidates = predictions.filter(hit => !background.has(hit.class) && hit.score >= .4 && hit.bbox[2] > 0 && hit.bbox[3] > 0);
  candidates.sort((a,b) => b.score * Math.sqrt(b.bbox[2] * b.bbox[3]) - a.score * Math.sqrt(a.bbox[2] * a.bbox[3]));
  return candidates[0] ? normalizedHit(frame, candidates[0], candidates[0].class, performance.now() - started)
    : { status: "absent", message: "Hold steady for recognition.", ms: performance.now() - started };
}
