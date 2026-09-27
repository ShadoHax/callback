import { describe, expect, it } from "vitest";
import { decide, type ExtractedRelation, type Identification, type Source } from "../src/lib/decision";

const id = (n: number) => `a1b2c3d4-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const source = (n: number, speaker: string, text: string, at: string | null): Source => ({
  id: id(n), speaker_id: speaker, thread_id: "coffee", participant_ids: ["owner", "maya", "priya"], original_text: text, source_at: at, is_synthetic: true,
});
const relation = (n: number, kind: ExtractedRelation["relation"], mention: string, extra: Partial<ExtractedRelation> = {}): ExtractedRelation => ({
  personId: "maya", subject: "person", relation: kind, evidenceLevel: "category", itemMention: mention,
  sentiment: kind === "dislikes" ? "negative" : "positive", sourceIds: [id(n)], ...extra,
});
const coffee: Identification = {
  entityKind: "object", item: "bag of coffee beans", title: "", edition: "", category: "coffee beans", specificity: "category",
  visibleText: [], searchTerms: ["coffee"], ambiguity: "",
};
const decideCoffee = (sources: Source[], relations: ExtractedRelation[]) => decide({ identification: coffee, sources, relations, ownerIds: [] });

describe("preference lifecycle", () => {
  it("closes a coffee taste when the person later rejects coffee as a whole", () => {
    const sources = [source(1, "maya", "I like light-roast whole beans.", "2026-09-01T00:00:00Z"),
      source(2, "maya", "I quit coffee. Tea only now.", "2026-09-20T00:00:00Z")];
    const result = decideCoffee(sources, [relation(1, "prefers", "light-roast whole beans"), relation(2, "dislikes", "coffee")]);
    expect(result.status).toBe("no_match");
    expect(result.ruledOut).toMatchObject([{ personId: "maya", code: "superseded", contradiction: { relation: "dislikes", sourceIds: [id(2)] } }]);
  });

  it("keeps a light-roast taste when only dark roasts are disliked", () => {
    const sources = [source(1, "maya", "I like light-roast whole beans.", "2026-09-01T00:00:00Z"),
      source(2, "maya", "Dark roasts aren't my thing.", "2026-09-20T00:00:00Z")];
    const result = decideCoffee(sources, [relation(1, "prefers", "light-roast whole beans"), relation(2, "dislikes", "Dark roasts")]);
    expect(result.connection).toMatchObject({ personId: "maya", caveats: [], preferences: { likes: ["light-roast whole beans"], avoids: ["Dark roasts"] } });
  });

  it("retires an older avoid after a later explicit preference for the same taste", () => {
    const sources = [source(1, "maya", "Dark roasts aren't my thing.", "2026-09-01T00:00:00Z"),
      source(2, "maya", "I like dark roasts now.", "2026-09-20T00:00:00Z")];
    const result = decideCoffee(sources, [relation(1, "dislikes", "Dark roasts"), relation(2, "prefers", "dark roasts")]);
    expect(result.connection).toMatchObject({ caveats: [], preferences: { likes: ["dark roasts"], avoids: [] } });
  });

  it("includes only surviving tastes in gift preferences", () => {
    const sources = [source(1, "maya", "I like light-roast whole beans.", "2026-09-01T00:00:00Z"),
      source(2, "maya", "I don't like light-roast whole beans anymore.", "2026-09-10T00:00:00Z"),
      source(3, "maya", "I like dark roasts now.", "2026-09-20T00:00:00Z")];
    const result = decideCoffee(sources, [relation(1, "prefers", "light-roast whole beans"), relation(2, "dislikes", "light-roast whole beans"), relation(3, "prefers", "dark roasts")]);
    expect(result.connection).toMatchObject({ mention: "dark roasts", preferences: { likes: ["dark roasts"], avoids: ["light-roast whole beans"] } });
  });

  it("keeps an unresolved contradiction visible when a date is unknown", () => {
    const sources = [source(1, "maya", "I like light-roast whole beans.", "2026-09-01T00:00:00Z"),
      source(2, "maya", "I quit coffee. Tea only now.", null)];
    const result = decideCoffee(sources, [relation(1, "prefers", "light-roast whole beans"), relation(2, "dislikes", "coffee")]);
    expect(result.connection).toMatchObject({ caveats: [{ relation: "dislikes", reason: "order_unknown" }], preferences: { likes: ["light-roast whole beans"], avoids: ["coffee"] } });
  });

  it("does not let another person's, third-party, unverified, or unrelated-category negatives close the callback", () => {
    const sources = [source(1, "maya", "I like light-roast whole beans.", "2026-09-01T00:00:00Z"),
      source(2, "priya", "I quit coffee.", "2026-09-20T00:00:00Z"),
      source(3, "maya", "My sister quit coffee.", "2026-09-21T00:00:00Z"),
      source(4, "maya", "Tea only now.", "2026-09-22T00:00:00Z"),
      source(5, "maya", "I quit tea.", "2026-09-23T00:00:00Z")];
    const result = decideCoffee(sources, [relation(1, "prefers", "light-roast whole beans"),
      relation(2, "dislikes", "coffee", { personId: "priya" }),
      relation(3, "dislikes", "coffee", { subject: "third_party" }),
      relation(4, "dislikes", "coffee"),
      relation(5, "dislikes", "tea")]);
    expect(result.connection).toMatchObject({ personId: "maya", caveats: [], preferences: { likes: ["light-roast whole beans"] } });
    expect(result.connection?.preferences?.avoids).not.toContain("coffee");
  });

  it("never attributes the owner's ambition to a friend in an inspired callback", () => {
    const book: Identification = { ...coffee, item: "War and Peace", title: "War and Peace", category: "book", specificity: "exact_title", searchTerms: ["War and Peace"] };
    const sources = [source(6, "owner", "I want to try writing a novel.", "2026-09-01T00:00:00Z"),
      source(7, "maya", "War and Peace inspired me to paint.", "2026-09-02T00:00:00Z")];
    const result = decide({ identification: book, sources, ownerIds: [], relations: [
      relation(7, "inspired", "War and Peace", { evidenceLevel: "exact_title", activity: "try writing a novel", sourceIds: [id(6), id(7)] }),
    ] });
    expect(result.connection).toMatchObject({ personId: "maya", relation: "inspired", reason: "Maya said it inspired something they want to do." });
    expect(result.connection?.activity).toBeUndefined();
  });
});
