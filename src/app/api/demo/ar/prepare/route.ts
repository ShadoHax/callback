import { createArPrepareEnvelope, prepareArDemo } from "@/lib/ar-demo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const started = Date.now();
  try {
    const scenarios = await prepareArDemo();
    const timingMs = Date.now() - started;
    console.info("ar_demo.prepare", JSON.stringify({ timingMs, ready: true, model: scenarios.banana.model.preparationModel }));
    const prepareToken = createArPrepareEnvelope(scenarios.banana.prepareToken, scenarios.coffee.prepareToken);
    return Response.json({ ready: true, prepareToken, scenarios, timingMs }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare the AR demo.";
    console.error("ar_demo.prepare_failed", JSON.stringify({ timingMs: Date.now() - started, message }));
    return Response.json({ ready: false, error: message }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
