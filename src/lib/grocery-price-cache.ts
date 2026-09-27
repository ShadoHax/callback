import snapshot from "../../data/grocery-price-cache.json";
import type { Offer } from "./commerce/discovery";

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Exact, reviewed product aliases only; never substitute another ingredient or fabricate a price. */
export function cachedGroceryOffers(query: string, merchant?: string): Offer[] {
  return snapshot.entries.filter(entry => entry.aliases.some(alias => normalize(alias) === normalize(query)) &&
    (!merchant || normalize(merchant) === normalize(entry.merchant)))
    .map((entry, index) => ({
      id: `saved-${normalize(entry.query).replaceAll(" ", "-")}`, title: entry.title,
      merchant: entry.merchant, merchantUrl: entry.merchantUrl, imageUrl: null,
      price: { amountCents: entry.amountCents, currency: "USD", observedAt: entry.observedAt },
      availability: "unknown", match: "same", reasons: ["Saved listing for this ingredient."],
      caveats: ["Saved listing price; current price and availability have not been checked.", "Check package size against the recipe; delivery and tax are not included."],
      source: { provider: "searchapi-cache", position: index },
    }));
}
