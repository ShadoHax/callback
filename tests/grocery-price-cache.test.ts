import { expect, it, vi } from "vitest";
import { cachedGroceryOffers } from "../src/lib/grocery-price-cache";
import { discoverIngredientOffers } from "../src/lib/ar-shopping-discovery";
import { buildGrocerCarts } from "../src/lib/ar-grocer-cart";

it("preserves recorded prices and timestamps without substituting incompatible ingredients", () => {
  expect(cachedGroceryOffers("all-purpose flour")[0].price.amountCents).toBe(788);
  expect(cachedGroceryOffers("salted butter")).toEqual([]);
  expect(cachedGroceryOffers("baking powder")).toEqual([]);
  expect(cachedGroceryOffers("unbleached all purpose flour")).toEqual([]);
  expect(cachedGroceryOffers("bananas", "Walmart")).toEqual([]);
  expect(cachedGroceryOffers("bananas")[0]).toMatchObject({source:{provider:"searchapi-cache"}, price:{observedAt:expect.stringMatching(/^2026-09-27T/)}});
});
it("builds a complete saved listing basket without spending search credits", async () => {
  vi.stubEnv("PREVIEW_SIGNING_SECRET", "test-cache-signing-secret-32-characters-long");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  try {
    const requirements = ["bananas","all purpose flour","granulated sugar","large eggs","unsalted butter","baking soda","salt","vanilla extract"].map(query=>({query,quantity:query==="bananas"?3:1,reason:"Recipe ingredient"}));
    const shopping = await discoverIngredientOffers(requirements,{useSavedPrices:true,offerLimit:30});
    const carts = buildGrocerCarts(shopping.ingredients,"owner");
    expect(carts[0]).toMatchObject({merchant:"Hy-Vee",subtotalCents:2560});
    expect(carts[0].items).toHaveLength(8);
    expect(carts[0].items.every(item=>item.priceSource==="cached")).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
