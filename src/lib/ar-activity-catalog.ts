import { createHash } from "node:crypto";

// Server-owned TEST merchant data. These are demo SKUs and prices, not live store stock.
export const ACTIVITY_MERCHANT = "Callback Demo Market";
export const ACTIVITY_CATALOG = [
  { sku: "bananas", name: "Bananas", unit: "3 count", priceCents: 119, stock: 20 },
  { sku: "flour", name: "All-purpose flour", unit: "2 lb bag", priceCents: 349, stock: 12 },
  { sku: "sugar", name: "Granulated sugar", unit: "2 lb bag", priceCents: 329, stock: 12 },
  { sku: "butter", name: "Unsalted butter", unit: "4 sticks", priceCents: 469, stock: 10 },
  { sku: "eggs", name: "Large eggs", unit: "1 dozen", priceCents: 399, stock: 12 },
  { sku: "baking-soda", name: "Baking soda", unit: "1 box", priceCents: 149, stock: 12 },
  { sku: "baking-powder", name: "Baking powder", unit: "1 tin", priceCents: 229, stock: 10 },
  { sku: "vanilla", name: "Vanilla extract", unit: "2 fl oz", priceCents: 499, stock: 8 },
  { sku: "salt", name: "Table salt", unit: "1 container", priceCents: 129, stock: 15 },
  { sku: "milk", name: "Milk", unit: "half gallon", priceCents: 349, stock: 10 },
  { sku: "drinking-water", name: "Drinking water", unit: "1 gallon", priceCents: 149, stock: 12 },
  { sku: "oats", name: "Rolled oats", unit: "18 oz", priceCents: 329, stock: 10 },
  { sku: "chocolate-chips", name: "Chocolate chips", unit: "12 oz", priceCents: 429, stock: 8 },
  { sku: "cocoa", name: "Cocoa powder", unit: "8 oz", priceCents: 449, stock: 8 },
  { sku: "honey", name: "Honey", unit: "12 oz", priceCents: 599, stock: 8 },
  { sku: "bread", name: "Sandwich bread", unit: "1 loaf", priceCents: 329, stock: 10 },
  { sku: "peanut-butter", name: "Peanut butter", unit: "16 oz", priceCents: 399, stock: 10 },
  { sku: "rice", name: "Rice", unit: "2 lb bag", priceCents: 399, stock: 12 },
  { sku: "pasta", name: "Pasta", unit: "1 lb box", priceCents: 249, stock: 12 },
  { sku: "tomato-sauce", name: "Tomato sauce", unit: "24 oz jar", priceCents: 299, stock: 12 },
  { sku: "olive-oil", name: "Olive oil", unit: "16 fl oz", priceCents: 799, stock: 8 },
  { sku: "onions", name: "Yellow onions", unit: "2 lb bag", priceCents: 299, stock: 10 },
  { sku: "garlic", name: "Garlic", unit: "3 bulbs", priceCents: 199, stock: 10 },
  { sku: "vegetables", name: "Mixed vegetables", unit: "1 lb bag", priceCents: 349, stock: 10 },
  { sku: "cheese", name: "Shredded cheese", unit: "8 oz", priceCents: 399, stock: 10 },
  { sku: "coffee-light-whole", name: "Light-roast whole-bean coffee", unit: "12 oz bag", priceCents: 1600, stock: 6 },
  { sku: "coffee-medium-ground", name: "Medium-roast ground coffee", unit: "12 oz bag", priceCents: 1450, stock: 6 },
  { sku: "coffee-filters", name: "Coffee filters", unit: "100 count", priceCents: 299, stock: 10 },
  { sku: "tea", name: "Tea bags", unit: "20 count", priceCents: 399, stock: 10 },
  { sku: "notebook", name: "Notebook", unit: "1 book", priceCents: 499, stock: 12 },
  { sku: "pens", name: "Ballpoint pens", unit: "4 pack", priceCents: 399, stock: 12 },
  { sku: "paperback-book", name: "Blank journal", unit: "1 book", priceCents: 999, stock: 8 },
  { sku: "sketchbook", name: "Sketchbook", unit: "1 book", priceCents: 899, stock: 8 },
  { sku: "watercolors", name: "Watercolor paint set", unit: "1 set", priceCents: 1299, stock: 6 },
  { sku: "clay", name: "Air-dry clay", unit: "2 lb pack", priceCents: 1099, stock: 6 },
] as const;

export type ActivitySku = (typeof ACTIVITY_CATALOG)[number];
export type ActivitySelection = { sku: string; quantity: number };
export const ACTIVITY_CATALOG_REVISION = createHash("sha256").update(JSON.stringify(ACTIVITY_CATALOG)).digest("hex").slice(0, 16);

export function priceActivityCart(selections: ActivitySelection[]) {
  if (!selections.length || selections.length > 12) throw new Error("Choose 1 to 12 TEST merchant items.");
  const seen = new Set<string>();
  const items = selections.map(({ sku, quantity }) => {
    const product = ACTIVITY_CATALOG.find((item) => item.sku === sku);
    if (!product || seen.has(sku) || !Number.isInteger(quantity) || quantity < 1 || quantity > 4 || quantity > product.stock)
      throw new Error("The proposed cart contains an unavailable TEST merchant item.");
    seen.add(sku);
    return { sku, name: product.name, quantity: `${quantity} × ${product.unit}`, units: quantity,
      unitPriceCents: product.priceCents, priceCents: product.priceCents * quantity };
  });
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents, 0);
  const shippingCents = subtotalCents >= 7500 ? 0 : 299;
  const taxCents = Math.round(subtotalCents * 0.07);
  return { items, subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents,
    currency: "usd" as const, merchant: ACTIVITY_MERCHANT, mode: "stripe_test" as const,
    deliveryLabel: "Demo address · no shipment created" };
}
