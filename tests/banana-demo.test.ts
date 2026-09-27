import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANANA_CART, createPrepareToken, createScanToken, placeBananaTestOrder, preparationFromToken, verifyToken } from "../src/lib/banana-demo";

const prepared = {
  relation: "planned_together" as const,
  sourceId: "banana-demo-alan-2026-09-12",
  triggerIngredient: "ripe banana",
  connection: "Alan suggested making banana bread together.",
  steps: ["Mash three ripe bananas in a bowl.", "Mix in the remaining ingredients.", "Bake until cooked through."],
  timeMinutes: 60,
};

describe("banana demo payment boundary", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("requires a scan token; a preparation token cannot place an order", async () => {
    const prepareToken = createPrepareToken(prepared, "muse-spark-1.3");
    expect(preparationFromToken(prepareToken)?.memory.personName).toBe("Alan");
    expect(verifyToken(prepareToken, "scan")).toBeNull();
    await expect(placeBananaTestOrder(prepareToken)).rejects.toThrow("confirmed scan expired");
  });

  it("rejects altered and expired scan tokens before payment", async () => {
    const sessionId = createScanToken();
    expect(verifyToken(sessionId, "scan")?.bananaConfirmed).toBe(true);
    const [payload, signature] = sessionId.split(".");
    const tampered = `${payload.slice(0, -1)}${payload.at(-1) === "A" ? "B" : "A"}.${signature}`;
    expect(verifyToken(tampered, "scan")).toBeNull();
    await expect(placeBananaTestOrder(tampered)).rejects.toThrow("confirmed scan expired");
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(verifyToken(sessionId, "scan")).toBeNull();
  });

  it("keeps the signed test charge equal to the displayed ingredient total", () => {
    expect(BANANA_CART.totalCents).toBe(BANANA_CART.items.reduce((sum, item) => sum + item.priceCents, 0) + BANANA_CART.shippingCents + BANANA_CART.taxCents);
    expect(BANANA_CART.mode).toBe("stripe_test");
    expect(BANANA_CART.deliveryLabel).toMatch(/no shipment/i);
  });
});
