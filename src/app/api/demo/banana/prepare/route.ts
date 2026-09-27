import { prepareBananaDemo } from "@/lib/banana-demo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const started = Date.now();
  try {
    const prepared = await prepareBananaDemo();
    const body = { ready: true, ...prepared, timingMs: Date.now() - started };
    console.info("banana_demo.prepare", JSON.stringify({ timingMs: body.timingMs, ready: true, model: prepared.model.preparationModel }));
    return Response.json(body, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare your memories.";
    console.error("banana_demo.prepare_failed", JSON.stringify({ timingMs: Date.now() - started, message }));
    return Response.json({ ready: false, error: message }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
