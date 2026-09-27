import { adminSupabase } from "@/lib/admin-supabase";
import { handleProviderEvent } from "@/lib/commerce/orders";
import { supabaseOrderStore } from "@/lib/commerce/store";
import { stripeProvider, verifyStripeEvent } from "@/lib/commerce/stripe";

export const runtime = "nodejs";
const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"]);

// Signature is verified against the raw body. Payment state is then re-read from Stripe, so the event body alone
// is never trusted, and redelivered events are harmless.
export async function POST(request: Request) {
  const raw = await request.text();
  let event;
  try { event = verifyStripeEvent(raw, request.headers.get("stripe-signature")); }
  catch { return new Response("Invalid signature", { status: 400 }); }
  if (!handled.has(event.type)) return Response.json({ received: true, ignored: event.type });
  const session = event.data.object as { id?: string; object?: string };
  if (session.object !== "checkout.session" || !session.id) return Response.json({ received: true, ignored: "not a checkout session" });
  try {
    const result = await handleProviderEvent(supabaseOrderStore(adminSupabase()), stripeProvider(), { id: event.id, type: event.type, sessionId: session.id });
    return Response.json({ received: true, status: result.order?.status ?? "unknown order", duplicate: result.duplicate });
  } catch {
    // A 5xx asks Stripe to retry later; processing is idempotent.
    return new Response("Processing failed", { status: 500 });
  }
}
