// The demo stories: M1 (a book → a friend's writing ambition) and V3 (coffee → a gift matched to their stated taste).
import { describe, expect, it } from "vitest";
import { decide, sameKind, type ExtractedRelation, type Identification, type Source } from "../src/lib/decision";
import { compareProductIdentity } from "../src/lib/product-identity";
import { selectIndexedRelations, type KnowledgeIndex } from "../src/lib/knowledge-index";
import { shoppingOptions, type ScanContext } from "../src/lib/commerce/options";
import { createQuote, type Order, type OrderStore } from "../src/lib/commerce/orders";
import { draftFor } from "../src/components/composer";

const id = (n: number) => `9a1c2b3d-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const src = (n: number, speaker: string, text: string, at: string): Source => ({ id: id(n), speaker_id: speaker, thread_id: speaker, participant_ids: ["owner", speaker], original_text: text, source_at: at, is_synthetic: true });
const rel = (personId: string, relation: ExtractedRelation["relation"], n: number[], extra: Partial<ExtractedRelation> = {}): ExtractedRelation =>
  ({ personId, subject: "person", relation, evidenceLevel: "exact_title", sentiment: "none", itemMention: "War and Peace", sourceIds: n.map(id), ...extra });

const book: Identification = { entityKind: "object", item: "War and Peace by Leo Tolstoy", title: "War and Peace", edition: "Penguin Classics", category: "book", specificity: "exact_title", visibleText: ["WAR AND PEACE", "LEO TOLSTOY"], searchTerms: ["War and Peace", "Tolstoy"], ambiguity: "" };
const coffee: Identification = { entityKind: "object", item: "Demo Roasters Colombia coffee beans", title: "Colombia", edition: "", category: "coffee beans", specificity: "exact_title", visibleText: ["COLOMBIA", "MEDIUM ROAST", "WHOLE BEAN"], searchTerms: ["coffee", "coffee beans"], ambiguity: "" };

const sources = [
  src(1, "maya", "War and Peace inspired me to try writing a novel, but I haven't started. The first chapter is still just in my head.", "2026-09-12T20:00:00Z"),
  src(2, "maya", "Random, but if you ever want to get me something: I like light-roast whole beans for pour-over. Dark roasts aren't my thing.", "2026-09-19T15:00:00Z"),
  src(3, "priya", "I tried War and Peace last summer and gave up after 50 pages. Way too long for me.", "2026-09-14T18:00:00Z"),
  src(4, "jordan", "My sister keeps saying she wants to read War and Peace before she turns 30.", "2026-09-17T01:00:00Z"),
  src(5, "sam", "You have to read Anna Karenina. Best book I've ever read.", "2026-09-10T22:00:00Z"),
  src(6, "priya", "I quit coffee last month. Tea only now.", "2026-09-21T14:00:00Z"),
];

describe("M1: a book recalls a friend's ambition", () => {
  const relations = [
    rel("maya", "inspired", [1], { activity: "try writing a novel" }),
    rel("priya", "dislikes", [3], { sentiment: "negative" }),
    rel("jordan", "wanted", [4], { subject: "third_party" }),
  ];

  it("finds Maya, explains it in her own words, and rules the others out", () => {
    const decision = decide({ identification: book, relations, sources, ownerIds: [] });
    expect(decision.status).toBe("matched");
    expect(decision.connection).toMatchObject({ personId: "maya", relation: "inspired", activity: "try writing a novel", reason: "War and Peace inspired Maya to try writing a novel." });
    expect(Object.fromEntries(decision.ruledOut.map((item) => [item.personId, item.code]))).toEqual({ priya: "dislikes", jordan: "third_party" });
    expect(draftFor({ relation: "inspired", mention: "War and Peace", activity: "try writing a novel" })).toBe("Saw War and Peace and remembered it inspired you to try writing a novel. How's it going? No pressure, just curious.");
  });

  it("never shows an ambition that isn't copied from her words", () => {
    const decision = decide({ identification: book, relations: [rel("maya", "inspired", [1], { activity: "become a famous author" })], sources, ownerIds: [] });
    expect(decision.connection?.activity).toBeUndefined();
    expect(decision.connection?.reason).toBe("Maya said it inspired something they want to do.");
  });

  it("drops the callback once she says she gave it up", () => {
    const later = src(7, "maya", "Update: I stopped writing the War and Peace-inspired novel. Not for me right now.", "2026-09-25T12:00:00Z");
    const decision = decide({ identification: book, relations: [...relations, rel("maya", "cancelled", [7])], sources: [...sources, later], ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.ruledOut.find((item) => item.personId === "maya")?.code).toBe("superseded");
  });

  it("treats any copy of the book as the same work, but not a different book", () => {
    expect(compareProductIdentity("War and Peace", book)).toBe("same");
    expect(compareProductIdentity("Anna Karenina", book)).not.toBe("same");
    const anna: Identification = { ...book, item: "Anna Karenina", title: "Anna Karenina", visibleText: ["ANNA KARENINA"], searchTerms: ["Anna Karenina"] };
    expect(decide({ identification: anna, relations, sources, ownerIds: [] }).status).not.toBe("matched");
  });
});

describe("V3: coffee → a gift matched to her taste", () => {
  const relations = [
    rel("maya", "prefers", [2], { itemMention: "light-roast whole beans", evidenceLevel: "product_family", sentiment: "positive" }),
    rel("maya", "dislikes", [2], { itemMention: "Dark roasts", evidenceLevel: "category", sentiment: "negative" }),
    rel("priya", "dislikes", [6], { itemMention: "coffee", evidenceLevel: "category", sentiment: "negative" }),
  ];

  it("matches Maya by kind with her likes and avoids, with no contradiction caveat", () => {
    const decision = decide({ identification: coffee, relations, sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "maya", relation: "prefers", caveats: [], preferences: { likes: ["light-roast whole beans"], avoids: ["Dark roasts"] } });
    expect(decision.connection?.reason).toBe("Maya told you they like “light-roast whole beans”.");
    expect(decision.ruledOut.map((item) => [item.personId, item.code])).toEqual([["priya", "dislikes"]]);
  });

  it("selects tastes by kind of thing, not by product name", () => {
    expect(sameKind("coffee", coffee)).toBe(true);
    expect(sameKind("coffee", { category: "coffee cup", item: "paper coffee cup", searchTerms: [] })).toBe(true);
    expect(sameKind("coffee beans", { category: "coffee", item: "coffee bag", searchTerms: [] })).toBe(true);
    expect(sameKind("coffee", book)).toBe(false);
    expect(sameKind("coffee", { category: "mug", item: "plain white mug", searchTerms: [] })).toBe(false);
    const index = { relations: [{ ...relations[0], itemCategory: "coffee", aliases: [] }, { ...rel("maya", "inspired", [1]), itemCategory: "book", aliases: [] }] } as unknown as KnowledgeIndex;
    expect(selectIndexedRelations(coffee, index).map((item) => item.relation)).toEqual(["prefers"]);
    expect(selectIndexedRelations(book, index).map((item) => item.relation)).toEqual(["inspired"]);
  });

  const context: ScanContext = {
    observed: { item: coffee.item, title: coffee.title, category: coffee.category, specificity: "exact_title", searchTerms: coffee.searchTerms },
    connection: { personId: "maya", relation: "prefers", caveats: [], mention: "light-roast whole beans", preferences: { likes: ["light-roast whole beans for pour-over"], avoids: ["Dark roasts"] } },
    advice: [],
  };
  const gift = { kind: "gift" as const, personId: "maya" };

  it("ranks the demo coffee by her words, excludes what she avoids, and respects the budget", () => {
    const result = shoppingOptions(context, { budgetCents: 2500, purpose: gift });
    expect(result.options.map((option) => option.productId)).toEqual(["ethiopia-light-whole", "kenya-light-ground", "colombia-medium-whole"]);
    expect(result.options[0].reasons[0]).toBe("Fits what Maya said, “light-roast whole beans for pour-over”: light roast, whole bean, pour-over.");
    expect(result.options[1].tradeoffs).toContain("Not whole bean, which Maya mentioned.");
    expect(result.options.every((option) => option.match === "related")).toBe(true);
    const why = Object.fromEntries(result.excluded.map((item) => [item.productId, item.why]));
    expect(why["french-dark-whole"]).toBe("Maya said “Dark roasts” isn't for them");
    expect(why["light-sampler-box"]).toMatch(/over your \$25\.00 budget/);
    expect(result.personalization[0]).toMatch(/Maya didn't ask for it, and nothing is paid until you approve/);
  });

  it("offers a gift from a stated taste but never a shared-plan purpose, and quotes the chosen coffee", async () => {
    expect(result(() => shoppingOptions(context, { budgetCents: 2500, purpose: { kind: "together", personId: "maya" } }))).toMatch(/purpose/);
    const orders: Order[] = [];
    const store = { async getByRequest() { return null; }, async insert(order: Order) { const saved = { ...order, id: "order-1" }; orders.push(saved); return saved; } } as unknown as OrderStore;
    const order = await createQuote(store, { ownerId: "alex", scanId: "scan-1", context, productId: "ethiopia-light-whole", budgetCents: 2500, purpose: gift, clientRequestId: "req-1", now: new Date("2026-09-26T12:00:00Z") });
    expect(order).toMatchObject({ product_id: "ethiopia-light-whole", subtotal_cents: 1600, shipping_cents: 599, tax_cents: 112, total_cents: 2311 });
  });
});

function result(run: () => unknown) { try { run(); return ""; } catch (error) { return (error as Error).message; } }
