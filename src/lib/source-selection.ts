import type { Identification, Source } from "./decision";

const WORD = /[\p{L}\p{N}]+/gu;
const COMMON = new Set(["a", "an", "and", "for", "in", "it", "of", "on", "one", "the", "this", "to", "with"]);
export const SOURCE_INDEX_LIMIT = 1000;
export const EXTRACTION_LIMIT = 40;

function words(text: string) {
  return new Set((text.normalize("NFKC").toLowerCase().match(WORD) ?? []).filter((word) => word.length > 1 && !COMMON.has(word)));
}

function overlap(left: Set<string>, right: Set<string>) {
  let count = 0;
  for (const word of left) if (right.has(word)) count++;
  return count;
}

/**
 * Select a bounded relation-extraction window without pretending the rest of the
 * corpus does not exist. Direct lexical matches lead; neighboring messages keep
 * pronouns and short replies interpretable; recent messages fill spare capacity.
 */
export function selectSources(identification: Identification, sources: Source[], limit = EXTRACTION_LIMIT) {
  if (sources.length <= limit) return [...sources];
  const query = words([identification.item, identification.category, ...identification.searchTerms, ...identification.visibleText].join(" "));
  const ordered = [...sources].sort((a, b) => a.thread_id.localeCompare(b.thread_id) || (a.source_at ?? "").localeCompare(b.source_at ?? ""));
  const indexed = ordered.map((source, index) => ({
    source,
    index,
    score: overlap(query, words(source.original_text)),
    at: source.source_at ? Date.parse(source.source_at) || 0 : 0,
  }));
  const chosen = new Map<string, Source>();
  const add = (entry: (typeof indexed)[number] | undefined) => {
    if (entry && chosen.size < limit) chosen.set(entry.source.id, entry.source);
  };

  for (const entry of [...indexed].sort((a, b) => b.score - a.score || b.at - a.at)) {
    if (entry.score === 0 || chosen.size >= limit) break;
    add(entry);
    const previous = indexed[entry.index - 1];
    const next = indexed[entry.index + 1];
    if (previous?.source.thread_id === entry.source.thread_id) add(previous);
    if (next?.source.thread_id === entry.source.thread_id) add(next);
  }
  for (const entry of [...indexed].sort((a, b) => b.at - a.at)) add(entry);
  return [...chosen.values()].sort((a, b) => a.thread_id.localeCompare(b.thread_id) || (a.source_at ?? "").localeCompare(b.source_at ?? ""));
}
