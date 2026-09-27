import sharp from "sharp";
import { ModelError } from "./model";

/** Normalize uploads and live frames to the same bounded vision input; the original photo stays unchanged. */
export async function prepareVisionImage(image: File) {
  const edge = Number(process.env.VISION_MAX_IMAGE_EDGE || "1024");
  if (!Number.isInteger(edge) || edge < 512 || edge > 1280) throw new ModelError("VISION_MAX_IMAGE_EDGE must be an integer from 512 to 1280.");
  const started = Date.now();
  try {
    const { data, info } = await sharp(Buffer.from(await image.arrayBuffer()), { limitInputPixels: 64_000_000 })
      .rotate().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
    return { url: `data:image/jpeg;base64,${data.toString("base64")}`,
      metrics: { originalBytes: image.size, sentBytes: data.length, width: info.width, height: info.height, maxEdge: edge, preparationMs: Date.now() - started } };
  } catch {
    throw new ModelError("Could not decode this photo. Try a smaller JPG, PNG, or WebP image.", 400);
  }
}
