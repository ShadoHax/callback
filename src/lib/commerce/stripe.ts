import Stripe from "stripe";
import type { CheckoutSession, Order, PaymentProvider } from "./orders";

// Stripe Checkout in TEST mode only. This is a Stripe integration demonstrating a hosted card checkout; it is not a
// Visa Intelligent Commerce integration. Card data stays on Stripe's page and never reaches this app or any model.
let client: Stripe | null = null;

export function stripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return /^(sk|rk)_test_/.test(key);
}

function stripe() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_/.test(key)) throw new Error("Test checkout needs a Stripe test-mode secret key (sk_test_…); live keys are refused.");
  client ??= new Stripe(key);
  return client;
}

export function stripeProvider(): PaymentProvider {
  return {
    name: "stripe_test",
    async createCheckout(order: Order, urls, idempotencyKey) {
      const line = (name: string, cents: number) => ({ quantity: 1, price_data: { currency: order.currency, unit_amount: cents, product_data: { name } } });
      const session = await stripe().checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        // Our server-computed breakdown, so the provider total can be checked against the approved total.
        line_items: [
          line(`${order.title} (${order.variant}) · ${order.merchant} TEST`, order.subtotal_cents),
          ...(order.shipping_cents ? [line("Shipping (demo rate)", order.shipping_cents)] : []),
          ...(order.tax_cents ? [line("Tax (demo 7%)", order.tax_cents)] : []),
        ],
        client_reference_id: order.id,
        metadata: { order_id: order.id, scan_id: order.scan_id, demo: "callback-test-merchant" },
        success_url: urls.successUrl,
        cancel_url: urls.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      }, { idempotencyKey });
      if (!session.url) throw new Error("Stripe returned no checkout URL.");
      return { id: session.id, url: session.url };
    },
    async retrieve(sessionId): Promise<CheckoutSession> {
      const session = await stripe().checkout.sessions.retrieve(sessionId);
      return { id: session.id, status: session.status ?? "open", paymentStatus: session.payment_status, amountTotal: session.amount_total, currency: session.currency, livemode: session.livemode, orderId: session.metadata?.order_id ?? null };
    },
    async expire(sessionId) { await stripe().checkout.sessions.expire(sessionId); },
  };
}

/** Verifies the Stripe-Signature header against the raw body; throws on any mismatch. */
export function verifyStripeEvent(rawBody: string, signature: string | null) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signature) throw new Error("Missing webhook secret or signature.");
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}
