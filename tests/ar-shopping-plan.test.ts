import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../src/lib/model", () => ({ structuredCall: mocks.call,
  modelDisplayConfig: () => ({ provider: "meta", visionModel: "muse-spark-1.1" }) }));
import { planArShopping } from "../src/lib/ar-shopping-plan";
const id = "33333333-3333-4333-8333-333333333333";
const source = { id, speaker_id: "friend", thread_id: "thread", participant_ids: ["friend"], original_text: "Let's make soup together.", source_at: null, is_synthetic: true };
const input = { personId: "friend", sources: [source], identification: { item: "tomato", category: "food", specificity: "category" as const, visibleText: [], searchTerms: [], ambiguity: "" } };
const value = { supported: true, title: "Soup together", summary: "Your friend proposed making soup.", steps: ["Prepare ingredients.", "Cook together."], invitation: "Soup this weekend?", supportSourceIds: [id], requirements: [{ query: "fresh tomatoes", quantity: 1, reason: "Use 1 lb for soup." }] };
beforeEach(() => mocks.call.mockReset());
it("plans live queries from cited messages without a fixed merchant catalog or invented prices", async () => {
  mocks.call.mockResolvedValue({ value, model: "muse-spark-1.1", ms: 3 });
  const result = await planArShopping(input);
  expect(result).toMatchObject({ supported: true, requirements: value.requirements });
  expect(result).not.toHaveProperty("cart");
  expect(result).not.toHaveProperty("checkoutToken");
  expect(mocks.call.mock.calls[0][0].content).not.toContain("testCatalog");
});
it("rejects unsupported citations and a plan that cites only another person", async () => {
  mocks.call.mockResolvedValue({ value: { ...value, supportSourceIds: ["44444444-4444-4444-8444-444444444444"] }, model: "fixture", ms: 1 });
  await expect(planArShopping(input)).rejects.toThrow(/grounded/);
  mocks.call.mockResolvedValue({ value, model: "fixture", ms: 1 });
  await expect(planArShopping({ ...input, personId: "different" })).rejects.toThrow(/grounded/);
});
it("returns unsupported without querying merchants when no shopping purpose is grounded", async () => {
  mocks.call.mockResolvedValue({ value: { ...value, supported: false }, model: "fixture", ms: 1 });
  expect(await planArShopping(input)).toMatchObject({ supported: false, action: "shop" });
});

it("keeps model-inserted evidence UUIDs out of visible text", async () => {
  mocks.call.mockResolvedValue({ value: { ...value, summary: `Your friend proposed soup [${id}].`, steps: [`Prepare ingredients [${id}].`, "Cook together."] }, model: "fixture", ms: 1 });
  const result = await planArShopping(input);
  if (!result.supported) throw new Error("Expected supported");
  expect(result.plan.summary).toBe("Your friend proposed soup.");
  expect(result.plan.steps[0]).toBe("Prepare ingredients.");
  expect(result.plan.supportSourceIds).toEqual([id]);
});
