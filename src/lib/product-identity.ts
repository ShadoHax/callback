import type { Identification } from "./decision";

// Keep this module independent of decision.ts: both the index selector and the
// final decision use it, so a runtime import would create a cycle.
const STOPWORDS = new Set(["the", "a", "an", "my", "your", "our", "their", "his", "her", "this", "that", "these", "those", "one", "ones", "on", "of", "for", "and", "to", "it", "new", "old", "used", "copy", "some", "any"]);
function words(text: string) {
  const parts = text.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const joined: string[] = [];
  for (const part of parts) {
    const previous = joined.at(-1);
    if (previous && ((/\p{N}/u.test(previous) && /^\p{L}{1,2}$/u.test(part)) || (/^\p{L}{1,3}$/u.test(previous) && /^\p{N}+$/u.test(part)))) joined[joined.length - 1] = previous + part;
    else joined.push(part);
  }
  return new Set(joined.filter((word) => !STOPWORDS.has(word)));
}
const equal = (left: Set<string>, right: Set<string>) => left.size > 0 && left.size === right.size && [...left].every((word) => right.has(word));
const subset = (left: Set<string>, right: Set<string>) => [...left].every((word) => right.has(word));
const modelWords = (set: Set<string>) => new Set([...set].filter((word) => /\p{N}/u.test(word)));

function withoutCategory(name: string, category: string) {
  const categoryWords = words(category);
  return new Set([...words(name)].filter((word) => !categoryWords.has(word)));
}

function withoutPublisherAnnotation(name: string) {
  const parenthetical = name.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
  if (!parenthetical) return name;
  return /\b(?:games|studios|records|publishing|press|books|inc|llc|corp|company)\b/i.test(parenthetical[2]) &&
    !/\b(?:asia|deluxe|edition|expansion|anniversary|remaster|collector|limited|special)\b/i.test(parenthetical[2])
    ? parenthetical[1] : name;
}

/** Clean a legacy vision description only when the trailing text is clearly packaging metadata. */
export function productName(description: string) {
  let name = description.trim();
  const maker = name.match(/^(.+?)\s+by\s+([^()]+)$/i);
  // A title such as "Call Me by Your Name" is not a maker credit.
  if (maker && (/\b(?:games|studios?|records|publishing|press|books|inc|llc|corp|company)\b/i.test(maker[2]) ||
    (/\b(?:game|book|novel|album|record|camera)\b/i.test(maker[1]) && maker[2].trim().split(/\s+/).length >= 2))) name = maker[1];
  name = name.replace(/\s*[(,-]?\s*\b(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|revised)\s+printing\b\)?\s*$/i, "");
  // A subtitle ending in a generic category is a packaging tagline. Other
  // subtitles can be separate products, even without words like "expansion".
  const subtitle = name.match(/^(.+?)\s*(?::|\s[-–—]\s)\s*(.+)$/);
  if (subtitle && /^(?:a|an|the)\s+.+\b(?:game|book|novel|album|record|camera)\b$/i.test(subtitle[2])) name = subtitle[1];
  const publisherPrefix = name.match(/^(.+?\b(?:games|studios|records|publishing|press|books))\s+(.+)$/i);
  if (publisherPrefix) name = publisherPrefix[2];
  return withoutPublisherAnnotation(name.trim()).trim();
}

function sameWords(mention: string, observed: string, category: string) {
  const named = withoutCategory(withoutPublisherAnnotation(mention), category);
  const title = withoutCategory(observed, category);
  if (equal(named, title)) return true;
  const namedModels = modelWords(named), titleModels = modelWords(title);
  if (!namedModels.size || !equal(namedModels, titleModels)) return false;
  // Permit an omitted brand before the same model number, but no extra edition
  // or variant words on either side.
  const withoutLeadingBrand = (set: Set<string>) => {
    const ordered = [...set];
    return ordered.length > 1 && !/\p{N}/u.test(ordered[0]) ? new Set(ordered.slice(1)) : set;
  };
  return equal(withoutLeadingBrand(named), title) || equal(named, withoutLeadingBrand(title));
}

function observedName(identification: Identification) {
  const title = identification.title?.trim();
  const base = title || productName(identification.item);
  // A book's publisher, imprint, translation, or printing doesn't make it a different work: someone who says
  // "War and Peace" means any copy of War and Peace. Other categories keep named editions distinct.
  const edition = /\b(?:book|novel|paperback|hardcover)\b/i.test(identification.category) ? "" : identification.edition?.trim() ?? "";
  // A printing is the same product; named editions such as Deluxe or 2nd
  // Edition are variants. The vision prompt supplies these separately.
  return edition && !/\bprinting\b/i.test(edition) ? `${base} ${edition}` : base;
}

export function sameExactName(mention: string, observedName: string, category: string) {
  return sameWords(mention, withoutPublisherAnnotation(observedName), category);
}

export type ProductIdentity = "same" | "different" | "family" | "unrelated";

/** Compare cited item words with the title the photo actually identifies. */
export function compareProductIdentity(mention: string, identification: Identification): ProductIdentity {
  const observed = observedName(identification);
  if (sameWords(mention, observed, identification.category)) return "same";
  const named = withoutCategory(withoutPublisherAnnotation(mention), identification.category);
  const title = withoutCategory(observed, identification.category);
  if (!named.size || !title.size) return "unrelated";
  const namedModels = modelWords(named), titleModels = modelWords(title);
  if (namedModels.size && titleModels.size && !equal(namedModels, titleModels)) {
    const shorter = [...namedModels][0], longer = [...titleModels][0];
    if (namedModels.size === 1 && titleModels.size === 1 && longer.startsWith(shorter) && /\d$/.test(shorter)) return "family";
    return "different";
  }
  // "Wingspan" and "Wingspan Asia" are different named products, even if a
  // model mislabeled the former as family evidence. An equal model number with
  // an omitted brand was already accepted by sameWords above.
  if (subset(named, title) || subset(title, named)) return "different";
  return [...named].some((word) => title.has(word)) ? "family" : "unrelated";
}
