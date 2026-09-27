// Model-free check of the stage story: given the relations a correct extractor returns for the synthetic demo bundle
// (the shape Meta muse-spark-1.3 produced in 3/3 local builds on September 26), the rules produce the narrated
// outcomes. This is not a live-model result.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decide, ruledOutMessage, type ExtractedRelation, type Identification, type Source } from "../src/lib/decision";
import { Bundle, stableSourceId } from "../src/lib/demo-data";
import { shoppingOptions } from "../src/lib/commerce/options";

const owner = "11111111-1111-4111-8111-111111111111";
const sources = Bundle.parse(JSON.parse(readFileSync("fixtures/synthetic-demo.json", "utf8"))).sources.map((source) => ({ ...source, id: stableSourceId(owner, source) })) as Source[];
const find = (text: string) => { const hit = sources.find((source) => source.original_text.includes(text)); if (!hit) throw new Error(`fixture text not found: ${text}`); return hit; };
const rel = (personId: string, relation: ExtractedRelation["relation"], texts: string[], itemMention: string, extra: Partial<ExtractedRelation> = {}): ExtractedRelation => ({ personId, subject: "person", relation, evidenceLevel: "exact_title", sentiment: "none", itemMention, sourceIds: texts.map((text) => find(text).id), ...extra });
const update = (speaker: string, text: string, at: string): Source => { const record = { speaker_id: speaker, thread_id: `demo-update-${speaker}`, participant_ids: ["owner", speaker], original_text: text, source_at: at, is_synthetic: true }; return { ...record, id: stableSourceId(owner, record) }; };

const book: Identification = { entityKind: "object", item: "War and Peace by Leo Tolstoy", title: "War and Peace", edition: "", category: "book", specificity: "exact_title", visibleText: ["WAR AND PEACE", "LEO TOLSTOY"], searchTerms: ["War and Peace", "Tolstoy"], ambiguity: "" };
const otherBook: Identification = { ...book, item: "Anna Karenina by Leo Tolstoy", title: "Anna Karenina", visibleText: ["ANNA KARENINA"], searchTerms: ["Anna Karenina"] };
const coffee: Identification = { entityKind: "object", item: "Sunrise Coffee Co. House Blend coffee beans", title: "House Blend", edition: "", category: "coffee beans", specificity: "exact_title", visibleText: ["MEDIUM ROAST", "WHOLE BEAN COFFEE"], searchTerms: ["coffee", "coffee beans"], ambiguity: "" };

const relations = [
  rel("maya", "inspired", ["War and Peace inspired me"], "War and Peace", { activity: "try writing a novel" }),
  rel("maya", "prefers", ["I like light-roast whole beans"], "light-roast whole beans", { evidenceLevel: "category", sentiment: "positive" }),
  rel("maya", "dislikes", ["I like light-roast whole beans"], "Dark roasts", { evidenceLevel: "category", sentiment: "negative" }),
  rel("priya", "dislikes", ["I tried War and Peace"], "War and Peace", { sentiment: "negative" }),
  rel("priya", "dislikes", ["I quit coffee"], "coffee", { evidenceLevel: "category", sentiment: "negative" }),
  rel("jordan", "wanted", ["My sister keeps saying"], "War and Peace", { subject: "third_party" }),
  rel("sam", "recommended", ["You have to read Anna Karenina"], "Anna Karenina"),
  rel("leo", "wanted", ["I'm into classic novels"], "classic novels", { evidenceLevel: "category" }),
];
// What memory retrieval passes on for each photo: the same kind of thing (book / coffee), as selectIndexedRelations does.
const bookRelations = relations.filter((item) => !["light-roast whole beans", "Dark roasts", "coffee"].includes(item.itemMention));
const coffeeRelations = relations.filter((item) => ["light-roast whole beans", "Dark roasts", "coffee"].includes(item.itemMention));

it("M1: War and Peace recalls Maya's novel, in her own words; everyone else is explained", () => {
  const decision = decide({ identification: book, relations: bookRelations, sources, ownerIds: [owner] });
  expect(decision.connection).toMatchObject({ personId: "maya", relation: "inspired", activity: "try writing a novel", caveats: [] });
  expect(decision.connection?.reason).toBe("War and Peace inspired Maya to try writing a novel.");
  expect(decision.ruledOut.map(ruledOutMessage).sort()).toEqual([
    "Ruled out Jordan: mentioned someone else's wish, not their own.",
    "Ruled out Leo: only a general interest, nothing specific.",
    "Ruled out Priya: said they didn't like it.",
    "Ruled out Sam: mentions “Anna Karenina”, not this one.",
  ]);
});

it("M1: a different book finds a different friend (Sam recommended Anna Karenina)", () => {
  const decision = decide({ identification: otherBook, relations: bookRelations, sources, ownerIds: [owner] });
  expect(decision.connection).toMatchObject({ personId: "sam", relation: "recommended" });
});

it("M1 live update: once Maya says she stopped writing it, the callback goes away", () => {
  const stopped = update("maya", "Honestly I stopped writing the War and Peace novel. Not for me right now.", "2026-09-26T12:00:00Z");
  const withUpdate = [...sources, stopped];
  const decision = decide({ identification: book, relations: [...bookRelations, { ...rel("maya", "cancelled", ["War and Peace inspired me"], "War and Peace"), sourceIds: [stopped.id] }], sources: withUpdate, ownerIds: [owner] });
  expect(decision.status).toBe("no_match");
  expect(decision.ruledOut.map(ruledOutMessage)).toContain("Ruled out Maya: a newer message says that's off.");
});

it("V3: coffee finds Maya's taste, rules out Priya, and the store ranks what she'd actually drink", () => {
  const decision = decide({ identification: coffee, relations: coffeeRelations, sources, ownerIds: [owner] });
  expect(decision.connection).toMatchObject({ personId: "maya", relation: "prefers", preferences: { likes: ["light-roast whole beans"], avoids: ["Dark roasts"] } });
  expect(decision.ruledOut.map(ruledOutMessage)).toEqual(["Ruled out Priya: said they didn't like it."]);
  const options = shoppingOptions({ observed: coffee, connection: { personId: "maya", relation: "prefers", caveats: [], mention: decision.connection!.mention, preferences: decision.connection!.preferences }, advice: [] }, { budgetCents: 2500, purpose: { kind: "gift", personId: "maya" } });
  expect(options.options[0]).toMatchObject({ productId: "ethiopia-light-whole", totals: { totalCents: 2311 } });
  expect(options.excluded.filter((item) => /Dark roasts/.test(item.why)).map((item) => item.productId).sort()).toEqual(["espresso-dark-whole", "french-dark-whole"]);
});

it("an unrelated object: no supported connection and no advice", () => {
  const bottle: Identification = { entityKind: "object", item: "water bottle", title: "", edition: "", category: "water bottle", specificity: "category", visibleText: ["HYDRATE"], searchTerms: ["water bottle"], ambiguity: "" };
  const decision = decide({ identification: bottle, relations: [], sources, ownerIds: [owner] });
  expect(decision.status).toBe("no_match");
  expect(decision.advice).toEqual([]);
});
