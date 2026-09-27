// Model-free rehearsal of the five synthetic booth stories. This verifies the
// deterministic decision layer given the relations a correct extractor returns;
// it is not evidence that a camera/model recognized the props.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adviceMessage, decide, type ExtractedRelation, type Identification, type Source } from "../src/lib/decision";
import { Bundle, stableSourceId } from "../src/lib/demo-data";

const owner = "22222222-2222-4222-8222-222222222222";
const sources = Bundle.parse(JSON.parse(readFileSync("fixtures/synthetic-booth-cases.json", "utf8"))).sources
  .map((source) => ({ ...source, id: stableSourceId(owner, source) })) as Source[];

const find = (text: string) => {
  const source = sources.find((item) => item.original_text.includes(text));
  if (!source) throw new Error(`fixture text not found: ${text}`);
  return source;
};
const identification = (item: string, category: string, title = item, entityKind: "object" | "place" = "object"): Identification => ({
  entityKind, item, title, category, specificity: "exact_title", visibleText: [title], searchTerms: [title], ambiguity: "",
});
const relation = (personId: string, kind: ExtractedRelation["relation"], text: string, itemMention: string, extra: Partial<ExtractedRelation> = {}): ExtractedRelation => ({
  personId, subject: "person", relation: kind, evidenceLevel: "exact_title", sentiment: "none", itemMention,
  sourceIds: [find(text).id], ...extra,
});

describe("synthetic booth cases", () => {
  it("book: turns Noah's recommendation into a callback", () => {
    const result = decide({
      identification: identification("The Hobbit", "book"), sources, ownerIds: [owner],
      relations: [relation("noah", "recommended", "You should read The Hobbit", "The Hobbit", { sentiment: "positive" })],
    });
    expect(result.connection).toMatchObject({ personId: "noah", relation: "recommended", mention: "The Hobbit" });
  });

  it("snack: recovers Maya's plan to try it together", () => {
    const result = decide({
      identification: identification("Trader Joe's Speculoos Cookie Butter", "snack"), sources, ownerIds: [owner],
      relations: [relation("maya", "planned_together", "Let's try the Trader Joe's", "Trader Joe's Speculoos Cookie Butter")],
    });
    expect(result.connection).toMatchObject({ personId: "maya", relation: "planned_together" });
  });

  it("camera: shows Priya as cautionary advice, not a reconnect", () => {
    const result = decide({
      identification: identification("Fujifilm X100V", "camera"), sources, ownerIds: [owner],
      relations: [relation("priya", "dislikes", "I tried the Fujifilm X100V", "Fujifilm X100V", { sentiment: "negative" })],
    });
    expect(result.connection).toBeNull();
    expect(result.advice).toHaveLength(1);
    expect(result.advice[0]).toMatchObject({ personId: "priya", basis: "dislikes", caution: true, favorable: false });
    expect(adviceMessage(result.advice[0])).toContain("didn't like it");
  });

  it("concert poster: preserves the two-person group callback", () => {
    const result = decide({
      identification: identification("Chappell Roan show poster", "concert", "Chappell Roan show"), sources, ownerIds: [owner],
      relations: [
        relation("maya", "planned_together", "We should all go to the Chappell Roan show", "Chappell Roan show"),
        relation("noah", "planned_together", "let's get tickets for the Chappell Roan show", "Chappell Roan show"),
      ],
    });
    expect(result.connections.map((item) => item.personId).sort()).toEqual(["maya", "noah"]);
    expect(result.connections.every((item) => item.relation === "planned_together")).toBe(true);
  });

  it("restaurant: matches a place only to the explicit open plan", () => {
    const result = decide({
      identification: identification("Portillo's", "restaurant", "Portillo's", "place"), sources, ownerIds: [owner],
      relations: [relation("maya", "planned_together", "We should go to Portillo's", "Portillo's")],
    });
    expect(result.connection).toMatchObject({ personId: "maya", relation: "planned_together", mention: "Portillo's" });
  });
});
