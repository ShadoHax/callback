import { displayName, sameKind, tokens, type Preferences } from "../decision";
import { CATALOG, formatCents, groundInCatalog, MERCHANT, totalsFor, type Kind, type Observed, type Product, type Totals } from "./catalog";

// What the shopper is buying for. Only purposes backed by the scan's own connection are offered: a gift needs an
// active wish or request, or the friend's own stated taste (a buyer-chosen gift, never presented as their request);
// "together" needs an open shared plan. Nothing is inferred from an old chat as spending authority.
export type Purpose = { kind: "self" } | { kind: "gift"; personId: string } | { kind: "together"; personId: string };
export type ScanContext = {
  observed: Observed;
  connection: { personId: string; relation: string; caveats: { reason: string; message: string }[]; mention?: string; preferences?: Preferences } | null;
  advice: { personId: string; basis: string; favorable: boolean; caution: boolean; mention: string; message: string }[];
};
export type Option = {
  productId: string; title: string; variant: string; merchant: string; match: "same" | "family" | "similar" | "related";
  totals: Totals; stock: number; reasons: string[]; tradeoffs: string[];
};
export type Excluded = { productId: string; title: string; why: string };
export type Options = { options: Option[]; excluded: Excluded[]; personalization: string[]; purposes: Purpose[] };

export function allowedPurposes(context: ScanContext): Purpose[] {
  const purposes: Purpose[] = [{ kind: "self" }];
  const connection = context.connection;
  if (connection && ["wanted", "asked_to_find", "prefers"].includes(connection.relation)) purposes.push({ kind: "gift", personId: connection.personId });
  if (connection?.relation === "planned_together") purposes.push({ kind: "together", personId: connection.personId });
  return purposes;
}
export const samePurpose = (a: Purpose, b: Purpose) => a.kind === b.kind && (a.kind === "self" || a.personId === (b as { personId: string }).personId);

const playableTogether = (product: Product) => (product.kind === "base" || product.kind === "standalone") && (product.players?.[1] ?? 0) >= 2;
const kindOrder: Record<Kind, number> = { base: 0, standalone: 1, camera: 0, coffee: 0, expansion: 2, accessory: 3 };

// Trait matching over plain words: "light-roast whole beans" contains the traits "light roast" and "whole bean".
// Polarity comes from the friend's typed relations (prefers vs dislikes), never from keyword guesses in raw text.
const stem = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const words = (text: string) => new Set([...tokens(text)].map(stem));
const saysTrait = (phrase: string, trait: string) => { const said = words(phrase), wanted = words(trait); return wanted.size > 0 && [...wanted].every((word) => said.has(word)); };

type Taste = { name: string; likes: { phrase: string; traits: string[] }[]; avoids: { phrase: string; traits: string[] }[] };
function tasteFor(context: ScanContext, catalog: readonly Product[]): Taste | null {
  const connection = context.connection;
  if (connection?.relation !== "prefers" || !connection.preferences) return null;
  const vocabulary = [...new Set(catalog.flatMap((product) => product.traits ?? []))];
  const traitsIn = (phrase: string) => vocabulary.filter((trait) => saysTrait(phrase, trait));
  return {
    name: displayName(connection.personId),
    likes: connection.preferences.likes.map((phrase) => ({ phrase, traits: traitsIn(phrase) })),
    avoids: connection.preferences.avoids.map((phrase) => ({ phrase, traits: traitsIn(phrase) })),
  };
}

export function shoppingOptions(context: ScanContext, input: { budgetCents: number; purpose: Purpose; preference?: Kind }, catalog: readonly Product[] = CATALOG): Options {
  if (!Number.isInteger(input.budgetCents) || input.budgetCents <= 0) throw new Error("Budget must be a positive whole number of cents.");
  const purposes = allowedPurposes(context);
  if (!purposes.some((purpose) => samePurpose(purpose, input.purpose))) throw new Error("That purpose isn't supported by this scan.");
  const taste = input.purpose.kind === "gift" ? tasteFor(context, catalog) : null;
  // A preference is not a purchase request, and missing catalog traits are not proof of suitability.
  if (input.purpose.kind === "gift" && context.connection?.relation === "prefers") {
    const unsupportedAvoid = taste?.avoids.find((avoid) => !avoid.traits.length);
    if (!taste || !taste.likes.some((like) => like.traits.length) || unsupportedAvoid) return {
      options: [], excluded: [], purposes,
      personalization: [unsupportedAvoid
        ? `The demo catalog cannot verify what ${taste!.name} avoids, “${unsupportedAvoid.phrase}”. Ask them before choosing a gift.`
        : `The demo catalog has no verified match for ${displayName(context.connection.personId)}'s stated taste. Ask them what would fit.`],
    };
  }
  // A gift from a stated taste is related to the photo by kind (coffee → coffee), not the same product.
  const grounded = taste ? relatedByKind(context.observed, catalog) : groundInCatalog(context.observed, catalog);
  const personalization: string[] = [];
  const excluded: Excluded[] = [];
  const candidates: (Option & { rank: number[] })[] = [];
  const who = input.purpose.kind === "self" ? "" : displayName(input.purpose.personId);
  const sharedGame = input.purpose.kind === "together" && grounded.some(({ product }) => Boolean(product.players));
  if (input.purpose.kind === "together") personalization.push(sharedGame
    ? `${who} planned to play it with you, so complete games you can play together come before expansions and accessories.`
    : `Options for your shared plan with ${who}, based on the item and evidence in this scan.`);
  if (input.purpose.kind === "gift" && taste) personalization.push(`A gift you're choosing for ${who}, ranked by what ${who} told you they like${taste.avoids.length ? " and don't" : ""}. ${who} didn't ask for it, and nothing is paid until you approve.`);
  else if (input.purpose.kind === "gift") personalization.push(`Shown as a gift for ${who}, based on their own request. Buying it doesn't mean ${who} has it until they do.`);

  for (const { product, match } of grounded) {
    const totals = totalsFor(product);
    if (product.stock <= 0) { excluded.push({ productId: product.id, title: product.title, why: "out of stock at the demo merchant" }); continue; }
    if (totals.totalCents > input.budgetCents) { excluded.push({ productId: product.id, title: product.title, why: `${formatCents(totals.totalCents)} with shipping and tax is over your ${formatCents(input.budgetCents)} budget` }); continue; }
    if (input.preference && product.kind !== input.preference) { excluded.push({ productId: product.id, title: product.title, why: `not a ${input.preference} (your preference)` }); continue; }
    const avoided = taste?.avoids.find((avoid) => avoid.traits.some((trait) => product.traits?.includes(trait)));
    if (taste && avoided) { excluded.push({ productId: product.id, title: product.title, why: `${taste.name} said “${avoided.phrase}” isn't for them` }); continue; }
    const reasons: string[] = [], tradeoffs: string[] = [];
    let tasteScore = 0;
    if (taste) {
      for (const like of taste.likes) {
        const fits = like.traits.filter((trait) => product.traits?.includes(trait));
        const misses = like.traits.filter((trait) => !product.traits?.includes(trait));
        tasteScore += fits.length;
        if (fits.length) reasons.push(`Fits what ${taste.name} said, “${like.phrase}”: ${fits.join(", ")}.`);
        for (const trait of misses) tradeoffs.push(`Not ${trait}, which ${taste.name} mentioned.`);
      }
      if (!tasteScore) { excluded.push({ productId: product.id, title: product.title, why: `no verified match to ${taste.name}'s stated taste` }); continue; }
      reasons.push(`Chosen for ${taste.name}'s taste; not the item in your photo.`);
    }
    if (match === "same") reasons.push("The same item as in your photo.");
    if (match === "family") reasons.push(`Same family as your photo (${product.variant.toLowerCase()}).`);
    if (match === "similar") tradeoffs.push("A similar alternative, not the item in your photo.");
    if (product.requires) tradeoffs.push(`Needs ${catalog.find((other) => other.id === product.requires)?.title ?? "the base product"} to play.`);
    if (product.players) reasons.push(`${product.players[0]}–${product.players[1]} players.`);
    if (input.purpose.kind === "together" && playableTogether(product)) reasons.push(`Playable with ${who} as a complete game.`);
    for (const caveat of context.connection?.personId === (input.purpose as { personId?: string }).personId ? context.connection?.caveats ?? [] : []) tradeoffs.push(caveat.message);
    // A friend's note attaches only to the product their own words name ("Wingspan" is the base game, not Wingspan Asia).
    for (const advice of context.advice) {
      const named = groundInCatalog({ item: advice.mention, specificity: "exact_title" }, catalog);
      if (!named.some((item) => item.match === "same" && item.product.id === product.id)) continue;
      (advice.caution ? tradeoffs : reasons).push(advice.caution ? `${advice.message} See their words before deciding.` : advice.message);
    }
    if (totals.shippingCents === 0) reasons.push("Free demo shipping at this total.");
    const rank = [sharedGame ? (playableTogether(product) ? 0 : 1) : 0, -tasteScore, match === "same" ? 0 : match === "family" ? 1 : 2, kindOrder[product.kind], totals.totalCents];
    candidates.push({ productId: product.id, title: product.title, variant: product.variant, merchant: MERCHANT.name, match, totals, stock: product.stock, reasons, tradeoffs, rank });
  }
  const compare = (a: number[], b: number[]) => { for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] - b[index]; return 0; };
  candidates.sort((a, b) => compare(a.rank, b.rank));
  if (sharedGame && candidates.some((option) => !playableTogether(catalog.find((product) => product.id === option.productId)!))) personalization.push("Expansions and accessories are listed after complete games because they need the base game.");
  if (context.advice.length) personalization.push(`Notes from ${context.advice.map((item) => displayName(item.personId)).join(" and ")} come from their own messages; ask them for more.`);
  return { options: candidates.slice(0, 3).map((option) => ({ productId: option.productId, title: option.title, variant: option.variant, merchant: option.merchant, match: option.match, totals: option.totals, stock: option.stock, reasons: option.reasons, tradeoffs: option.tradeoffs })), excluded: excluded.slice(0, 4), personalization, purposes };
}

/** Catalog products of the same kind as the photo ("coffee"), offered as related gift ideas. */
function relatedByKind(observed: ScanContext["observed"], catalog: readonly Product[]): { product: Product; match: "related" }[] {
  const photo = { category: observed.category ?? "", item: observed.item, searchTerms: observed.searchTerms ?? [] };
  return catalog.filter((product) => product.category && sameKind(product.category, photo)).map((product) => ({ product, match: "related" as const }));
}
