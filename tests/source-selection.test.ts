import { describe, expect, it } from "vitest";
import { selectSources } from "../src/lib/source-selection";
import type { Identification, Source } from "../src/lib/decision";

const identification: Identification = { item: "Fujifilm X100V", category: "camera", specificity: "exact_title", visibleText: ["X100V"], searchTerms: ["Fuji", "X100 V"], ambiguity: "" };
const source = (index: number, text: string, thread = `thread-${index}`): Source => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  speaker_id: `person-${index}`,
  thread_id: thread,
  participant_ids: ["owner", `person-${index}`],
  original_text: text,
  source_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  is_synthetic: true,
});

describe("selectSources", () => {
  it("keeps the full corpus when it fits", () => {
    const sources = [source(1, "hello"), source(2, "world")];
    expect(selectSources(identification, sources, 40)).toEqual(sources);
  });

  it("prioritizes item matches and adjacent context", () => {
    const sources = Array.from({ length: 50 }, (_, index) => source(index + 1, `unrelated message ${index}`));
    sources[9] = source(10, "I have been saving for it", "maya");
    sources[10] = source(11, "Please send me a photo if you see an X100V", "maya");
    sources[11] = source(12, "especially the silver one", "maya");
    const selected = selectSources(identification, sources, 8);
    expect(selected.map((item) => item.id)).toEqual(expect.arrayContaining([sources[9].id, sources[10].id, sources[11].id]));
    expect(selected).toHaveLength(8);
  });

  it("fills an empty lexical result with the most recent messages", () => {
    const sources = Array.from({ length: 45 }, (_, index) => source(index + 1, "unrelated"));
    const selected = selectSources({ ...identification, item: "zither", category: "instrument", searchTerms: [], visibleText: [] }, sources, 3);
    expect(selected.map((item) => item.id)).toEqual(sources.slice(-3).map((item) => item.id));
  });
});
