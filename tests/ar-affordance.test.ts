import { expect, it } from "vitest";
import { decide, type Identification, type Source } from "../src/lib/decision";
import { INDEX_PROMPT_VERSION, relationsForPhoto, type KnowledgeIndex } from "../src/lib/knowledge-index";

const source = (id: string, text: string): Source => ({ id, speaker_id: "alex", thread_id: "plan",
  participant_ids: ["owner", "alex"], original_text: text, source_at: "2026-09-25T00:00:00Z", is_synthetic: false });
const photo = (item: string, category: string, topic: string): Identification => ({ entityKind: "object",
  item, category, specificity: "category", visibleText: [], searchTerms: [], ambiguity: "",
  topicMatches: topic ? [{ topic, confidence: 0.95, specific: true }] : [] });
const index = (topic: string, mention: string, category: string, cue: string, citation: Source): KnowledgeIndex => ({
  revision: "a".repeat(64), provider: "meta", model: "test", promptVersion: INDEX_PROMPT_VERSION, sourceCount: 1,
  relations: [{ personId: "alex", subject: "person", relation: "planned_together", evidenceLevel: "category",
    itemMention: mention, itemCategory: category, sentiment: "none", sourceIds: [citation.id], aliases: [],
    topic, cues: [cue], strength: 0.9 }],
});

it.each([
  ["banana", "fruit", "banana bread", "banana bread", "banana bread", "banana fruit", "Let's bake banana bread together."],
  ["bag of flour", "baking ingredient", "baking", "baking", "baking", "flour bag", "Let's do some baking together."],
])("can connect %s to an explicitly planned activity via a prepared visual cue", (item, category, topic, mention, memoryCategory, cue, quote) => {
  const citation = source("885edbf2-d497-4f6f-a2cf-342711970001", quote);
  const identification = photo(item, category, topic);
  const relations = relationsForPhoto(identification, index(topic, mention, memoryCategory, cue, citation), { activityCues: true });
  expect(relations).toHaveLength(1);
  expect(relations[0].matchConfidence).toBeGreaterThan(0.8);
  const decision = decide({ identification, relations, sources: [citation], ownerIds: ["owner"] });
  expect(decision.connection).toMatchObject({ personId: "alex", relation: "planned_together", sourceIds: [citation.id] });
});

it("does not invent a relationship for an unrelated visible object", () => {
  const citation = source("885edbf2-d497-4f6f-a2cf-342711970001", "Let's do some baking together.");
  const identification = photo("wireless headphones", "electronics", "");
  const relations = relationsForPhoto(identification, index("baking", "baking", "baking", "flour bag", citation), { activityCues: true });
  expect(relations).toEqual([]);
  expect(decide({ identification, relations, sources: [citation], ownerIds: ["owner"] }).connection).toBeNull();
});

it("uses a concrete prepared vessel cue for a shared plan without identifying hidden contents", () => {
  const citation = source("885edbf2-d497-4f6f-a2cf-342711970001", "Let's catch up over coffee this weekend.");
  const prepared = index("coffee", "coffee", "coffee", "coffee cup", citation);
  prepared.relations[0].strength = 0.4;
  const identification = photo("disposable cup with lid", "cup", "");
  const ordinary = relationsForPhoto(identification, prepared);
  expect(ordinary).toEqual([]);
  const relations = relationsForPhoto(identification, prepared, { activityCues: true });
  expect(relations).toMatchObject([{ relation: "planned_together", matchConfidence: 0.75 }]);
  expect(identification.item).toBe("disposable cup with lid");
  expect(decide({ identification, relations, sources: [citation], ownerIds: ["owner"] }).connection)
    .toMatchObject({ personId: "alex", relation: "planned_together" });
  expect(relationsForPhoto(photo("side table", "table", ""), prepared, { activityCues: true })).toEqual([]);
});
