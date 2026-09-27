import { createScanToken, preparationFromToken, recognizeBanana } from "@/lib/banana-demo";
import { validImage } from "@/lib/scan-stream";

export const runtime = "nodejs";
export const maxDuration = 30;

const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  const started = Date.now();
  const form = await request.formData().catch(() => null);
  const image = form?.get("image") ?? null;
  const prepareToken = form?.get("prepareToken");
  if (!validImage(image)) return reply({ error: "Choose a JPG, PNG, or WebP image under 8 MB." }, 400);
  try {
    const prepared = preparationFromToken(prepareToken);
    if (!prepared) return reply({ error: "Demo preparation expired. Refresh the demo first." }, 401);
    const observed = await recognizeBanana(image, request.signal);
    const timingMs = Date.now() - started;
    console.info("banana_demo.scan", JSON.stringify({ timingMs, visionMs: observed.visionMs, bananaDetected: observed.bananaDetected, visionModel: observed.visionModel, imageBytes: image.size }));
    if (!observed.bananaDetected) return reply({ bananaDetected: false, identification: observed.identification, timingMs, visionDiagnostics: observed.visionDiagnostics });
    return reply({ bananaDetected: true, sessionId: createScanToken(), identification: observed.identification,
      memory: prepared.memory, recipe: prepared.recipe, cart: prepared.cart, timingMs: Date.now() - started, visionDiagnostics: observed.visionDiagnostics });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan this image.";
    console.error("banana_demo.scan_failed", JSON.stringify({ timingMs: Date.now() - started, message }));
    return reply({ error: message }, 503);
  }
}
