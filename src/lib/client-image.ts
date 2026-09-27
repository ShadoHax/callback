// Downscale before upload: phone photos are 3–12 MB and venue Wi-Fi is slow. 1280 px is plenty to read a label.
const MAX_SIDE = 1280;

function toJpeg(canvas: HTMLCanvasElement) {
  return new Promise<File>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" })) : reject(new Error("Could not encode the photo."))), "image/jpeg", 0.86));
}

function draw(source: CanvasImageSource, width: number, height: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not process the photo.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function frameFromVideo(video: HTMLVideoElement) {
  if (!video.videoWidth) throw new Error("The camera is not ready yet.");
  return toJpeg(draw(video, video.videoWidth, video.videoHeight));
}

export async function downscaleFile(file: File) {
  // createImageBitmap applies EXIF orientation, so portrait photos stay upright.
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024) return file;
    throw new Error("Choose a JPG, PNG, or WebP photo.");
  }
  try { return await toJpeg(draw(bitmap, bitmap.width, bitmap.height)); } finally { bitmap.close(); }
}
