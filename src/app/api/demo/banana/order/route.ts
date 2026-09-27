import { placeBananaTestOrder } from "@/lib/banana-demo";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const started = Date.now();
  const body = await request.json().catch(() => null);
  if (typeof body?.sessionId !== "string") return Response.json({ error: "A confirmed scan is required." }, { status: 400 });
  try {
    const order = await placeBananaTestOrder(body.sessionId);
    const timingMs = Date.now() - started;
    console.info("banana_demo.order", JSON.stringify({ timingMs, status: order.status, orderId: order.orderId }));
    return Response.json({ ...order, timingMs }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test order failed.";
    console.error("banana_demo.order_failed", JSON.stringify({ timingMs: Date.now() - started, message }));
    const status = message.includes("expired") ? 401 : message.includes("not configured") ? 503 : 502;
    return Response.json({ error: message }, { status, headers: { "cache-control": "private, no-store" } });
  }
}
