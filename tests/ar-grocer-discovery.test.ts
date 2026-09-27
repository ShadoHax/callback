import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ carts: vi.fn(), discover: vi.fn() }));
vi.mock("../src/lib/ar-grocer-cart", () => ({ buildGrocerCarts: m.carts, recognizedGrocer: (offer: {merchant:string}) => offer.merchant === "Hy-Vee" ? "Hy-Vee" : null }));
vi.mock("../src/lib/ar-shopping-discovery", () => ({ discoverIngredientOffers: m.discover }));
import { completeGrocerCarts } from "../src/lib/ar-grocer-discovery";
import type { IngredientOffer } from "../src/lib/ar-shopping-discovery";
beforeEach(() => { vi.resetAllMocks(); });
it("searches only missing ingredients at the best-covered grocer and excludes another seller", async () => {
  const ingredients = [{query:"flour",quantity:1,reason:"Bake",offers:[{merchant:"Hy-Vee"}]}, {query:"sugar",quantity:1,reason:"Sweeten",offers:[]}] as unknown as IngredientOffer[];
  m.carts.mockReturnValueOnce([]).mockReturnValueOnce([{merchant:"Hy-Vee"}]);
  m.discover.mockResolvedValue({ingredients:[{offers:[{merchant:"Hy-Vee"},{merchant:"Marketplace"}]}]});
  expect(await completeGrocerCarts(ingredients,"owner")).toEqual([{merchant:"Hy-Vee"}]);
  expect(m.discover.mock.calls[0][0].map((i:IngredientOffer)=>i.query)).toEqual(["sugar"]);
  expect(m.discover.mock.calls[0][1]).toMatchObject({merchantQuery:"Hy-Vee",alternateTerms:true});
  expect(ingredients[1].offers).toEqual([{merchant:"Hy-Vee"}]);
});
it("does not search again for a complete cart", async () => {
  m.carts.mockReturnValue([{merchant:"Hy-Vee"}]);
  await completeGrocerCarts([],"owner");
  expect(m.discover).not.toHaveBeenCalled();
});
it("does not invent a merchant or price when no listings exist", async () => {
  m.carts.mockReturnValue([]);
  expect(await completeGrocerCarts([{query:"flour",offers:[]}] as unknown as IngredientOffer[],"owner")).toEqual([]);
  expect(m.discover).not.toHaveBeenCalled();
});

it("keeps kitchen equipment out of the complete grocery basket", async () => {
  m.carts.mockReturnValue([{merchant:"Hy-Vee"}]);
  await completeGrocerCarts([{kind:"ingredient",query:"flour",offers:[]},{kind:"equipment",query:"loaf pan",offers:[]}] as unknown as IngredientOffer[],"owner");
  expect(m.carts.mock.calls[0][0].map((item:IngredientOffer)=>item.query)).toEqual(["flour"]);
});
