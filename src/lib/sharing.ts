import type { Source } from "./decision";

export function shareableQuote(sourceId: string, personId: string, citedSourceIds: string[], sources: Source[]) {
  const source = sources.find((item) => item.id === sourceId);
  if (!source || !citedSourceIds.includes(source.id)) return null;
  if (source.speaker_id !== personId || !source.participant_ids.includes(personId)) return null;
  return { id: source.id, text: source.original_text, at: source.source_at };
}
