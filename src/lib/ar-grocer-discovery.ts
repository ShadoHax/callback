import { buildGrocerCarts, recognizedGrocer } from "./ar-grocer-cart";
import { discoverIngredientOffers, type IngredientOffer } from "./ar-shopping-discovery";

/** Complete the best-covered grocer using live searches; never fill gaps with invented prices. */
export async function completeGrocerCarts(ingredients: IngredientOffer[], ownerId: string, signal?: AbortSignal) {
  // Kitchen equipment is listed separately; this checkout covers every grocery ingredient.
  ingredients = ingredients.filter(item => item.kind !== "equipment");
  let carts = buildGrocerCarts(ingredients, ownerId);
  if (carts.length || !ingredients.length) return carts;
  const coverage = new Map<string, number>();
  for (const ingredient of ingredients) {
    const names = new Set(ingredient.offers.map(recognizedGrocer).filter((name): name is string => !!name));
    for (const name of names) coverage.set(name, (coverage.get(name) ?? 0) + 1);
  }
  const candidates = [...coverage].sort((a, b) => b[1] - a[1]).slice(0, 2);
  for (const [merchant] of candidates) {
    const missing = ingredients.filter(item => !item.offers.some(offer => recognizedGrocer(offer) === merchant));
    if (!missing.length) continue;
    const found = await discoverIngredientOffers(missing, { signal, merchantQuery: merchant, offerLimit: 30, alternateTerms: true, useSavedPrices: true });
    for (let i = 0; i < missing.length; i++) {
      missing[i].offers.push(...found.ingredients[i].offers.filter(offer => recognizedGrocer(offer) === merchant));
    }
    carts = buildGrocerCarts(ingredients, ownerId);
    if (carts.length) break;
  }
  return carts;
}
