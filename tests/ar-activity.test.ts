import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stripeCreate: vi.fn(), modelCall: vi.fn() }));
vi.mock("stripe", () => ({ default: class { paymentIntents = { create: mocks.stripeCreate }; } }));
vi.mock("../src/lib/model", () => ({ structuredCall: mocks.modelCall,
  modelDisplayConfig: () => ({ provider: "meta", model: "muse-spark-1.3", visionModel: "muse-spark-1.1" }) }));

import {
  nearbyMapsSearch, planArActivity, placeArActivityTestOrder, signArActivityCart, signArConnection,
  verifyArActivityCart, verifyArConnection,
} from "../src/lib/ar-activity";
import { priceActivityCart } from "../src/lib/ar-activity-catalog";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherOwnerId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const corpusRevision = "a".repeat(64);
const identification = { item: "a visible object", category: "object", specificity: "category" as const,
  visibleText: [], searchTerms: [], ambiguity: "" };
const source = { id: sourceId, speaker_id: "friend", thread_id: "thread-1", participant_ids: ["friend", "owner"],
  original_text: "Let's make something together this weekend.", source_at: "2026-09-25T12:00:00Z", is_synthetic: true };

describe("grounded AR activity and TEST cart", () => {
  beforeEach(() => {
    vi.stubEnv("PREVIEW_SIGNING_SECRET", "activity-test-secret-that-is-long-enough-to-sign");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    mocks.modelCall.mockReset();
    mocks.stripeCreate.mockReset();
    mocks.stripeCreate.mockImplementation(async (params: { amount: number; currency: string }) => ({
      id: "pi_test_activity", status: "succeeded", amount: params.amount, currency: params.currency, livemode: false,
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("binds the connection to its owner, cited sources, image identity, and expiry", () => {
    const token = signArConnection({ ownerId, identification, sourceIds: [sourceId], personId: "friend", corpusRevision });
    expect(verifyArConnection(token, ownerId)?.identification.item).toBe("a visible object");
    expect(verifyArConnection(token, otherOwnerId)).toBeNull();
    const [body, mac] = token.split(".");
    expect(verifyArConnection(`${body.slice(0, -1)}A.${mac}`, ownerId)).toBeNull();
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(verifyArConnection(token, ownerId)).toBeNull();
  });

  it("accepts only catalog SKUs and calculates the shown TEST total on the server", () => {
    const cart = priceActivityCart([{ sku: "flour", quantity: 1 }, { sku: "eggs", quantity: 2 }]);
    expect(cart.totalCents).toBe(cart.subtotalCents + cart.shippingCents + cart.taxCents);
    expect(cart.mode).toBe("stripe_test");
    expect(() => priceActivityCart([{ sku: "invented-product", quantity: 1 }])).toThrow(/unavailable/);
    expect(() => priceActivityCart([{ sku: "flour", quantity: 1 }, { sku: "flour", quantity: 1 }])).toThrow(/unavailable/);
  });

  it("rejects invented citations and withholds checkout for unsupported plans or SKUs", async () => {
    mocks.modelCall.mockResolvedValueOnce({ value: { supported: false, title: "", summary: "", steps: [], invitation: "", nearbyQuery: "", supportSourceIds: [], items: [] }, model: "fixture", ms: 1 });
    await expect(planArActivity({ identification, sources: [source], personId: "friend" })).resolves.toMatchObject({ supported: false, action: "shop" });
    expect(mocks.modelCall.mock.calls[0][0].modelOverride).toBe("muse-spark-1.1");
    const supported = { supported: true, title: "Meet up", summary: "The message proposes doing this together.",
      steps: ["Agree on a time together.", "Bring the needed supplies."], invitation: "Want to do this together?", nearbyQuery: "", supportSourceIds: [sourceId], items: [{ sku: "notebook", quantity: 1, reason: "Useful for the activity." }] };
    mocks.modelCall.mockResolvedValueOnce({ value: { ...supported, supportSourceIds: [otherOwnerId] }, model: "fixture", ms: 1 });
    await expect(planArActivity({ identification, sources: [source], personId: "friend" })).rejects.toThrow(/grounded/);
    mocks.modelCall.mockResolvedValueOnce({ value: { ...supported, items: [{ sku: "made-up", quantity: 1, reason: "No stock." }] }, model: "fixture", ms: 1 });
    await expect(planArActivity({ identification, sources: [source], personId: "friend" })).resolves.toMatchObject({ supported: true, selections: [], shoppingNote: expect.any(String) });
  });

  it("only the explicit shop action can return cart selections", async () => {
    const value = { supported: true, title: "Make something", summary: "A shared activity from the cited message.",
      steps: ["Measure the materials.", "Complete the activity together."], invitation: "Want to do this together?",
      nearbyQuery: "", supportSourceIds: [sourceId], items: [{ sku: "flour", quantity: 1, reason: "A proposed supply." }] };
    for (const action of ["recipe", "plan"] as const) {
      mocks.modelCall.mockResolvedValueOnce({ value: { ...value, invitation: action === "recipe" ? "" : value.invitation }, model: "fixture", ms: 1 });
      const result = await planArActivity({ identification, sources: [source], personId: "friend", action });
      expect(result).toMatchObject({ supported: true, action, selections: [] });
      expect(mocks.modelCall.mock.calls.at(-1)?.[0].content).not.toContain("testCatalog");
    }
    mocks.modelCall.mockResolvedValueOnce({ value, model: "fixture", ms: 1 });
    await expect(planArActivity({ identification, sources: [source], personId: "friend", action: "shop" }))
      .resolves.toMatchObject({ supported: true, action: "shop", selections: [{ sku: "flour", quantity: 1 }] });
  });

  it("builds only a categorical HTTPS Maps search for nearby", async () => {
    mocks.modelCall.mockResolvedValueOnce({ value: { supported: true, title: "Find a place", summary: "Related to the cited activity.",
      steps: [], invitation: "", nearbyQuery: "creative workshops", supportSourceIds: [sourceId],
      items: [{ sku: "flour", quantity: 1, reason: "Ignored for nearby." }] }, model: "fixture", ms: 1 });
    const result = await planArActivity({ identification, sources: [source], personId: "friend", action: "nearby" });
    expect(result).toMatchObject({ supported: true, action: "nearby", supportSourceIds: [sourceId], nearby: { query: "creative workshops near me" } });
    if (!result.supported || result.action !== "nearby") throw new Error("Expected nearby result.");
    expect(result.nearby.url).toBe("https://www.google.com/maps/search/?api=1&query=creative+workshops+near+me");
    expect(result).not.toHaveProperty("selections");
    expect(() => nearbyMapsSearch("https://example.com/venue")).toThrow(/grounded/);
  });

  it("charges only the signed server cart after matching the reviewed amount", async () => {
    const { cart, checkoutToken } = signArActivityCart({ ownerId, corpusRevision, sourceIds: [sourceId], selections: [{ sku: "coffee-light-whole", quantity: 1 }] });
    expect(verifyArActivityCart(checkoutToken, otherOwnerId, cart.totalCents)).toBeNull();
    expect(verifyArActivityCart(checkoutToken, ownerId, cart.totalCents + 1)).toBeNull();
    await expect(placeArActivityTestOrder({ checkoutToken, ownerId, expectedTotalCents: cart.totalCents + 1 })).rejects.toThrow(/expired or changed/);
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
    const order = await placeArActivityTestOrder({ checkoutToken, ownerId, expectedTotalCents: cart.totalCents });
    expect(mocks.stripeCreate.mock.calls[0][0]).toMatchObject({ amount: cart.totalCents, currency: "usd", payment_method: "pm_card_visa", confirm: true });
    expect(order.receipt.amountCents).toBe(cart.totalCents);
    expect(order.receipt.livemode).toBe(false);
  });
});
