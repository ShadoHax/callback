import { createHash } from "node:crypto";
import { tokens } from "../decision";
import { compareProductIdentity } from "../product-identity";

// One clearly labeled demo merchant. Prices, stock, shipping, and tax are fixture data owned by the server;
// nothing here claims to be another merchant's live inventory or a current market price.
export const MERCHANT = { id: "callback-demo-store", name: "Callback Demo Store", label: "TEST merchant · demo prices and stock" } as const;
export const CURRENCY = "usd" as const;
export const SHIPPING_CENTS = 599;
export const FREE_SHIPPING_FROM_CENTS = 7500;
export const TAX_BPS = 700; // demo flat 7.00%

export type Kind = "base" | "standalone" | "expansion" | "accessory" | "camera" | "coffee";
export type Product = {
  id: string; family: string; title: string; variant: string; aliases: string[]; kind: Kind;
  priceCents: number; stock: number; players?: [number, number]; requires?: string; similarTo?: string[];
  // Kind of thing (for gifts matched to a friend's stated taste) and plain-language traits to match their words against.
  category?: string; traits?: string[];
};

// The demo store sells coffee: the V3 story ("coffee they'd actually drink"). Each product lists plain-language
// traits; a friend's own words for what they like and avoid are matched against these, never guessed.
export const CATALOG: readonly Product[] = [
  { id: "ethiopia-light-whole", family: "demo-roasters-ethiopia", title: "Ethiopia Yirgacheffe", variant: "Light roast · whole bean · 12 oz", aliases: ["Ethiopia Yirgacheffe"], kind: "coffee", category: "coffee", traits: ["light roast", "whole bean", "pour-over"], priceCents: 1600, stock: 6 },
  { id: "kenya-light-ground", family: "demo-roasters-kenya", title: "Kenya AA", variant: "Light roast · ground for pour-over · 12 oz", aliases: ["Kenya AA"], kind: "coffee", category: "coffee", traits: ["light roast", "ground", "pour-over"], priceCents: 1500, stock: 4 },
  { id: "colombia-medium-whole", family: "demo-roasters-colombia", title: "Colombia Huila", variant: "Medium roast · whole bean · 12 oz", aliases: ["Colombia Huila"], kind: "coffee", category: "coffee", traits: ["medium roast", "whole bean", "drip"], priceCents: 1450, stock: 5 },
  { id: "french-dark-whole", family: "demo-roasters-french", title: "French Roast", variant: "Dark roast · whole bean · 12 oz", aliases: ["French Roast"], kind: "coffee", category: "coffee", traits: ["dark roast", "whole bean", "french press"], priceCents: 1400, stock: 8 },
  { id: "espresso-dark-whole", family: "demo-roasters-espresso", title: "Espresso Blend", variant: "Dark roast · whole bean · 12 oz", aliases: ["Espresso Blend"], kind: "coffee", category: "coffee", traits: ["dark roast", "whole bean", "espresso"], priceCents: 1500, stock: 3 },
  { id: "light-sampler-box", family: "demo-roasters-sampler", title: "Light Roast Sampler", variant: "Three 4 oz whole-bean bags · gift box", aliases: ["Light Roast Sampler"], kind: "coffee", category: "coffee", traits: ["light roast", "whole bean", "pour-over"], priceCents: 3400, stock: 2 },
];

export const catalogRevision = (catalog: readonly Product[] = CATALOG) => createHash("sha256").update(JSON.stringify(catalog)).digest("hex").slice(0, 16);
export const findProduct = (id: string, catalog: readonly Product[] = CATALOG) => catalog.find((product) => product.id === id) ?? null;

export type Totals = { subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; currency: typeof CURRENCY };
/** All money is integer minor units; the only rounding is tax, half-up to the cent. */
export function totalsFor(product: Product, quantity = 1): Totals {
  if (!Number.isInteger(product.priceCents) || product.priceCents < 0 || !Number.isInteger(quantity) || quantity < 1) throw new Error("Invalid catalog amount.");
  const subtotalCents = product.priceCents * quantity;
  const shippingCents = subtotalCents >= FREE_SHIPPING_FROM_CENTS ? 0 : SHIPPING_CENTS;
  const taxCents = Math.floor((subtotalCents * TAX_BPS + 5000) / 10000);
  return { subtotalCents, shippingCents, taxCents, totalCents: subtotalCents + shippingCents + taxCents, currency: CURRENCY };
}

export const formatCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type Observed = { item: string; title?: string; edition?: string; category?: string; specificity: "exact_title" | "product_family" | "category"; searchTerms?: string[]; visibleText?: string[] };
export type Grounding = { product: Product; match: "same" | "family" | "similar" };

/** An explicit visual title governs "same" identity. Legacy scans without it use observed words;
 *  other products in that family are "family"; a listed alternative is only "similar". */
export function groundInCatalog(observed: Observed, catalog: readonly Product[] = CATALOG): Grounding[] {
  const title = observed.title?.trim();
  const pool = new Set((title ? [title] : [observed.item, ...(observed.searchTerms ?? []), ...(observed.visibleText ?? [])]).flatMap((term) => [...tokens(term)]));
  const named = (alias: string) => {
    if (title) return compareProductIdentity(alias, { ...observed, title, category: observed.category ?? "", searchTerms: [], visibleText: [], ambiguity: "" }) === "same";
    const words = tokens(alias); return words.size > 0 && [...words].every((word) => pool.has(word));
  };
  // An exact-title claim needs an exact photo; a family-level photo only grounds the family.
  const matched = observed.specificity === "exact_title" ? catalog.filter((product) => product.aliases.some(named)) : [];
  // Keep the most specific: a photo of "Wingspan Asia" also contains the word "Wingspan", but it is not the base game.
  const size = (product: Product) => Math.max(...product.aliases.filter(named).map((alias) => tokens(alias).size));
  const same = matched.filter((product) => !matched.some((other) => other !== product && size(other) > size(product)));
  const families = new Set(same.map((product) => product.family));
  if (!families.size) for (const product of catalog) if (tokens(product.family.replace(/-/g, " ")).size && [...tokens(product.family.replace(/-/g, " "))].every((word) => pool.has(word))) families.add(product.family);
  const out: Grounding[] = [];
  for (const product of catalog) {
    if (same.includes(product)) out.push({ product, match: "same" });
    else if (families.has(product.family)) out.push({ product, match: "family" });
    else if (product.similarTo?.some((family) => families.has(family))) out.push({ product, match: "similar" });
  }
  return out;
}
