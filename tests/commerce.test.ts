import { describe, expect, it, vi } from "vitest";
import { groundInCatalog as groundIn, totalsFor, type Product } from "../src/lib/commerce/catalog";
import { shoppingOptions as optionsFor, type ScanContext } from "../src/lib/commerce/options";
import { approve as approveOrder, cancelOrder, createQuote, handleProviderEvent, verifyCheckout, type CheckoutSession, type Order, type OrderStore, type PaymentProvider } from "../src/lib/commerce/orders";
import { LEGACY_CATALOG as CATALOG } from "./fixtures/legacy-catalog";

// These rules (exact identity, editions, budgets, quotes, payment) run against a fixed test catalog; the demo store
// itself sells coffee (see commerce-taste.test.ts).
const groundInCatalog = (observed: Parameters<typeof groundIn>[0]) => groundIn(observed, CATALOG);
const shoppingOptions = (context: ScanContext, input: Parameters<typeof optionsFor>[1]) => optionsFor(context, input, CATALOG);
const approve = (store: OrderStore, provider: PaymentProvider, input: Parameters<typeof approveOrder>[2]) => approveOrder(store, provider, { catalog: CATALOG, ...input });

const wingspanPhoto = { item: "Wingspan (Stonemaier Games)", category: "board game", specificity: "exact_title" as const, searchTerms: ["Wingspan"], visibleText: ["WINGSPAN"] };
const context: ScanContext = {
  observed: wingspanPhoto,
  connection: { personId: "maya", relation: "planned_together", caveats: [] },
  advice: [
    { personId: "noah", basis: "owns", favorable: true, caution: false, mention: "Wingspan", message: "Noah has one and spoke well of it." },
    { personId: "priya", basis: "dislikes", favorable: false, caution: true, mention: "Wingspan", message: "Priya didn't like it. Worth hearing why." },
  ],
};
const together = { kind: "together" as const, personId: "maya" };

describe("catalog", () => {
  it("does money in integer cents with half-up tax and a free-shipping threshold", () => {
    expect(totalsFor(CATALOG.find((p) => p.id === "wingspan-base")!)).toEqual({ subtotalCents: 6500, shippingCents: 599, taxCents: 455, totalCents: 7554, currency: "usd" });
    expect(totalsFor(CATALOG.find((p) => p.id === "fujifilm-x100v")!)).toMatchObject({ shippingCents: 0, taxCents: 9793, totalCents: 149693 });
  });

  it("grounds the photo: same product, same family, and a similar alternative stay distinct", () => {
    const matches = Object.fromEntries(groundInCatalog(wingspanPhoto).map((item) => [item.product.id, item.match]));
    expect(matches).toMatchObject({ "wingspan-base": "same", "wingspan-asia": "family", "wingspan-european": "family", wyrmspan: "similar" });
    expect(matches["fujifilm-x100v"]).toBeUndefined();
  });

  it("does not ground the base game as the same item when the photo shows Wingspan Asia", () => {
    const matches = Object.fromEntries(groundInCatalog({ ...wingspanPhoto, item: "Wingspan Asia", searchTerms: ["Wingspan Asia"] }).map((item) => [item.product.id, item.match]));
    expect(matches).toMatchObject({ "wingspan-asia": "same", "wingspan-base": "family" });
  });

  it("keeps a different camera edition out of 'same', and a family-level photo out of 'same' entirely", () => {
    expect(Object.fromEntries(groundInCatalog({ item: "Fujifilm X100V", specificity: "exact_title", searchTerms: ["X100V"] }).map((item) => [item.product.id, item.match]))).toEqual({ "fujifilm-x100v": "same", "fujifilm-x100vi": "family" });
    expect(groundInCatalog({ item: "Fujifilm X100-series camera", specificity: "product_family" }).every((item) => item.match === "family")).toBe(true);
  });
});

describe("shopping options", () => {
  it("puts complete games first for a shared plan, excludes out-of-stock and over-budget items, and shows at most three", () => {
    const result = shoppingOptions(context, { budgetCents: 8000, purpose: together });
    expect(result.options.map((option) => option.productId)).toEqual(["wingspan-base", "wingspan-asia", "wyrmspan"]);
    expect(result.excluded.map((item) => item.productId)).toContain("wingspan-oceania");
    expect(result.personalization[0]).toMatch(/Maya planned to play it with you/);
  });

  it("enforces the budget on the total with shipping and tax, not the sticker price", () => {
    const result = shoppingOptions(context, { budgetCents: 7500, purpose: { kind: "self" } });
    expect(result.options.map((option) => option.productId)).not.toContain("wingspan-base");
    expect(result.excluded.find((item) => item.productId === "wingspan-base")?.why).toMatch(/\$75\.54 .* over your \$75\.00 budget/);
  });

  it("attaches a friend's note only to the product their words name, and shows a dislike as a caution", () => {
    const base = shoppingOptions(context, { budgetCents: 10000, purpose: { kind: "self" } }).options.find((option) => option.productId === "wingspan-base")!;
    const asia = shoppingOptions(context, { budgetCents: 10000, purpose: { kind: "self" } }).options.find((option) => option.productId === "wingspan-asia")!;
    expect(base.reasons).toContain("Noah has one and spoke well of it.");
    expect(base.tradeoffs.some((line) => line.startsWith("Priya didn't like it."))).toBe(true);
    expect(asia.reasons.join(" ")).not.toMatch(/Noah/);
  });

  it("only offers purposes the scan supports", () => {
    expect(() => shoppingOptions(context, { budgetCents: 8000, purpose: { kind: "gift", personId: "maya" } })).toThrow(/purpose/);
    expect(() => shoppingOptions(context, { budgetCents: 8000, purpose: { kind: "together", personId: "noah" } })).toThrow(/purpose/);
    expect(() => shoppingOptions(context, { budgetCents: 80.5, purpose: together })).toThrow(/cents/);
  });

  it("does not apply a note about Wingspan Asia to the base game", () => {
    const result = shoppingOptions({ ...context, advice: [{ ...context.advice[0], mention: "Wingspan Asia", message: "Noah tried Asia." }] }, { budgetCents: 8000, purpose: { kind: "self" } });
    expect(result.options.find((item) => item.productId === "wingspan-base")?.reasons).not.toContain("Noah tried Asia.");
    expect(result.options.find((item) => item.productId === "wingspan-asia")?.reasons).toContain("Noah tried Asia.");
  });

  it("prioritizes complete games for playing together even when the photo is an expansion", () => {
    const result = shoppingOptions({ ...context, observed: { ...wingspanPhoto, item: "Wingspan European Expansion" } }, { budgetCents: 8000, purpose: together });
    expect(result.options[0].productId).toBe("wingspan-base");
    const filtered = shoppingOptions(context, { budgetCents: 8000, purpose: together, preference: "expansion" });
    expect(filtered.options[0].productId).toBe("wingspan-european");
    expect(filtered.options[0].tradeoffs.join(" ")).toMatch(/Needs Wingspan/);
  });
});

// ---- Orders with an in-memory store and a fake provider ----

function memoryStore() {
  const orders = new Map<string, Order>();
  const events = new Set<string>();
  let next = 0;
  const store: OrderStore = {
    async get(id, ownerId) { const order = orders.get(id); return order && (!ownerId || order.owner_id === ownerId) ? { ...order } : null; },
    async getBySession(sessionId) { const order = [...orders.values()].find((item) => item.checkout_session_id === sessionId); return order ? { ...order } : null; },
    async getByRequest(ownerId, key) { const order = [...orders.values()].find((item) => item.owner_id === ownerId && item.client_request_id === key); return order ? { ...order } : null; },
    async insert(order) { const saved = { ...order, id: `order-${++next}` }; orders.set(saved.id, saved); return { ...saved }; },
    async transition(id, from, patch) { const order = orders.get(id); if (!order || !from.includes(order.status)) return null; Object.assign(order, patch); return { ...order }; },
    async recordEvent(eventId) { if (events.has(eventId)) return false; events.add(eventId); return true; },
  };
  return { store, orders };
}
function fakeProvider(session: Partial<CheckoutSession> = {}) {
  let current: CheckoutSession = { id: "cs_test_1", status: "open", paymentStatus: "unpaid", amountTotal: 7554, currency: "usd", livemode: false, orderId: "order-1", ...session };
  const provider: PaymentProvider & { set(update: Partial<CheckoutSession>): void } = {
    name: "stripe_test",
    createCheckout: vi.fn(async () => ({ id: current.id, url: "https://checkout.stripe.test/cs_test_1" })),
    retrieve: vi.fn(async () => ({ ...current })),
    expire: vi.fn(async () => { current = { ...current, status: "expired" }; }),
    set(update) { current = { ...current, ...update }; },
  };
  return provider;
}
const quote = (store: OrderStore, extra: Partial<Parameters<typeof createQuote>[1]> = {}) => createQuote(store, { ownerId: "alex", scanId: "scan-1", context, productId: "wingspan-base", budgetCents: 8000, purpose: together, clientRequestId: "req-1", now: new Date("2026-09-26T12:00:00Z"), catalog: CATALOG, ...extra });
const at = (minutes: number) => new Date(Date.parse("2026-09-26T12:00:00Z") + minutes * 60_000);

describe("orders", () => {
  it("quotes a filtered option outside the default top three and binds retries to that preference", async () => {
    const { store } = memoryStore();
    const input = { productId: "wingspan-nesting-box", preference: "accessory" as const };
    const order = await quote(store, input);
    expect(order).toMatchObject({ product_id: input.productId, preference: "accessory" });
    expect((await quote(store, input)).id).toBe(order.id);
    await expect(quote(store, { productId: input.productId })).rejects.toThrow(/different quote/);
  });

  it("refuses a conflicting quote returned by a concurrent insert", async () => {
    const { store } = memoryStore();
    const winner = await quote(store);
    store.getByRequest = async () => null;
    store.insert = async () => winner;
    await expect(quote(store, { productId: "wingspan-asia" })).rejects.toThrow(/different quote/);
  });

  it("refreshes the displayed variant when the catalog changed without changing the price", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    const catalog = CATALOG.map((product) => product.id === "wingspan-base" ? { ...product, variant: "New printing" } : product);
    const result = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1), catalog });
    expect(result).toMatchObject({ kind: "changed", order: { variant: "New printing", total_cents: 7554 } });
    expect(provider.createCheckout).not.toHaveBeenCalled();
  });
  it("quotes only server-offered options, idempotently per request", async () => {
    const { store } = memoryStore();
    const order = await quote(store);
    expect(order).toMatchObject({ status: "quoted", total_cents: 7554, merchant: "Callback Demo Store" });
    expect((await quote(store)).id).toBe(order.id);
    await expect(quote(store, { productId: "wingspan-asia" })).rejects.toThrow(/different quote/);
    await expect(quote(store, { clientRequestId: "req-2", productId: "fujifilm-x100v" })).rejects.toThrow(/isn't available/);
    await expect(quote(store, { clientRequestId: "req-3", productId: "wingspan-oceania" })).rejects.toThrow(/isn't available/);
  });

  it("approves the exact total once; a repeated click reuses the same checkout", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    const first = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1) });
    const again = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1) });
    expect(first).toMatchObject({ kind: "redirect", url: "https://checkout.stripe.test/cs_test_1" });
    expect(again.kind).toBe("redirect");
    expect(provider.createCheckout).toHaveBeenCalledOnce();
    expect(provider.retrieve).toHaveBeenCalledOnce();
    expect(vi.mocked(provider.createCheckout).mock.calls[0][2]).toBe(`callback-order-${order.id}-7554`);
  });

  it("reconciles a pending checkout before reusing its URL", async () => {
    for (const session of [
      { status: "expired", paymentStatus: "unpaid", expectedKind: "expired", expectedStatus: "expired" },
      { status: "complete", paymentStatus: "paid", expectedKind: "done", expectedStatus: "paid_test" },
    ]) {
      const { store } = memoryStore(); const provider = fakeProvider();
      const order = await quote(store);
      await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1) });
      provider.set({ status: session.status, paymentStatus: session.paymentStatus });
      const retry = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(2) });
      expect(retry).toMatchObject({ kind: session.expectedKind, order: { status: session.expectedStatus } });
      expect(provider.createCheckout).toHaveBeenCalledOnce();
    }
  });

  it("does not reuse a checkout if the open provider session differs from the approved order", async () => {
    for (const mismatch of [{ amountTotal: 100 }, { orderId: "another-order" }]) {
      const { store } = memoryStore(); const provider = fakeProvider();
      const order = await quote(store);
      await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1) });
      provider.set(mismatch);
      const retry = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(2) });
      expect(retry).toMatchObject({ kind: "unavailable", order: { status: "failed" } });
      expect(provider.createCheckout).toHaveBeenCalledOnce();
    }
  });

  it("does not redirect back to a complete session while payment is pending", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1) });
    provider.set({ status: "complete", paymentStatus: "unpaid" });
    const retry = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(2) });
    expect(retry).toMatchObject({ kind: "unavailable", order: { status: "checkout_pending", status_detail: expect.stringMatching(/still processing/) } });
    expect(provider.retrieve).toHaveBeenCalledOnce();
    expect(provider.createCheckout).toHaveBeenCalledOnce();
  });

  it("requires fresh approval when the price changed or the shopper saw a different total", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    const repriced: Product[] = CATALOG.map((product) => (product.id === "wingspan-base" ? { ...product, priceCents: 6800 } : product));
    const changed = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(1), catalog: repriced });
    expect(changed.kind).toBe("changed");
    expect(changed.order).toMatchObject({ status: "quoted", total_cents: 6800 + 599 + 476 });
    expect(provider.createCheckout).not.toHaveBeenCalled();
    const stale = await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "https://app.test", now: at(2), catalog: repriced });
    expect(stale.kind).toBe("changed");
    expect((await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7875, origin: "https://app.test", now: at(2), catalog: repriced })).kind).toBe("redirect");
  });

  it("refuses expired quotes, other owners' orders, and returns to review if checkout can't start", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await expect(approve(store, provider, { ownerId: "mallory", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) })).rejects.toThrow(/not found/);
    expect((await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(16) })).kind).toBe("expired");
    const second = await quote(store, { clientRequestId: "req-9" });
    vi.mocked(provider.createCheckout).mockRejectedValueOnce(new Error("network"));
    await expect(approve(store, provider, { ownerId: "alex", orderId: second.id, expectedTotalCents: 7554, origin: "x", now: at(1) })).rejects.toThrow(/Nothing was charged/);
    expect((await store.get(second.id))?.status).toBe("quoted");
  });

  it("never marks paid from a return visit alone; only a complete, paid, matching test session", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    expect((await verifyCheckout(store, provider, "cs_test_1"))?.status).toBe("checkout_pending");
    provider.set({ status: "complete", paymentStatus: "paid" });
    expect((await verifyCheckout(store, provider, "cs_test_1"))?.status).toBe("paid_test");
  });

  it("fails on an amount mismatch or a live-mode session", async () => {
    for (const bad of [{ amountTotal: 100 }, { livemode: true }]) {
      const { store } = memoryStore(); const provider = fakeProvider({ status: "complete", paymentStatus: "paid", ...bad });
      const order = await quote(store);
      await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
      expect((await verifyCheckout(store, provider, "cs_test_1"))?.status).toBe("failed");
    }
  });

  it("handles duplicate and concurrent webhook deliveries without double-processing", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    provider.set({ status: "complete", paymentStatus: "paid" });
    const event = { id: "evt_1", type: "checkout.session.completed", sessionId: "cs_test_1" };
    const [a, b] = await Promise.all([handleProviderEvent(store, provider, event), handleProviderEvent(store, provider, event)]);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect((await store.get(order.id))?.status).toBe("paid_test");
  });

  it("records a declined async payment and an expired session without a paid state", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    provider.set({ status: "complete", paymentStatus: "unpaid" });
    expect((await handleProviderEvent(store, provider, { id: "evt_f", type: "checkout.session.async_payment_failed", sessionId: "cs_test_1" })).order?.status).toBe("failed");
    const second = memoryStore(); const expiring = fakeProvider();
    const other = await quote(second.store);
    await approve(second.store, expiring, { ownerId: "alex", orderId: other.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    expiring.set({ status: "expired" });
    expect((await handleProviderEvent(second.store, expiring, { id: "evt_e", type: "checkout.session.expired", sessionId: "cs_test_1" })).order?.status).toBe("expired");
  });

  it("does not let a stale async failure replace a paid or still-open checkout", async () => {
    for (const state of [
      { status: "complete", paymentStatus: "paid", expected: "paid_test" },
      { status: "open", paymentStatus: "unpaid", expected: "checkout_pending" },
    ]) {
      const { store } = memoryStore(); const provider = fakeProvider();
      const order = await quote(store);
      await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
      provider.set({ status: state.status, paymentStatus: state.paymentStatus });
      const event = { id: "evt_stale", type: "checkout.session.async_payment_failed", sessionId: "cs_test_1" };
      expect((await handleProviderEvent(store, provider, event)).order?.status).toBe(state.expected);
      expect((await store.get(order.id))?.status).toBe(state.expected);
      expect(provider.retrieve).toHaveBeenCalledOnce();
    }
  });

  it("keeps an already verified payment paid after a late failure event", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    provider.set({ status: "complete", paymentStatus: "paid" });
    await verifyCheckout(store, provider, "cs_test_1");
    provider.set({ status: "complete", paymentStatus: "unpaid" });
    expect((await handleProviderEvent(store, provider, { id: "evt_late_failure", type: "checkout.session.async_payment_failed", sessionId: "cs_test_1" })).order?.status).toBe("paid_test");
    expect((await store.get(order.id))?.status).toBe("paid_test");
  });

  it("lets a later verified paid event correct an earlier async failure", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    provider.set({ status: "complete", paymentStatus: "unpaid" });
    expect((await handleProviderEvent(store, provider, { id: "evt_failure", type: "checkout.session.async_payment_failed", sessionId: "cs_test_1" })).order?.status).toBe("failed");
    provider.set({ status: "complete", paymentStatus: "paid" });
    expect((await handleProviderEvent(store, provider, { id: "evt_paid", type: "checkout.session.completed", sessionId: "cs_test_1" })).order?.status).toBe("paid_test");
    expect((await store.get(order.id))?.status).toBe("paid_test");
  });

  it("cancelling checks the provider first, so a completed payment is never shown as cancelled", async () => {
    const { store } = memoryStore(); const provider = fakeProvider();
    const order = await quote(store);
    await approve(store, provider, { ownerId: "alex", orderId: order.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    provider.set({ status: "complete", paymentStatus: "paid" });
    expect((await cancelOrder(store, provider, { ownerId: "alex", orderId: order.id }))?.status).toBe("paid_test");
    expect(provider.expire).not.toHaveBeenCalled();
    const fresh = memoryStore(); const open = fakeProvider();
    const pending = await quote(fresh.store);
    await approve(fresh.store, open, { ownerId: "alex", orderId: pending.id, expectedTotalCents: 7554, origin: "x", now: at(1) });
    expect((await cancelOrder(fresh.store, open, { ownerId: "alex", orderId: pending.id }))?.status).toBe("expired");
  });
});
