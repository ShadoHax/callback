import { z } from "zod";
import { compareProductIdentity, productName, sameExactName } from "./product-identity";

export const OWNER_SPEAKER = "owner";

export const Source = z.object({
  id: z.string().uuid(), speaker_id: z.string(), thread_id: z.string(), participant_ids: z.array(z.string()), original_text: z.string(), source_at: z.string().nullable(), is_synthetic: z.boolean(),
});
export type Source = z.infer<typeof Source>;

export const SPECIFICITY = ["exact_title", "product_family", "category"] as const;
export type Specificity = (typeof SPECIFICITY)[number];
const specificityRank: Record<Specificity, number> = { exact_title: 3, product_family: 2, category: 1 };

export const Identification = z.object({
  entityKind: z.enum(["object", "place"]).optional(),
  item: z.string().max(200),
  category: z.string().max(80),
  specificity: z.enum(SPECIFICITY),
  visibleText: z.array(z.string().max(160)).transform((items) => items.slice(0, 12)),
  searchTerms: z.array(z.string().max(80)).transform((items) => items.slice(0, 10)),
  ambiguity: z.string().max(400),
  // The product's own name as a store lists it (no publisher, tagline, category words, or printing notes), and
  // any printing/edition note separately. Optional so older saved scans and fixtures still parse.
  title: z.string().max(200).optional(),
  edition: z.string().max(120).optional(),
  // Zero-shot classification into the owner's AI-made memory topics (only when the memory has topics).
  topicMatches: z.array(z.object({ topic: z.string().max(80), confidence: z.number().min(0).max(1), specific: z.boolean().optional() })).max(5).optional(),
  visibleItems: z.array(z.object({ name: z.string().max(120), category: z.string().max(80) })).max(6).optional(),
});
export type Identification = z.infer<typeof Identification>;

export const RELATIONS = ["wanted", "asked_to_find", "planned_together", "recommended", "gifted", "experienced_together", "owns", "dislikes", "cancelled", "purchased_as_gift", "inspired", "prefers", "enjoys", "pursuing"] as const;
export type Relation = (typeof RELATIONS)[number];

export const ExtractedRelation = z.object({
  personId: z.string().max(100),
  subject: z.enum(["person", "third_party", "owner"]),
  relation: z.enum(RELATIONS),
  evidenceLevel: z.enum(SPECIFICITY),
  itemMention: z.string().max(200),
  // The person's own expressed opinion in the cited words. Owning or buying something is not liking it.
  sentiment: z.enum(["positive", "negative", "none"]),
  sourceIds: z.array(z.string().max(100)).transform((ids) => ids.slice(0, 4)),
  // No longer requested: user-facing reasons are built from verified fields (connectionReason).
  reason: z.string().max(300).optional(),
  // For "inspired": the ambition in the person's own words ("try writing a novel"). Shown only if copied verbatim.
  activity: z.string().max(200).optional(),
  // Profile fields from ahead-of-time preparation: an AI-made topic ("pottery"), things you might see that evoke it,
  // and how much it matters to the person (0–1, from repetition and emotion). Optional for older memories.
  topic: z.string().max(80).optional(),
  cues: z.array(z.string().max(60)).max(12).optional(),
  strength: z.number().min(0).max(1).optional(),
  // Set at scan time when the photo was classified into this relation's topic: the classifier's confidence (0–1).
  matchConfidence: z.number().min(0).max(1).optional(),
});
export type ExtractedRelation = z.infer<typeof ExtractedRelation>;
export const Extraction = z.object({ relations: z.array(ExtractedRelation).transform((items) => items.slice(0, 24)) });

// ---- Item identity from verified mentions (deterministic; no model judgment) ----

const STOPWORDS = new Set(["the", "a", "an", "my", "your", "our", "their", "his", "her", "this", "that", "these", "those", "one", "ones", "on", "of", "for", "and", "to", "it", "new", "old", "used", "copy", "some", "any"]);
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
// Rejoins model numbers written with a space ("X100 V" → x100v, "PS 5" → ps5) before comparing.
function joinModelParts(parts: string[]) {
  const out: string[] = [];
  for (const part of parts) {
    const previous = out.at(-1);
    if (previous && ((/\p{N}/u.test(previous) && /^\p{L}{1,2}$/u.test(part)) || (/^\p{L}{1,3}$/u.test(previous) && /^\p{N}+$/u.test(part)))) out[out.length - 1] = previous + part;
    else out.push(part);
  }
  return out;
}
export const tokens = (text: string) => new Set(joinModelParts(normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)).filter((token) => !STOPWORDS.has(token)));
const modelTokens = (set: Set<string>) => new Set([...set].filter((token) => /\p{N}/u.test(token)));
const subset = (a: Set<string>, b: Set<string>) => [...a].every((token) => b.has(token));
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && subset(a, b);

/** True when the words themselves name one item: equal model numbers, or one name contained in the other. */
export function sameMention(a: string, b: string) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.size || !tb.size) return false;
  const ma = modelTokens(ta), mb = modelTokens(tb);
  if (ma.size && mb.size) return sameSet(ma, mb);
  return subset(ta, tb) || subset(tb, ta);
}

// Packaging and serving words say how something is held, not what it is: a "coffee bag" and a "coffee cup" are coffee.
const CONTAINERS = new Set(["bag", "cup", "mug", "packet", "package", "pack", "box", "jar", "can", "bottle", "tin", "pouch", "container", "carton"]);
const stem = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const kindWords = (text: string) => new Set([...tokens(text)].map(stem).filter((word) => !CONTAINERS.has(word)));

/** True when a relation's item category is the same kind of thing as the photo ("coffee" ↔ "coffee beans" / "coffee cup"). */
export function sameKind(category: string, identification: Pick<Identification, "category" | "item" | "searchTerms">) {
  const want = kindWords(category);
  if (!want.size) return false;
  const photoKind = kindWords(identification.category);
  const seen = new Set([...photoKind, ...[identification.item, ...identification.searchTerms].flatMap((term) => [...kindWords(term)])]);
  return subset(want, seen) || (photoKind.size > 0 && subset(photoKind, want));
}

/** The mention must be copied from a cited message; paraphrased identities are not trusted. */
export function mentionIn(mention: string, sources: Source[]) {
  const needle = normalize(mention).replace(/^["'(]+|["').,!?:;]+$/g, "");
  return needle.length > 0 && sources.some((source) => normalize(source.original_text).includes(needle));
}

/** True only when the mention's words equal the photo's product title (category words aside). */
function namesTitle(mention: string, identification: Identification) {
  if (identification.specificity !== "exact_title" || !identification.title?.trim()) return false;
  const generic = tokens(identification.category);
  const words = (text: string) => new Set([...tokens(text)].filter((token) => !generic.has(token)));
  const a = words(mention), b = words(identification.title);
  return a.size > 0 && sameSet(a, b);
}

/** An exact-title mention must not name a different model/edition/title than the one in the photo. */
function fitsObserved(mention: string, identification: Identification) {
  if (matchesVisibleItem(mention, identification)) return true;
  if (identification.title?.trim()) return compareProductIdentity(mention, identification) === "same";
  if (identification.visibleItems?.length) return identification.specificity === "exact_title" && compareProductIdentity(mention, identification) === "same";
  const observed = [identification.item, ...(identification.title ? [identification.title] : []), ...identification.searchTerms, ...identification.visibleText];
  const pool = new Set(observed.flatMap((term) => [...tokens(term)]));
  const mentionTokens = tokens(mention);
  const models = modelTokens(mentionTokens);
  if (models.size) return subset(models, modelTokens(pool));
  const generic = tokens(identification.category);
  return [...mentionTokens].some((token) => pool.has(token) && !generic.has(token));
}

function matchesVisibleItem(mention: string, identification: Identification) {
  const primaryName = identification.title?.trim() || productName(identification.item);
  return (identification.visibleItems ?? []).some((item) => {
    // Vision can repeat the primary title in visibleItems without its separate edition field.
    // Reuse the primary identity in that case so the confirmed edition is not erased.
    const observed = sameExactName(item.name, primaryName, identification.category) ? identification : {
      ...identification, item: item.name, title: item.name, category: item.category, edition: "", specificity: "exact_title" as const,
    };
    return compareProductIdentity(mention, observed) === "same";
  });
}

/** A named taste is a match only when a product identity is explicitly identified in the photo. */
function namedPreferenceObserved(mention: string, identification: Identification) {
  if (identification.specificity === "exact_title" && compareProductIdentity(mention, identification) === "same") return true;
  return matchesVisibleItem(mention, identification);
}

// ---- Rules ----

// Lower tier wins. An explicit unresolved shared intention outranks a recommendation, which outranks a shared memory.
// An ambition an item inspired ranks with a wish; a stated taste for a kind of thing is the mildest reason (a gift idea).
// Favorable first-hand ownership is also a connection, below active intentions and recommendations.
const positiveTier: Partial<Record<Relation, number>> = { planned_together: 0, asked_to_find: 0, wanted: 1, inspired: 1, pursuing: 1, recommended: 2, enjoys: 2, gifted: 3, experienced_together: 3, prefers: 3, owns: 4 };
// Which newer, same-item evidence ends which intention. Owning it ends a wish to get it, not a plan to use it together.
const supersedes: Partial<Record<Relation, Relation[]>> = {
  owns: ["wanted", "asked_to_find"],
  cancelled: ["planned_together", "inspired", "pursuing"],
  dislikes: ["wanted", "asked_to_find", "planned_together", "recommended", "prefers", "owns", "enjoys"],
};
// Buying a gift is not delivery or ownership: it is only ever a caveat on a wish.
const caveatOnly: Partial<Record<Relation, Relation[]>> = { purchased_as_gift: ["wanted", "asked_to_find"] };
// Relations that are the person's own state or words.
const selfAttributed: Relation[] = ["wanted", "asked_to_find", "recommended", "owns", "dislikes", "inspired", "prefers", "enjoys", "pursuing"];

export type RuledOutCode = "dislikes" | "owns" | "cancelled" | "purchased_as_gift" | "superseded" | "third_party" | "general_interest" | "needs_exact" | "different_item" | "unverified_item" | "misattributed" | "weaker" | "low_confidence" | "not_specific";
export type Contradiction = { relation: Relation; sourceIds: string[]; mention: string; observedAt: string | null };
export type RuledOut = { personId: string; relation: Relation; code: RuledOutCode; mention: string; sourceIds: string[]; observedAt: string | null; contradiction?: Contradiction };
export type CaveatReason = "order_unknown" | "item_unconfirmed" | "gift_not_confirmed";
export type Caveat = Contradiction & { reason: CaveatReason };
// Taste for a gift: the person's own verified words for what they like and what they don't, for this kind of item.
export type Preferences = { likes: string[]; avoids: string[] };
export type Connection = { personId: string; relation: Relation; reason: string; whyNow: string; sourceIds: string[]; evidenceLevel: Specificity; mention: string; observedAt: string | null; caveats: Caveat[]; activity?: string; preferences?: Preferences; preferenceMatch?: "observed" | "related" };
// Advice is a different action from reconnecting: someone who owns or tried the item can be worth asking even when
// that closes their own wish. Favorable only with a recommendation or positive words of their own; a dislike is a caution.
export type AdviceBasis = "recommended" | "owns" | "tried" | "dislikes";
export type Advice = { personId: string; basis: AdviceBasis; favorable: boolean; caution: boolean; mention: string; sourceIds: string[]; observedAt: string | null };
export type Decision = {
  status: "matched" | "needs_clarification" | "no_match";
  connection: Connection | null;
  connections: Connection[];
  advice: Advice[];
  ruledOut: RuledOut[];
  clarification: string;
  mentionCount: number;
  peopleCount: number;
  droppedCount: number;
  // Every plausible person, scored like a classifier: best reason per person, highest first.
  ranking: RankedPerson[];
};
export type RankedPerson = { personId: string; relation: Relation; mention: string; topic?: string; score: number; eligible: boolean };

type Resolved = ExtractedRelation & { sources: Source[]; at: number | null; atIso: string | null; verified: boolean; attributed: boolean; namedPreference: boolean; activity?: string };

const whyNowByRelation: Partial<Record<Relation, string>> = {
  enjoys: "It's something they love, and it's right in front of you.",
  pursuing: "A natural moment to ask how it's going.",
  asked_to_find: "They asked you to keep an eye out, and you just found one.",
  planned_together: "You just came across it, and the plan is still open.",
  wanted: "They wanted one, and you're looking at one right now.",
  recommended: "You just came across the thing they recommended.",
  owns: "They own one and said they like it, and you just found one.",
  gifted: "You just came across something you two share.",
  experienced_together: "You just came across something you two share.",
  inspired: "It's a natural moment to ask how it's going.",
  prefers: "A small gift they'd actually enjoy.",
};

const reasonByRelation: Record<Relation, (name: string) => string> = {
  enjoys: (name) => `${name} loves this.`,
  pursuing: (name) => `${name} is working toward something this connects to.`,
  wanted: (name) => `${name} said they wanted one.`,
  asked_to_find: (name) => `${name} asked you to look out for one.`,
  planned_together: (name) => `You and ${name} made a plan involving it.`,
  recommended: (name) => `${name} recommended it to you.`,
  gifted: (name) => `You and ${name} share a gift connection to it.`,
  experienced_together: (name) => `You and ${name} share a memory involving it.`,
  owns: (name) => `${name} said they own one and like it.`,
  dislikes: (name) => `${name} said they disliked it.`,
  cancelled: (name) => `${name} said the plan was cancelled.`,
  purchased_as_gift: (name) => `A message mentions one being purchased for ${name}.`,
  inspired: (name) => `${name} said it inspired something they want to do.`,
  prefers: (name) => `${name} told you what they like.`,
};

/** User-facing explanations are constructed from verified fields, never model prose. */
export function connectionReason(personId: string, relation: Relation, detail: { mention?: string; activity?: string } = {}) {
  const name = displayName(personId);
  // Verified words only: the mention and activity were both found verbatim in the person's cited messages.
  if (relation === "enjoys" && detail.mention) return `${name} is into ${detail.mention}.`;
  if (relation === "pursuing" && detail.activity) return `${name} is working on: “${detail.activity}”.`;
  if (relation === "inspired" && detail.activity && detail.mention) return `${detail.mention} inspired ${name} to ${detail.activity.replace(/^to\s+/i, "")}.`;
  if (relation === "prefers" && detail.mention) return `${name} told you they like “${detail.mention}”.`;
  return reasonByRelation[relation](name);
}

// A shared plan, shared experience, or gift must involve the user: the user took part in the cited exchange, or the
// person's own words address them. "We play it every Sunday" about someone's own household is not shared with you.
// English-only and deliberately conservative: when unsure, the relation is dropped rather than surfaced.
const SHARED: Relation[] = ["planned_together", "experienced_together", "gifted"];
// "Together", "us", and "remember" alone also describe somebody else's household.
// Require direct address/an invitation or an owner-authored part of the cited exchange.
const ADDRESSES_USER = /\b(?:you|your|yours|u|ya|let'?s|let us|we should|we could|we can|we need to|we have to|we gotta|we must|remember when we)\b/i;
export function involvesUser(relation: Pick<ExtractedRelation, "relation" | "personId">, sources: Source[], ownerIds: Set<string>) {
  if (!SHARED.includes(relation.relation)) return true;
  return sources.some((source) => ownerIds.has(source.speaker_id)) || sources.some((source) => source.speaker_id === relation.personId && ADDRESSES_USER.test(source.original_text));
}

function attributed(relation: Relation, personId: string, sources: Source[]) {
  const spoke = sources.some((source) => source.speaker_id === personId);
  if (selfAttributed.includes(relation)) return spoke;
  const present = sources.every((source) => source.participant_ids.includes(personId) || source.speaker_id === personId);
  if (relation === "purchased_as_gift") return spoke || present || sources.some((source) => tokens(source.original_text).has(personId.toLowerCase()) || tokens(source.original_text).has(displayName(personId).toLowerCase()));
  return spoke || present;
}

type Order = "after" | "before" | "unknown";
const order = (later: Resolved, earlier: Resolved): Order => (later.at === null || earlier.at === null || later.at === earlier.at ? "unknown" : later.at > earlier.at ? "after" : "before");

type Identity = "same" | "different" | "unknown";
function identity(negative: Resolved, positive: Resolved, identification: Identification): Identity {
  if (!negative.verified || !positive.verified) return "unknown";
  const bothExact = negative.evidenceLevel === "exact_title" && positive.evidenceLevel === "exact_title";
  const sameWords = sameMention(negative.itemMention, positive.itemMention);
  // Both exact and both matching the exact item in the photo: they name that item, even if spelled differently.
  const bothThePhoto = bothExact && identification.specificity === "exact_title" && fitsObserved(negative.itemMention, identification) && fitsObserved(positive.itemMention, identification);
  if ((sameWords || bothThePhoto) && specificityRank[negative.evidenceLevel] >= specificityRank[positive.evidenceLevel]) return "same";
  if (bothExact && !sameWords && !bothThePhoto) return "different";
  return "unknown";
}

// A rejection of the whole kind ("coffee") also ends an earlier taste within it. Extra variety words
// ("dark roasts") do not name the whole kind, even when the message is labeled category-level.
function rejectsWholeKind(negative: Resolved, identification: Identification) {
  if (negative.relation !== "dislikes" || negative.evidenceLevel !== "category") return false;
  const mention = kindWords(negative.itemMention), category = kindWords(identification.category);
  return mention.size > 0 && category.size > 0 && subset(mention, category);
}

// Category-level identity is often exactly what someone requested ("I need a webcam").
// Keep that distinct from broad enthusiasm ("I love cameras"), which the extractor may
// conservatively return as `wanted`. Other positive relation types already express a
// concrete link: a recommendation, shared experience, gift, plan, or stated preference.
function explicitCategoryWish(relation: Resolved) {
  if (relation.relation === "asked_to_find") return true;
  if (relation.relation !== "wanted") return false;
  const ownWords = relation.sources
    .filter((source) => source.speaker_id === relation.personId)
    .map((source) => source.original_text)
    .join(" ");
  return /\b(?:i\s+(?:really\s+|kinda\s+|kind\s+of\s+)?(?:want|need|wish(?:\s+i\s+had)?|am\s+looking\s+for|'m\s+looking\s+for)|i(?:'d|\s+would)\s+(?:really\s+)?(?:like|love)\s+(?:one|a|an|some)|looking\s+for\s+(?:one|a|an|some)|need\s+(?:one|a|an|some))\b/i.test(ownWords);
}

export function decide(input: { identification: Identification; relations: ExtractedRelation[]; sources: Source[]; ownerIds: string[] }): Decision {
  const { identification, sources } = input;
  const ownerIds = new Set([OWNER_SPEAKER, ...input.ownerIds]);
  const byId = new Map(sources.map((source) => [source.id, source]));
  const knownPeople = new Set(sources.flatMap((source) => [source.speaker_id, ...source.participant_ids]).filter((id) => !ownerIds.has(id)));

  // Gate: every cited source must resolve inside the owner's corpus and the person must exist in it.
  let droppedCount = 0;
  const resolved: Resolved[] = [];
  for (const relation of input.relations) {
    const cited = relation.sourceIds.map((id) => byId.get(id));
    if (!cited.length || cited.some((source) => !source) || ownerIds.has(relation.personId) || !knownPeople.has(relation.personId) || relation.subject === "owner") { droppedCount++; continue; }
    if (!involvesUser(relation, cited as Source[], ownerIds)) { droppedCount++; continue; }
    const known = (cited as Source[]).map((source) => (source.source_at ? Date.parse(source.source_at) : NaN));
    const at = known.every((value) => Number.isFinite(value)) ? Math.max(...known) : null;
    const verified = mentionIn(relation.itemMention, cited as Source[]);
    // When the verified words name exactly the product title in the photo, the evidence is exact, whatever level the
    // model labeled it ("Wingspan" is a title, not a category). Brand-only or generic words are never upgraded.
    // Attribute tastes ("light-roast whole beans") can suggest a related gift by kind.
    // A named taste keeps its identity requirement. Older indexes sometimes labeled a named
    // product as a family; a style that names the kind ("whole beans") remains a related taste.
    const mentionKind = kindWords(relation.itemMention), observedKind = kindWords(identification.category);
    const namesTheKind = [...mentionKind].some((word) => observedKind.has(word));
    const namedPreference = relation.relation === "prefers" && (relation.evidenceLevel === "exact_title" || (relation.evidenceLevel === "product_family" && !namesTheKind));
    const evidenceLevel = relation.relation === "prefers" && !namedPreference ? "category"
      : verified && relation.evidenceLevel !== "exact_title" && namesTitle(relation.itemMention, identification) ? "exact_title" : relation.evidenceLevel;
    // An ambition is shown only in the person's own words; an unverifiable paraphrase is dropped, not repaired.
    const ownWords = (cited as Source[]).filter((source) => source.speaker_id === relation.personId);
    const activity = (relation.relation === "inspired" || relation.relation === "pursuing") && relation.activity?.trim() && mentionIn(relation.activity, ownWords) ? relation.activity.trim().replace(/[.!?]+$/, "") : undefined;
    resolved.push({ ...relation, activity, evidenceLevel, namedPreference, sources: cited as Source[], at, atIso: at === null ? null : new Date(at).toISOString(), verified, attributed: attributed(relation.relation, relation.personId, cited as Source[]) });
  }
  // A contradiction only counts when it is the person's own, attributable statement.
  // Ownership remains a superseding state even when favorable experience also makes it a connection candidate.
  const negatives = resolved.filter((relation) => (positiveTier[relation.relation] === undefined || relation.relation === "owns") && relation.subject === "person" && relation.attributed && relation.verified);

  const ruledOut: RuledOut[] = [];
  const rule = (relation: Resolved, code: RuledOutCode, contradiction?: Resolved) => ruledOut.push({
    personId: relation.personId, relation: relation.relation, code, mention: relation.itemMention, sourceIds: relation.sourceIds, observedAt: relation.atIso,
    ...(contradiction ? { contradiction: { relation: contradiction.relation, sourceIds: contradiction.sourceIds, mention: contradiction.itemMention, observedAt: contradiction.atIso } } : {}),
  });
  const candidates: (Resolved & { caveats: Caveat[] })[] = [];

  for (const relation of resolved) {
    const tier = positiveTier[relation.relation];
    if (tier === undefined) continue;
    // Owning an item is a connection only when the person's own cited words express a positive experience.
    if (relation.relation === "owns" && (relation.sentiment !== "positive" || !hasPositiveOwnWords(relation))) continue;
    if (relation.subject === "third_party") { rule(relation, "third_party"); continue; }
    if (!relation.attributed) { rule(relation, "misattributed"); continue; }
    if (!relation.verified) { rule(relation, "unverified_item"); continue; }
    const caveats: Caveat[] = [];
    let superseded: Resolved | undefined;
    for (const negative of negatives) {
      if (negative.personId !== relation.personId) continue;
      // A different disliked variety does not contradict a taste, but rejecting the whole kind does.
      const wholeKind = relation.relation === "prefers" && rejectsWholeKind(negative, identification);
      if (relation.relation === "prefers" && !wholeKind && !sameMention(negative.itemMention, relation.itemMention)) continue;
      const ends = (supersedes[negative.relation] ?? []).includes(relation.relation);
      const warns = ends || (caveatOnly[negative.relation] ?? []).includes(relation.relation);
      if (!warns) continue;
      const when = order(negative, relation), same = wholeKind ? "same" : identity(negative, relation, identification);
      if (when === "before" || same === "different") continue;
      if (ends && when === "after" && same === "same") { superseded = negative; break; }
      const reason: CaveatReason = !ends ? "gift_not_confirmed" : same !== "same" ? "item_unconfirmed" : "order_unknown";
      caveats.push({ relation: negative.relation, sourceIds: negative.sourceIds, mention: negative.itemMention, observedAt: negative.atIso, reason });
    }
    if (superseded) { rule(relation, "superseded", superseded); continue; }
    // Specificity and relationship strength are separate. A category-level request such as
    // "I need a webcam" is actionable, and category-level recommendations/shared memories
    // are real links too. Only an uncommitted broad `wanted` extraction is general interest.
    if (relation.evidenceLevel === "category" && relation.relation === "wanted" && !explicitCategoryWish(relation)) { rule(relation, "general_interest"); continue; }
    candidates.push({ ...relation, caveats });
  }

  // People whose only evidence is negative are reported too, so the stage stream can show why they were skipped.
  const accounted = new Set([...ruledOut.map((item) => item.personId), ...candidates.map((item) => item.personId)]);
  for (const relation of negatives) {
    if (accounted.has(relation.personId)) continue;
    rule(relation, relation.relation as RuledOutCode);
    accounted.add(relation.personId);
  }

  // Unresolved caveats rank below clean candidates; recency breaks remaining ties (unknown dates last).
  candidates.sort((a, b) => positiveTier[a.relation]! - positiveTier[b.relation]! || Number(a.caveats.length > 0) - Number(b.caveats.length > 0) ||
    (a.relation === "prefers" && b.relation === "prefers" ? Number(!(a.namedPreference && namedPreferenceObserved(a.itemMention, identification))) - Number(!(b.namedPreference && namedPreferenceObserved(b.itemMention, identification))) : 0) ||
    (b.at ?? -Infinity) - (a.at ?? -Infinity));
  const observedRank = specificityRank[identification.specificity];
  const namedPreference = (candidate: Resolved) => candidate.relation === "prefers" && candidate.namedPreference;
  // A relation reached through the topic classifier ("this photo is about pottery") needs no product-name match.
  // An exact-title memory still requires that title to be confirmed in the photo, including a named secondary item.
  // A generic book or soda shelf cannot establish a recommendation for one particular title or variant.
  const eligible = (candidate: Resolved) => candidate.matchConfidence !== undefined
    ? candidate.evidenceLevel !== "exact_title" ||
      (identification.specificity === "exact_title" && compareProductIdentity(candidate.itemMention, identification) === "same") ||
      matchesVisibleItem(candidate.itemMention, identification)
    : candidate.relation === "prefers"
    ? !namedPreference(candidate) || namedPreferenceObserved(candidate.itemMention, identification)
    : (observedRank >= specificityRank[candidate.evidenceLevel] || (candidate.evidenceLevel === "exact_title" && matchesVisibleItem(candidate.itemMention, identification))) &&
      !(identification.title?.trim() && compareProductIdentity(candidate.itemMention, identification) === "different" && !matchesVisibleItem(candidate.itemMention, identification)) &&
      (candidate.evidenceLevel !== "exact_title" || fitsObserved(candidate.itemMention, identification));
  // Score every candidate like a classifier and require the best to clear a threshold, rather than taking the first
  // survivor. Rule-based exclusions above still apply first; scores only order what the rules allow.
  const newest = Math.max(...sources.map((source) => (source.source_at ? Date.parse(source.source_at) : -Infinity)));
  const scoreOf = (candidate: Resolved & { caveats: Caveat[] }) => connectionScore(candidate, newest);
  const order0 = new Map(candidates.map((candidate, index) => [candidate, index]));
  const ranked = candidates.filter(eligible).sort((a, b) => scoreOf(b) - scoreOf(a) || order0.get(a)! - order0.get(b)!);
  const winner = ranked[0] && scoreOf(ranked[0]) >= MATCH_THRESHOLD ? ranked[0] : undefined;
  const bestByPerson = new Map<string, RankedPerson>();
  for (const candidate of candidates) {
    const item: RankedPerson = { personId: candidate.personId, relation: candidate.relation, mention: candidate.itemMention, ...(candidate.topic ? { topic: candidate.topic } : {}), score: scoreOf(candidate), eligible: eligible(candidate) };
    const current = bestByPerson.get(candidate.personId);
    if (!current || Number(item.eligible) - Number(current.eligible) > 0 || (item.eligible === current.eligible && item.score > current.score)) bestByPerson.set(candidate.personId, item);
  }
  const ranking = [...bestByPerson.values()].sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score).slice(0, 6);
  let clarify = false;
  for (const candidate of candidates) {
    if (candidate === winner) continue;
    if (namedPreference(candidate) && !eligible(candidate)) {
      rule(candidate, "needs_exact"); clarify = true;
    }
    else if (observedRank < specificityRank[candidate.evidenceLevel] && !eligible(candidate)) { rule(candidate, "needs_exact"); clarify = true; }
    else if (!eligible(candidate)) rule(candidate, "different_item");
    else if (candidate.personId !== winner?.personId) rule(candidate, winner ? "weaker" : "low_confidence");
  }

  const mentionCount = resolved.length;
  const peopleCount = new Set(resolved.map((relation) => relation.personId)).size;
  const groupable = new Set<Relation>(["planned_together", "experienced_together", "gifted"]);
  const seenGroupPeople = new Set<string>();
  const group = winner && groupable.has(winner.relation) ? candidates.filter((candidate) => {
    if (!eligible(candidate) || candidate.relation !== winner.relation || candidate.caveats.length !== winner.caveats.length || !sharesContext(candidate, winner) || seenGroupPeople.has(candidate.personId)) return false;
    seenGroupPeople.add(candidate.personId);
    return true;
  }) : [];
  const winners = group.length > 1 ? group : winner ? [winner] : [];
  const winnerIds = new Set(winners.map((item) => item.personId));
  const connections: Connection[] = winners.map((item) => ({ personId: item.personId, relation: item.relation, reason: connectionReason(item.personId, item.relation, { mention: item.itemMention, activity: item.activity }), whyNow: whyNowByRelation[item.relation] ?? "", sourceIds: item.sourceIds, evidenceLevel: item.evidenceLevel, mention: item.itemMention, observedAt: item.atIso, caveats: item.caveats,
    ...(item.activity ? { activity: item.activity } : {}), ...(item.relation === "prefers" ? { preferences: preferencesOf(item.personId, candidates, negatives, identification), preferenceMatch: item.namedPreference ? "observed" as const : "related" as const } : {}) }));
  const base = { ruledOut: dedupeByPeople(ruledOut, winnerIds), advice: adviceFrom(resolved, identification, winnerIds), mentionCount, peopleCount, droppedCount, connections, ranking };
  if (winner) {
    const connection = connections[0];
    return { status: "matched", connection, clarification: "", ...base };
  }
  if (clarify) {
    return { status: "needs_clarification", connection: null, clarification: `This looks like ${identification.item}, but a message mentions a specific version the photo can't confirm. Get closer to the label or title and scan again.`, ...base };
  }
  return { status: "no_match", connection: null, clarification: "", ...base };
}

// How much each kind of reason justifies reaching out, before match quality, recency, and importance.
const RELATION_WEIGHT: Partial<Record<Relation, number>> = { planned_together: 1, asked_to_find: 1, inspired: 0.95, pursuing: 0.95, wanted: 0.9, recommended: 0.85, enjoys: 0.8, experienced_together: 0.75, prefers: 0.75, gifted: 0.7, owns: 0.6 };
// Calibrated on the LoCoMo evaluation (docs/PROFILES.md): 0.45 keeps the same correct matches as 0.40 with fewer wrong ones.
export const MATCH_THRESHOLD = 0.45;

/** 0–1 confidence that this is a good reason to reach out now: how well the photo matches the memory (1 for a
 *  verified exact/kind match, else the topic classifier's confidence) × kind of reason × importance to the person
 *  × recency (relative to the newest message) × a penalty for unresolved caveats. */
export function connectionScore(candidate: Pick<ExtractedRelation, "relation" | "matchConfidence" | "strength"> & { at: number | null; caveats: unknown[] }, newest: number) {
  const match = candidate.matchConfidence ?? 1;
  const weight = RELATION_WEIGHT[candidate.relation] ?? 0.5;
  const importance = 0.7 + 0.3 * (candidate.strength ?? 0.7);
  const ageDays = candidate.at !== null && Number.isFinite(newest) ? Math.max(0, (newest - candidate.at) / 86_400_000) : null;
  const recency = ageDays === null ? 0.9 : 0.85 + 0.15 * Math.exp(-ageDays / 180);
  return Math.round(match * weight * importance * recency * (candidate.caveats.length ? 0.85 : 1) * 100) / 100;
}

/** Everything this person verifiably said they like or dislike about this kind of item, in their own words. */
function preferencesOf(personId: string, candidates: Resolved[], negatives: Resolved[], identification: Identification): Preferences {
  const likes = candidates.filter((relation) => relation.personId === personId && relation.relation === "prefers");
  const avoids = negatives.filter((relation) => relation.personId === personId && relation.relation === "dislikes" && relation.evidenceLevel !== "exact_title" &&
    !likes.some((preference) => order(preference, relation) === "after" && identity(relation, preference, identification) === "same"));
  const unique = (items: string[]) => [...new Map(items.map((item) => [normalize(item), item.trim()])).values()];
  return {
    likes: unique(likes.map((relation) => relation.itemMention)),
    avoids: unique(avoids.map((relation) => relation.itemMention)),
  };
}

function sharesContext(a: Resolved, b: Resolved) {
  if (a.personId === b.personId) return true;
  const bThreads = new Set(b.sources.map((source) => source.thread_id));
  return a.sources.some((source) => bThreads.has(source.thread_id) && source.participant_ids.includes(b.personId));
}

const POSITIVE_EXPERIENCE = /\b(?:love|loved|loving|like|likes|liked|enjoy|enjoys|enjoyed|favorite|favourite|great|excellent|amazing|fantastic|wonderful|awesome|recommend|recommended)\b/i;
const NEGATED_POSITIVE_EXPERIENCE = /\b(?:not|never|don't|do not|doesn't|does not|didn't|did not|can't|cannot|couldn't|could not|hardly|barely)\s+(?:(?:really|very|that|too)\s+)?(?:love|loved|loving|like|likes|liked|enjoy|enjoys|enjoyed|favorite|favourite|great|excellent|amazing|fantastic|wonderful|awesome|recommend|recommended)\b/gi;
function hasPositiveOwnWords(relation: Resolved) {
  return relation.sources.some((source) => source.speaker_id === relation.personId && POSITIVE_EXPERIENCE.test(source.original_text.replace(NEGATED_POSITIVE_EXPERIENCE, "")));
}
function favorableOwnership(relation: Resolved) {
  return relation.relation === "owns" && relation.sentiment === "positive" && hasPositiveOwnWords(relation);
}
function hasLaterSameItemDislike(ownership: Resolved, relations: Resolved[], identification: Identification) {
  return relations.some((relation) => relation.personId === ownership.personId && relation.relation === "dislikes" && relation.subject === "person" && relation.attributed &&
    order(relation, ownership) === "after" && identity(relation, ownership, identification) === "same");
}

const adviceBasis: Partial<Record<Relation, AdviceBasis>> = { recommended: "recommended", owns: "owns", experienced_together: "tried", gifted: "tried", dislikes: "dislikes" };
const adviceRank = (item: Advice) => (item.favorable ? 0 : item.caution ? 2 : 1);

function adviceFrom(resolved: Resolved[], identification: Identification, exclude = new Set<string>()): Advice[] {
  const best = new Map<string, Advice & { at: number }>();
  for (const relation of resolved) {
    const basis = adviceBasis[relation.relation];
    // Experience must be the person's own words, about this item (not another version, not the general category).
    if (!basis || relation.subject !== "person" || (exclude.has(relation.personId) && !favorableOwnership(relation)) ||
      (relation.relation === "owns" && hasLaterSameItemDislike(relation, resolved, identification)) || !relation.verified) continue;
    if (!relation.sources.some((source) => source.speaker_id === relation.personId)) continue;
    if (identification.title?.trim() && compareProductIdentity(relation.itemMention, identification) === "different" && !matchesVisibleItem(relation.itemMention, identification)) continue;
    if (relation.evidenceLevel === "category" || (relation.evidenceLevel === "exact_title" && !fitsObserved(relation.itemMention, identification))) continue;
    const favorable = basis === "recommended" || (relation.relation === "owns" ? favorableOwnership(relation) && !hasLaterSameItemDislike(relation, resolved, identification) : basis !== "dislikes" && relation.sentiment === "positive");
    const caution = basis === "dislikes" || relation.sentiment === "negative";
    const item = { personId: relation.personId, basis, favorable: favorable && !caution, caution, mention: relation.itemMention, sourceIds: relation.sourceIds, observedAt: relation.atIso, at: relation.at ?? 0 };
    const current = best.get(relation.personId);
    if (!current || adviceRank(item) < adviceRank(current) || (adviceRank(item) === adviceRank(current) && item.at > current.at)) best.set(relation.personId, item);
  }
  return [...best.values()].sort((a, b) => adviceRank(a) - adviceRank(b) || b.at - a.at).slice(0, 2).map((item) => ({ personId: item.personId, basis: item.basis, favorable: item.favorable, caution: item.caution, mention: item.mention, sourceIds: item.sourceIds, observedAt: item.observedAt }));
}

// One line per person keeps the stage stream readable; the most decisive reason wins.
const codeOrder: RuledOutCode[] = ["superseded", "owns", "dislikes", "cancelled", "purchased_as_gift", "third_party", "misattributed", "different_item", "unverified_item", "needs_exact", "general_interest", "weaker", "low_confidence", "not_specific"];
function dedupeByPeople(items: RuledOut[], winnerIds = new Set<string>()) {
  const best = new Map<string, RuledOut>();
  for (const item of items) {
    if (winnerIds.has(item.personId)) continue;
    const current = best.get(item.personId);
    if (!current || codeOrder.indexOf(item.code) < codeOrder.indexOf(current.code)) best.set(item.personId, item);
  }
  return [...best.values()];
}

// ---- Copy (all generated here from typed fields; quoted words are verified source text) ----

const ruledOutCopy: Record<RuledOutCode, string> = {
  low_confidence: "only a loose connection to this",
  not_specific: "a second check found the link too loose for this specific thing",
  dislikes: "said they didn't like it",
  owns: "said they already have one",
  purchased_as_gift: "someone mentioned buying one for them",
  cancelled: "said that's off now",
  superseded: "a newer message changed the picture",
  third_party: "mentioned someone else's wish, not their own",
  general_interest: "only a general interest, nothing specific",
  needs_exact: "mentions a specific version this photo can't confirm",
  different_item: "mentions a different item",
  unverified_item: "the cited messages don't name this item",
  misattributed: "the cited words aren't theirs",
  weaker: "also connected, but a weaker reason",
};
const supersededCopy: Partial<Record<Relation, string>> = { owns: "a newer message says they already have one", dislikes: "a newer message says they didn't like it", cancelled: "a newer message says that's off" };

export function ruledOutMessage(item: RuledOut) {
  const why = item.code === "superseded" && item.contradiction ? supersededCopy[item.contradiction.relation] ?? ruledOutCopy.superseded
    : item.code === "different_item" && item.mention ? `mentions “${item.mention}”, not this one`
    : ruledOutCopy[item.code];
  return `Ruled out ${displayName(item.personId)}: ${why}.`;
}

export function adviceMessage(item: Advice) {
  const name = displayName(item.personId);
  if (item.basis === "recommended") return `${name} recommended it.`;
  if (item.basis === "dislikes") return `${name} didn't like it. Worth hearing why.`;
  const did = item.basis === "owns" ? "has one" : "has tried it";
  return item.favorable ? `${name} ${did} and spoke well of it.` : item.caution ? `${name} ${did} but had reservations.` : `${name} ${did}. They haven't said what they think.`;
}

export function caveatMessage(personId: string, caveat: Caveat) {
  const name = displayName(personId);
  if (caveat.reason === "gift_not_confirmed") return `A message mentions buying “${caveat.mention}” for ${name}. It doesn't say ${name} has it yet.`;
  const said = caveat.relation === "owns" ? "having" : caveat.relation === "dislikes" ? "not liking" : "cancelling";
  if (caveat.reason === "item_unconfirmed") return `${name} also mentioned ${said} “${caveat.mention}”. It isn't clear that's this exact item.`;
  return `${name} also mentioned ${said} “${caveat.mention}”, and it isn't clear which message came first.`;
}

const relationCopy: Record<Relation, string> = {
  wanted: "wanted one", asked_to_find: "asked you to find one", planned_together: "made a plan with you", recommended: "recommended it",
  gifted: "shared it with you", experienced_together: "shared it with you", owns: "has one", dislikes: "didn't like it", cancelled: "cancelled a plan", purchased_as_gift: "had one bought for them",
  inspired: "was inspired by it", prefers: "told you their taste", enjoys: "loves this", pursuing: "is working toward it",
};
export const relationLabel = (relation: Relation) => relationCopy[relation];

export function displayName(personId: string) {
  return personId.split(/[-_\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
