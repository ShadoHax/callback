import { describe, expect, it } from "vitest";
import { shareableQuote } from "../src/lib/sharing";
import type { Source } from "../src/lib/decision";

const maya: Source = { id: "885edbf2-d497-4f6f-a2cf-342711970001", speaker_id: "maya", thread_id: "demo", participant_ids: ["owner", "maya"], original_text: "Send me a picture of the X100V.", source_at: null, is_synthetic: true };
const jordan: Source = { ...maya, id: "885edbf2-d497-4f6f-a2cf-342711970002", speaker_id: "jordan", participant_ids: ["owner", "jordan"], original_text: "My sister wants one." };

describe("optional excerpt sharing", () => {
  it("copies exact text authored by the selected recipient from cited evidence", () => {
    expect(shareableQuote(maya.id, "maya", [maya.id], [maya, jordan])).toEqual({ id: maya.id, text: maya.original_text, at: null });
  });
  it("rejects another person's words", () => expect(shareableQuote(jordan.id, "maya", [jordan.id], [maya, jordan])).toBeNull());
  it("rejects a source outside the scan evidence", () => expect(shareableQuote(maya.id, "maya", [jordan.id], [maya, jordan])).toBeNull());
  it("rejects a source where the recipient is not a participant", () => expect(shareableQuote(maya.id, "maya", [maya.id], [{ ...maya, participant_ids: ["owner"] }])).toBeNull());
});
