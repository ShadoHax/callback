import { expect, it } from "vitest";
import { corpusRevision } from "../src/lib/corpus";

const a = { id: "a", speaker_id: "maya", thread_id: "one", participant_ids: ["owner", "maya"], original_text: "I want the camera", source_at: null, is_synthetic: true };
const b = { id: "b", speaker_id: "noah", thread_id: "two", participant_ids: ["owner", "noah"], original_text: "I own the camera", source_at: null, is_synthetic: true };

it("is independent of query ordering and changes after an update", () => {
  expect(corpusRevision([a, b])).toBe(corpusRevision([b, a]));
  expect(corpusRevision([a, b])).not.toBe(corpusRevision([a, { ...b, original_text: "I sold the camera" }]));
});
