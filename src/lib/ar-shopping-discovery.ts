import { setTimeout as delay } from "node:timers/promises";
import { cachedGroceryOffers } from "./grocery-price-cache";
import { discover, type Discovery, type Offer } from "./commerce/discovery";
import type { ScanContext } from "./commerce/options";

export type IngredientRequirement = { kind?: "ingredient" | "equipment"; query: string; quantity: number; reason: string };
export type IngredientOffer = Required<IngredientRequirement> & {
  requestedQuery: string;
  offers: Offer[];
  fallbackSearchUrl: string;
  status: Discovery["status"];
  provider: string | null;
};

const trailingPackageWords = new Set(["bag", "bags", "box", "boxes", "bottle", "bottles", "container", "containers",
  "pack", "packs", "package", "packages", "jar", "jars", "carton", "cartons", "can", "cans", "tin", "tins",
  "dozen", "bunch", "bunches"]);
function searchQuery(query: string, kind: "ingredient" | "equipment") {
  if (kind === "equipment") return query;
  const terms = query.split(" ");
  if (terms.length > 1 && terms[0].toLowerCase() === "ripe") terms.shift();
  while (terms.length > 1 && trailingPackageWords.has(terms.at(-1)!.toLowerCase())) terms.pop();
  return terms.join(" ");
}

function isAccessoryListing(title: string) {
  const words = title.toLowerCase();
  if (/\b(?:empty|refillable|storage|holder|dispenser|canister|cellar|shaker|organizer|labels?|stickers?)\b/.test(words)) return true;
  if (/\b(?:containers?|bottles|jars)\b/.test(words)) return true;
  if (!/\b(?:bottle|jar|bags?|boxes?|cartons?|cans?|tins?)\b/.test(words)) return false;
  if (/\b(?:for|with lids?|set of)\b/.test(words)) return true;
  // A container named alongside the ingredient, without any contents size, is an ambiguous empty vessel.
  return !/\b\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|lb|lbs|g|kg|ml|l|ct|count)\b/.test(words);
}

function unsuitableFood(title: string, query: string) {
  // A matching noun alone is insufficient: food searches also return plants,
  // candy, cosmetics and flavored substitutes that cannot fill the recipe.
  const exclusions = ["plant", "tree", "seedling", "artificial", "plastic", "toy", "soap", "bath", "candle", "fridge", "freezer", "deodorizer", "celery", "garlic", "onion", "seasoned", "chocolate", "pickled", "powdered", "chips", "dried", "imitation"];
  const words = new Set(query.toLowerCase().match(/[a-z]+/g) ?? []);
  return exclusions.some(word => new RegExp(`\\b${word}s?\\b`, "i").test(title) && !words.has(word));
}

/** Look up public product listings for ingredient names from a separately grounded activity plan. */
export async function discoverIngredientOffers(
  requirements: readonly IngredientRequirement[],
  options: { storeLocationId?: string; signal?: AbortSignal; offerLimit?: number; merchantQuery?: string; alternateTerms?: boolean; useSavedPrices?: boolean } = {},
): Promise<{ ingredients: IngredientOffer[]; allIngredientsHaveOffers: boolean }> {
  if (!requirements.length || requirements.length > 12) throw new Error("Provide 1 to 12 ingredient queries.");
  const seen = new Set<string>();
  const checked = requirements.map((requirement) => {
    const rawQuery = requirement.query.replace(/\s+/g, " ").trim();
    const kind = requirement.kind ?? "ingredient";
    const query = searchQuery(rawQuery, kind);
    const reason = requirement.reason.trim();
    if (!rawQuery || rawQuery.length > 80 || rawQuery.split(" ").length > 10 ||
        !/^[\p{L}\p{N}][\p{L}\p{N} &'(),./+%\-]*$/u.test(rawQuery) ||
        !query ||
        !/[\p{L}]{2,}/u.test(query) ||
        !["ingredient", "equipment"].includes(kind) ||
        !Number.isInteger(requirement.quantity) || requirement.quantity < 1 || requirement.quantity > 24 ||
        !reason || reason.length > 220) throw new Error("An ingredient requirement is invalid.");
    const key = query.toLowerCase();
    if (seen.has(key)) throw new Error("Ingredient queries must be distinct.");
    seen.add(key);
    return { kind, query, requestedQuery: rawQuery, quantity: requirement.quantity, reason };
  });
  const readyAt = Date.now() + 1000;
  let next = 0;
  const ingredients = new Array<IngredientOffer>(checked.length);
  await Promise.all(Array.from({ length: Math.min(4, checked.length) }, async () => {
    while (next < checked.length) {
      if (options.signal?.aborted) throw new Error("Shopping lookup was cancelled.");
      const index = next++;
      const requirement = checked[index];
      // The exact-title constraint requires every meaningful ingredient term in the listing title.
      // This keeps e.g. baking powder listings out of a baking soda search.
      const context: ScanContext = { observed: { item: requirement.query, title: requirement.query,
        category: "grocery", specificity: "exact_title" }, connection: null, advice: [] };
      const saved = options.useSavedPrices && requirement.kind === "ingredient" ? cachedGroceryOffers(requirement.query, options.merchantQuery) : [];
      const found = saved.length ? { offers: saved, provider: "searchapi-cache", status: "ok" as const, fallbackSearchUrl: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(requirement.query)}` } : await discover(context, { purpose: { kind: "self" }, storeLocationId: options.storeLocationId,
        signal: options.signal, offerLimit: 30, merchantQuery: options.merchantQuery,
        searchTerm: options.alternateTerms && /^(?:white )?granulated (?:white )?sugar$/i.test(requirement.query) ? "cane sugar" : undefined });
      const offers = found.offers.filter((offer) => requirement.kind === "equipment" || (!isAccessoryListing(offer.title) && !unsuitableFood(offer.title, requirement.query))).slice(0, options.offerLimit ?? 3)
        .map((offer) => ({ ...offer,
        reasons: [requirement.kind === "equipment"
          ? "Listing title matches the equipment query; verify the product and size."
          : "Listing title matches the ingredient query; verify the product and size."],
        caveats: requirement.kind === "equipment" ? offer.caveats : [...offer.caveats, "Check package quantity against the recipe."],
      }));
      ingredients[index] = { ...requirement, offers, fallbackSearchUrl: found.fallbackSearchUrl,
        status: found.status === "ok" && !offers.length ? "no_verified_offers" : found.status, provider: found.provider };
    }
  }));
  if (ingredients.some(item => item.provider === "searchapi-cache"))
    await delay(Math.max(0, readyAt - Date.now()), undefined, { signal: options.signal });
  return { ingredients, allIngredientsHaveOffers: ingredients.every((item) => item.offers.length > 0) };
}
