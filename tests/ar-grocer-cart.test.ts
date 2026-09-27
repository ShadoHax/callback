import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { IngredientOffer } from "../src/lib/ar-shopping-discovery";
import type { Offer } from "../src/lib/commerce/discovery";

const stripe = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn() }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create: stripe.create, retrieve: stripe.retrieve } }; } }));
import { buildGrocerCarts, createGrocerCheckout, getGrocerCheckoutStatus, recognizedGrocer, verifyGrocerCartQuote } from "../src/lib/ar-grocer-cart";

const owner = "owner-123";
function offer(merchant: string, cents: number, title = "Organic flour", url = "https://www.walmart.com/ip/flour", provider = "searchapi"): Offer {
  return { id: `${merchant}-${cents}`, title, merchant, merchantUrl: url, imageUrl: null,
    price: { amountCents: cents, currency: "USD", observedAt: new Date().toISOString() },
    availability: "unknown", match: "family", reasons: [], caveats: [], source: { provider, position: 0 } };
}
function ingredient(query: string, quantity: number, offers: Offer[]): IngredientOffer {
  return { kind: "ingredient", query, requestedQuery: query, quantity, reason: "Recipe", offers,
    fallbackSearchUrl: "https://www.google.com/search?tbm=shop", status: "ok", provider: "searchapi" };
}
function ingredients() {
  return [ingredient("flour", 2, [offer("Walmart", 350), offer("Walmart.com", 289), offer("Kroger", 250, "Flour", "https://www.kroger.com/p/flour")]),
    ingredient("milk", 3, [offer("Walmart", 199, "Milk", "https://www.walmart.com/ip/milk"),
      offer("Kroger", 220, "Milk", "https://www.kroger.com/p/milk")])];
}

beforeEach(() => {
  vi.stubEnv("PREVIEW_SIGNING_SECRET", "grocer-test-secret-that-is-long-enough-to-sign");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123456789");
  stripe.create.mockReset();
  stripe.retrieve.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("chooses the cheapest observed offer per requirement within each complete grocer cart", () => {
  const carts = buildGrocerCarts(ingredients(), owner);
  expect(carts.map((cart) => cart.merchant)).toEqual(["Kroger", "Walmart"]);
  const walmart = carts.find((cart) => cart.merchant === "Walmart")!;
  expect(walmart.items.map((item) => [item.unitPriceCents, item.quantity, item.lineTotalCents])).toEqual([[289, 2, 578], [199, 3, 597]]);
  expect(walmart.subtotalCents).toBe(1175);
  expect(walmart.items.map((item) => item.priceSource)).toEqual(["live", "live"]);
  expect(verifyGrocerCartQuote(walmart.checkoutToken, owner, 1175)?.items).toEqual(walmart.items);
});

it("labels persisted SearchApi listings as cached in the signed cart", () => {
  const cart = buildGrocerCarts([ingredient("flour", 1, [offer("Walmart", 289, "Flour",
    "https://www.walmart.com/ip/flour", "searchapi-cache")])], owner)[0];
  expect(cart.items[0].priceSource).toBe("cached");
  expect(verifyGrocerCartQuote(cart.checkoutToken, owner, cart.subtotalCents)?.items[0].priceSource).toBe("cached");
});

it("rejects partial carts, mixed merchants, ambiguous seller names, and mismatched domains", () => {
  const onlyOne = [ingredient("flour", 1, [offer("Walmart", 200)]), ingredient("milk", 1, [])];
  expect(buildGrocerCarts(onlyOne, owner)).toEqual([]);
  const mixed = [ingredient("flour", 1, [offer("Walmart", 200)]),
    ingredient("milk", 1, [offer("Kroger", 250, "Milk", "https://www.kroger.com/p/milk")])];
  expect(buildGrocerCarts(mixed, owner)).toEqual([]);
  expect(buildGrocerCarts([ingredient("flour", 1, [offer("Walmart - Marketplace Seller", 200)])], owner)).toEqual([]);
  expect(buildGrocerCarts([ingredient("flour", 1, [offer("Walmart", 200, "Flour", "https://www.example.com/item")])], owner)).toEqual([]);
  expect(recognizedGrocer(offer("Hy-Vee", 200, "Flour", "https://www.google.com/search?ibp=oshop"))).toBe("Hy-Vee");
});

it("binds quote to owner, exact total, signature, and expiry", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
  const cart = buildGrocerCarts(ingredients(), owner).find((item) => item.merchant === "Walmart")!;
  expect(verifyGrocerCartQuote(cart.checkoutToken, "another-owner", cart.subtotalCents)).toBeNull();
  expect(verifyGrocerCartQuote(cart.checkoutToken, owner, cart.subtotalCents + 1)).toBeNull();
  const [body, mac] = cart.checkoutToken.split(".");
  expect(verifyGrocerCartQuote(`${body.slice(0, -1)}A.${mac}`, owner, cart.subtotalCents)).toBeNull();
  vi.advanceTimersByTime(10 * 60_000);
  expect(verifyGrocerCartQuote(cart.checkoutToken, owner, cart.subtotalCents)).toBeNull();
});

it("creates only a Stripe TEST checkout with real per-item prices and quote idempotency", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-27T10:00:00Z"));
  const cart = buildGrocerCarts(ingredients(), owner).find((item) => item.merchant === "Walmart")!;
  stripe.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/test", livemode: false,
    amount_total: cart.subtotalCents, currency: "usd" });
  const input = { checkoutToken: cart.checkoutToken, ownerId: owner, expectedTotalCents: cart.subtotalCents, origin: "https://callback.example" };
  expect(await createGrocerCheckout(input)).toEqual({ checkoutUrl: "https://checkout.stripe.com/c/pay/test" });
  const [params, options] = stripe.create.mock.calls[0];
  expect(params.line_items.map((line: { quantity: number; price_data: { unit_amount: number } }) => [line.quantity, line.price_data.unit_amount]))
    .toEqual([[2, 289], [3, 199]]);
  expect(params.metadata.fulfillment).toBe("not_created");
  expect(params.success_url).toContain("/ar?grocer_checkout=success");
  expect(params.line_items).toHaveLength(2);
  expect(options.idempotencyKey).toMatch(/^ar-grocer-[a-f0-9]{64}$/);
  vi.advanceTimersByTime(60_000);
  await createGrocerCheckout(input);
  expect(stripe.create.mock.calls[1]).toEqual(stripe.create.mock.calls[0]);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_123456789");
  await expect(createGrocerCheckout(input)).rejects.toThrow("TEST mode");
  expect(stripe.create).toHaveBeenCalledTimes(2);
});

it("confirms only the signed-in owner's TEST session and reports actual payment state", async () => {
  const session = { livemode: false, mode: "payment", currency: "usd", amount_total: 1175,
    payment_status: "paid", status: "complete", metadata: { demo: "ar_grocer", owner_id: owner,
      fulfillment: "not_created", merchant: "Walmart", listing_subtotal_cents: "1175" } };
  stripe.retrieve.mockResolvedValue(session);
  expect(await getGrocerCheckoutStatus("cs_test_123", owner)).toEqual({ paid: true, merchant: "Walmart", subtotalCents: 1175 });
  expect(await getGrocerCheckoutStatus("cs_test_123", "another-owner")).toBeNull();
  stripe.retrieve.mockResolvedValue({ ...session, livemode: true });
  expect(await getGrocerCheckoutStatus("cs_test_123", owner)).toBeNull();
});
