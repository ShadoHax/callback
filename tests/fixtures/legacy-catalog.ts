// Test-only catalog for the exact-identity, edition, and quote rules. Not sold in the demo store.
import type { Product } from "../../src/lib/commerce/catalog";

export const LEGACY_CATALOG: readonly Product[] = [
  { id: "wingspan-base", family: "wingspan", title: "Wingspan", variant: "Base game, 2nd printing", aliases: ["Wingspan"], kind: "base", priceCents: 6500, stock: 4, players: [1, 5] },
  { id: "wingspan-asia", family: "wingspan", title: "Wingspan Asia", variant: "Standalone for 1–2 players", aliases: ["Wingspan Asia"], kind: "standalone", priceCents: 4500, stock: 2, players: [1, 2] },
  { id: "wingspan-european", family: "wingspan", title: "Wingspan: European Expansion", variant: "Expansion", aliases: ["Wingspan European Expansion"], kind: "expansion", priceCents: 3000, stock: 5, requires: "wingspan-base" },
  { id: "wingspan-oceania", family: "wingspan", title: "Wingspan: Oceania Expansion", variant: "Expansion", aliases: ["Wingspan Oceania Expansion"], kind: "expansion", priceCents: 3500, stock: 0, requires: "wingspan-base" },
  { id: "wingspan-nesting-box", family: "wingspan", title: "Wingspan Nesting Box", variant: "Storage accessory", aliases: ["Wingspan Nesting Box"], kind: "accessory", priceCents: 4000, stock: 3, requires: "wingspan-base" },
  { id: "wyrmspan", family: "wyrmspan", title: "Wyrmspan", variant: "Base game", aliases: ["Wyrmspan"], kind: "base", priceCents: 5500, stock: 2, players: [1, 5], similarTo: ["wingspan"] },
  { id: "fujifilm-x100v", family: "fujifilm-x100", title: "Fujifilm X100V", variant: "Silver", aliases: ["Fujifilm X100V", "Fuji X100V"], kind: "camera", priceCents: 139900, stock: 1 },
  { id: "fujifilm-x100vi", family: "fujifilm-x100", title: "Fujifilm X100VI", variant: "Black", aliases: ["Fujifilm X100VI", "Fuji X100VI"], kind: "camera", priceCents: 159900, stock: 3 },
];
