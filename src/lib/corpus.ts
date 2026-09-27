import { createHash } from "node:crypto";

type RevisionSource = { id: string; speaker_id: string; thread_id: string; participant_ids: string[]; original_text: string; source_at: string | null; is_synthetic: boolean };

export function corpusRevision(sources: RevisionSource[]) {
  const canonical = [...sources].sort((a, b) => a.id.localeCompare(b.id)).map((source) => [source.id, source.speaker_id, source.thread_id, source.participant_ids, source.original_text, source.source_at, source.is_synthetic]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
