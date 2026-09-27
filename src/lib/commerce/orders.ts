import { catalogRevision, findProduct, MERCHANT, totalsFor, type Kind, type Product } from "./catalog";
import { samePurpose, shoppingOptions, type Purpose, type ScanContext } from "./options";

export type OrderStatus = "draft" | "quoted" | "approved" | "checkout_pending" | "paid_test" | "failed" | "expired";
export type Order = {
  id: string; owner_id: string; scan_id: string; client_request_id: string; product_id: string; title: string; variant: string; merchant: string;
  currency: string; subtotal_cents: number; shipping_cents: number; tax_cents: number; total_cents: number; budget_cents: number;
  purpose: Purpose; preference: Kind | null; status: OrderStatus; quote_expires_at: string; catalog_revision: string;
  provider: string | null; checkout_session_id: string | null; checkout_url: string | null; paid_at: string | null; status_detail: string | null;
};
export interface OrderStore {
  get(id: string, ownerId?: string): Promise<Order | null>;
  getBySession(sessionId: string): Promise<Order | null>;
  getByRequest(ownerId: string, clientRequestId: string): Promise<Order | null>;
  insert(order: Omit<Order, "id">): Promise<Order>;
  /** Conditional update: applies only if the order is currently in one of `from`; returns null otherwise. */
  transition(id: string, from: OrderStatus[], patch: Partial<Order>): Promise<Order | null>;
  recordEvent(eventId: string, orderId: string | null, type: string): Promise<boolean>;
}
export type CheckoutSession = { id: string; status: string; paymentStatus: string; amountTotal: number | null; currency: string | null; livemode: boolean; orderId: string | null };
export interface PaymentProvider {
  name: string;
  createCheckout(order: Order, urls: { successUrl: string; cancelUrl: string }, idempotencyKey: string): Promise<{ id: string; url: string }>;
  retrieve(sessionId: string): Promise<CheckoutSession>;
  expire(sessionId: string): Promise<void>;
}

export class CommerceError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export const QUOTE_MINUTES = 15;

export async function createQuote(store: OrderStore, input: { ownerId: string; scanId: string; context: ScanContext; productId: string; budgetCents: number; purpose: Purpose; preference?: Kind; clientRequestId: string; now?: Date; catalog?: readonly Product[] }) {
  const matchesRequest = (order: Order) => order.scan_id === input.scanId && order.product_id === input.productId
    && order.budget_cents === input.budgetCents && samePurpose(order.purpose, input.purpose)
    && (order.preference ?? null) === (input.preference ?? null);
  const existing = await store.getByRequest(input.ownerId, input.clientRequestId);
  if (existing) {
    if (!matchesRequest(existing)) throw new CommerceError("This request was already used for a different quote.", 409);
    return existing;
  }
  // The product must be one the server itself offered for this scan, budget, and purpose.
  const offered = shoppingOptions(input.context, { budgetCents: input.budgetCents, purpose: input.purpose, preference: input.preference }, input.catalog).options.find((option) => option.productId === input.productId);
  if (!offered) throw new CommerceError("That option isn't available for this scan and budget.", 409);
  const product = findProduct(input.productId, input.catalog)!;
  const totals = totalsFor(product);
  const now = input.now ?? new Date();
  const saved = await store.insert({
    owner_id: input.ownerId, scan_id: input.scanId, client_request_id: input.clientRequestId, product_id: product.id, title: product.title, variant: product.variant, merchant: MERCHANT.name,
    currency: totals.currency, subtotal_cents: totals.subtotalCents, shipping_cents: totals.shippingCents, tax_cents: totals.taxCents, total_cents: totals.totalCents, budget_cents: input.budgetCents,
    purpose: input.purpose, preference: input.preference ?? null, status: "quoted", quote_expires_at: new Date(now.getTime() + QUOTE_MINUTES * 60_000).toISOString(), catalog_revision: catalogRevision(input.catalog),
    provider: null, checkout_session_id: null, checkout_url: null, paid_at: null, status_detail: null,
  });
  // An insert may lose a race and return the winning row. It must still represent this exact request.
  if (!matchesRequest(saved)) throw new CommerceError("This request was already used for a different quote.", 409);
  return saved;
}

export type Approval = { kind: "redirect"; url: string; order: Order } | { kind: "changed" | "expired" | "unavailable" | "done"; order: Order };

async function reuseCheckout(store: OrderStore, provider: PaymentProvider, order: Order): Promise<Approval> {
  if (!order.checkout_session_id || !order.checkout_url) throw new CommerceError("Checkout is unavailable. Check the order status.", 409);
  const { order: current, session } = await reconcileCheckout(store, provider, order.checkout_session_id);
  if (!current) throw new CommerceError("Checkout is unavailable. Check the order status.", 409);
  if (current.status === "paid_test") return { kind: "done", order: current };
  if (current.status === "expired") return { kind: "expired", order: current };
  if (current.status !== "checkout_pending" || !current.checkout_url) return { kind: "unavailable", order: current };
  if (session?.status !== "open" || session.paymentStatus !== "unpaid") {
    return { kind: "unavailable", order: { ...current, status_detail: "Payment is still processing. Check this order's status before trying again." } };
  }
  return { kind: "redirect", url: current.checkout_url, order: current };
}

/** Approval of the exact total the shopper saw. Anything that changed since the quote sends them back to review. */
export async function approve(store: OrderStore, provider: PaymentProvider, input: { ownerId: string; orderId: string; expectedTotalCents: number; origin: string; now?: Date; catalog?: readonly Product[] }): Promise<Approval> {
  const now = input.now ?? new Date();
  const order = await store.get(input.orderId, input.ownerId);
  if (!order) throw new CommerceError("Order not found.", 404);
  if (order.status === "checkout_pending") return reuseCheckout(store, provider, order);
  if (order.status === "paid_test") return { kind: "done", order };
  if (order.status !== "quoted") throw new CommerceError(`This order is ${order.status.replace("_", " ")} and can't be approved.`, 409);
  if (Date.parse(order.quote_expires_at) <= now.getTime()) return { kind: "expired", order: (await store.transition(order.id, ["quoted"], { status: "expired", status_detail: "Quote expired before approval." })) ?? order };
  const product = findProduct(order.product_id, input.catalog);
  if (!product || product.stock <= 0) return { kind: "unavailable", order: (await store.transition(order.id, ["quoted"], { status: "expired", status_detail: "No longer available at the demo merchant." })) ?? order };
  const totals = totalsFor(product);
  if (totals.totalCents > order.budget_cents) return { kind: "unavailable", order: (await store.transition(order.id, ["quoted"], { status: "expired", status_detail: "The total now exceeds your budget." })) ?? order };
  const changed = totals.totalCents !== order.total_cents || totals.currency !== order.currency || catalogRevision(input.catalog) !== order.catalog_revision || input.expectedTotalCents !== totals.totalCents;
  if (changed) {
    const refreshed = await store.transition(order.id, ["quoted"], { title: product.title, variant: product.variant, subtotal_cents: totals.subtotalCents, shipping_cents: totals.shippingCents, tax_cents: totals.taxCents, total_cents: totals.totalCents, currency: totals.currency, catalog_revision: catalogRevision(input.catalog), quote_expires_at: new Date(now.getTime() + QUOTE_MINUTES * 60_000).toISOString(), status_detail: "The quote changed. Review and approve again." });
    return { kind: "changed", order: refreshed ?? order };
  }
  const approved = await store.transition(order.id, ["quoted"], { status: "approved", status_detail: null });
  if (!approved) {
    const current = await store.get(order.id, input.ownerId);
    if (current?.status === "checkout_pending") return reuseCheckout(store, provider, current);
    throw new CommerceError("This order changed while approving. Review it again.", 409);
  }
  try {
    const session = await provider.createCheckout(approved, { successUrl: `${input.origin}/shop/orders/${approved.id}?session_id={CHECKOUT_SESSION_ID}`, cancelUrl: `${input.origin}/shop/orders/${approved.id}?returned=1` }, `callback-order-${approved.id}-${approved.total_cents}`);
    const pending = await store.transition(approved.id, ["approved"], { status: "checkout_pending", provider: provider.name, checkout_session_id: session.id, checkout_url: session.url });
    return { kind: "redirect", url: session.url, order: pending ?? approved };
  } catch {
    await store.transition(approved.id, ["approved"], { status: "quoted", status_detail: "Couldn't start test checkout. Nothing was charged; try again." });
    throw new CommerceError("Couldn't start the test checkout. Nothing was charged.", 502);
  }
}

/** Paid only when the provider itself reports a complete, paid, test-mode session for this exact order and amount. */
async function reconcileCheckout(store: OrderStore, provider: PaymentProvider, sessionId: string, asyncPaymentFailed = false): Promise<{ order: Order | null; session: CheckoutSession | null }> {
  const order = await store.getBySession(sessionId);
  if (!order) return { order: null, session: null };
  if (order.status !== "checkout_pending" && order.status !== "failed") return { order, session: null };
  const pending = order.status === "checkout_pending";
  const session = await provider.retrieve(sessionId);
  const result = (updated: Order | null) => ({ order: updated, session });
  const fail = async (detail: string) => pending
    ? (await store.transition(order.id, ["checkout_pending"], { status: "failed", status_detail: detail })) ?? (await store.get(order.id))
    : order;
  if (session.orderId !== order.id || session.id !== order.checkout_session_id) {
    return result(await fail("Provider session didn't match this order."));
  }
  if (session.livemode) return result(await fail("Refused: live-mode payment on a test demo."));
  if (session.amountTotal !== order.total_cents || session.currency !== order.currency) {
    return result(await fail("Provider amount didn't match the approved total."));
  }
  if (session.status === "complete" && session.paymentStatus === "paid") {
    return result((await store.transition(order.id, ["checkout_pending", "failed"], { status: "paid_test", paid_at: new Date().toISOString(), status_detail: null })) ?? (await store.get(order.id)));
  }
  if (!pending) return result(order);
  if (session.status === "expired") return result((await store.transition(order.id, ["checkout_pending"], { status: "expired", status_detail: "Checkout expired without payment." })) ?? (await store.get(order.id)));
  if (asyncPaymentFailed && session.status === "complete" && session.paymentStatus === "unpaid") {
    return result((await store.transition(order.id, ["checkout_pending"], { status: "failed", status_detail: "The test payment failed." })) ?? (await store.get(order.id)));
  }
  return result(order);
}

export async function verifyCheckout(store: OrderStore, provider: PaymentProvider, sessionId: string, asyncPaymentFailed = false): Promise<Order | null> {
  return (await reconcileCheckout(store, provider, sessionId, asyncPaymentFailed)).order;
}

export type ProviderEvent = { id: string; type: string; sessionId: string };
export async function handleProviderEvent(store: OrderStore, provider: PaymentProvider, event: ProviderEvent) {
  let order: Order | null;
  if (event.type === "checkout.session.async_payment_failed") {
    order = await verifyCheckout(store, provider, event.sessionId, true);
  } else if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"].includes(event.type)) {
    order = await verifyCheckout(store, provider, event.sessionId);
  } else order = null;
  // Processing is idempotent, so a redelivered event is harmless; recording it only marks the duplicate.
  const first = await store.recordEvent(event.id, order?.id ?? null, event.type);
  return { order, duplicate: !first };
}

export async function cancelOrder(store: OrderStore, provider: PaymentProvider, input: { ownerId: string; orderId: string }) {
  const order = await store.get(input.orderId, input.ownerId);
  if (!order) throw new CommerceError("Order not found.", 404);
  if (order.status === "checkout_pending" && order.checkout_session_id) {
    // Confirm with the provider first: a payment that already went through must not be shown as cancelled.
    const verified = await verifyCheckout(store, provider, order.checkout_session_id);
    if (verified?.status !== "checkout_pending") return verified;
    await provider.expire(order.checkout_session_id).catch(() => {});
    return (await verifyCheckout(store, provider, order.checkout_session_id)) ?? order;
  }
  if (order.status === "quoted") return (await store.transition(order.id, ["quoted"], { status: "expired", status_detail: "Cancelled before approval." })) ?? order;
  return order;
}
