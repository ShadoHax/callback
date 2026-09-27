import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stripeCreate = vi.hoisted(() => vi.fn());
vi.mock("stripe", () => ({ default: class {
  paymentIntents = { create: stripeCreate };
} }));

import { BANANA_CART, BANANA_CART_REVISION, createPrepareToken, createScanToken, verifyToken } from "../src/lib/banana-demo";
import {
  COFFEE_CART, COFFEE_CART_REVISION, COFFEE_SOURCES, createArPrepareEnvelope, createCoffeePrepareToken,
  createCoffeeScanToken, parseArPrepareEnvelope, placeArTestOrder, preparedForArScan, verifyCoffeeToken,
} from "../src/lib/ar-demo";

const bananaPrep = {
  relation: "planned_together" as const, sourceId: "banana-demo-alan-2026-09-12", triggerIngredient: "banana",
  connection: "Alan suggested making banana bread together.",
  steps: ["Mash three ripe bananas in a bowl.", "Mix in the remaining ingredients.", "Bake until cooked through."],
  timeMinutes: 60,
};
const coffeePrep = {
  relation: "planned_together" as const, planSourceId: COFFEE_SOURCES[0].id, preferenceSourceId: COFFEE_SOURCES[1].id,
  connection: "Alan proposed catching up over coffee together.",
  preferenceFit: "Light-roast whole-bean coffee matches Alan's stated preference.",
  steps: ["Ask Alan when he is free for coffee.", "Bring the beans if a gift feels right."],
};

function signAlteredCoffeeToken(raw: string, updates: object) {
  const payload = JSON.parse(Buffer.from(raw.split(".")[0], "base64url").toString("utf8"));
  const encoded = Buffer.from(JSON.stringify({ ...payload, ...updates })).toString("base64url");
  const signature = createHmac("sha256", "sk_test_fixture").update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

describe("two-scenario AR demo payment boundary", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
    stripeCreate.mockReset();
    stripeCreate.mockImplementation(async (params: { amount: number; currency: string }) => ({
      id: "pi_test_ar", amount: params.amount, currency: params.currency, livemode: false, status: "succeeded",
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("binds each prepared story to its own signed token and retains synthetic source evidence", () => {
    const bananaToken = createPrepareToken(bananaPrep, "muse-spark-1.3");
    const coffeeToken = createCoffeePrepareToken(coffeePrep, "muse-spark-1.3");
    const envelope = createArPrepareEnvelope(bananaToken, coffeeToken);
    expect(parseArPrepareEnvelope(envelope)).toEqual({ bananaPrepareToken: bananaToken, coffeePrepareToken: coffeeToken });
    expect(preparedForArScan("banana", coffeeToken)).toBeNull();
    expect(preparedForArScan("coffee", bananaToken)).toBeNull();
    const coffee = preparedForArScan("coffee", coffeeToken);
    expect(coffee?.memory.personName).toBe("Alan");
    expect(coffee?.memory.sources.every((source) => source.synthetic)).toBe(true);
    expect(coffee?.plan.preferenceFit).toMatch(/light-roast whole-bean/i);
  });

  it("rejects ungrounded preparation and tokens with changed cart totals", () => {
    const coffeeToken = createCoffeePrepareToken(coffeePrep, "muse-spark-1.3");
    const ungrounded = signAlteredCoffeeToken(coffeeToken, { preparation: { ...coffeePrep, preferenceSourceId: "made-up" } });
    expect(verifyCoffeeToken(ungrounded, "prepare")).toBeNull();
    const wrongCart = signAlteredCoffeeToken(coffeeToken, { cartRevision: BANANA_CART_REVISION, amountCents: BANANA_CART.totalCents });
    expect(verifyCoffeeToken(wrongCart, "prepare")).toBeNull();
    expect(COFFEE_CART_REVISION).not.toBe(BANANA_CART_REVISION);
  });

  it("requires a scenario-matched confirmed scan before test payment", async () => {
    const coffeePrepareToken = createCoffeePrepareToken(coffeePrep, "muse-spark-1.3");
    await expect(placeArTestOrder(coffeePrepareToken)).rejects.toThrow(/confirmed scan expired/);
    expect(stripeCreate).not.toHaveBeenCalled();

    const bananaScan = createScanToken();
    const coffeeScan = createCoffeeScanToken();
    expect(verifyToken(coffeeScan, "scan")).toBeNull();
    expect(verifyCoffeeToken(bananaScan, "scan")).toBeNull();
    const bananaOrder = await placeArTestOrder(bananaScan);
    const coffeeOrder = await placeArTestOrder(coffeeScan);
    expect(stripeCreate.mock.calls.map(([params]) => params.amount)).toEqual([BANANA_CART.totalCents, COFFEE_CART.totalCents]);
    expect(bananaOrder.receipt.amountCents).toBe(BANANA_CART.totalCents);
    expect(coffeeOrder.receipt.amountCents).toBe(COFFEE_CART.totalCents);
    expect(coffeeOrder.receipt.livemode).toBe(false);
  });

  it("rejects altered and expired coffee scan tokens before test payment", async () => {
    const scan = createCoffeeScanToken();
    const wrongAmount = signAlteredCoffeeToken(scan, { amountCents: BANANA_CART.totalCents });
    expect(verifyCoffeeToken(wrongAmount, "scan")).toBeNull();
    await expect(placeArTestOrder(wrongAmount)).rejects.toThrow(/confirmed scan expired/);
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(verifyCoffeeToken(scan, "scan")).toBeNull();
    expect(stripeCreate).not.toHaveBeenCalled();
  });
});
