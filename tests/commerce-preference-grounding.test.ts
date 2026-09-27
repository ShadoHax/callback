import { expect, it } from "vitest";
import { shoppingOptions, type ScanContext } from "../src/lib/commerce/options";
import { CATALOG } from "../src/lib/commerce/catalog";

const gift = { kind: "gift" as const, personId: "maya" };
const context = (likes: string[], avoids: string[] = []): ScanContext => ({
  observed: { item: "coffee bag", category: "coffee", specificity: "category" },
  connection: { personId: "maya", relation: "prefers", mention: likes.join(", "), preferences: { likes, avoids }, caveats: [] },
  advice: [],
});
const options = (value: ScanContext) => shoppingOptions(value, { budgetCents: 2500, purpose: gift });

it("does not call arbitrary coffee a taste match when the catalog cannot verify decaf", () => {
  const result = options(context(["decaf"]));
  expect(result.options).toEqual([]);
  expect(result.personalization.join(" ")).toMatch(/no verified match/);
  expect(result.personalization.join(" ")).not.toMatch(/own request/);
});

it("does not silently ignore an avoid whose absence the catalog cannot verify", () => {
  const result = options(context(["light roast"], ["caffeine"]));
  expect(result.options).toEqual([]);
  expect(result.personalization.join(" ")).toMatch(/cannot verify.*caffeine/);
});

it("does not offer zero-match coffee merely to fill three option slots", () => {
  const result = options(context(["light roast"]));
  expect(result.options.map((item) => item.productId)).toEqual(["kenya-light-ground", "ethiopia-light-whole"]);
  expect(result.excluded.some((item) => item.productId === "colombia-medium-whole" && /no verified match/.test(item.why))).toBe(true);
});

it("keeps the demo gift and explains genuine partial matches", () => {
  const result = options(context(["light-roast whole beans"], ["dark roasts"]));
  expect(result.options[0]).toMatchObject({ productId: "ethiopia-light-whole", totals: { totalCents: 2311 } });
  expect(result.options.every((item) => item.reasons.some((reason) => reason.startsWith("Fits what")))).toBe(true);
  expect(result.options.find((item) => item.productId === "kenya-light-ground")?.tradeoffs).toContain("Not whole bean, which Maya mentioned.");
});

it("does not turn a preference without saved taste evidence into their request", () => {
  const value = context([]);
  delete value.connection!.preferences;
  const result = options(value);
  expect(result.options).toEqual([]);
  expect(result.personalization.join(" ")).not.toMatch(/own request/);
});

it("does not change an explicit request for the same named product", () => {
  const value = context([]);
  value.observed = { item: CATALOG[0].title, title: CATALOG[0].title, category: "coffee", specificity: "exact_title" };
  value.connection!.relation = "wanted";
  expect(options(value).options[0]).toMatchObject({ productId: "ethiopia-light-whole", match: "same" });
});
