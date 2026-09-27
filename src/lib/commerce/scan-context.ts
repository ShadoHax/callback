import type { SupabaseClient } from "@supabase/supabase-js";
import { corpusRevision } from "../corpus";
import { SOURCE_INDEX_LIMIT } from "../source-selection";
import type { Preferences } from "../decision";
import type { ScanContext } from "./options";

type StoredScan = { id: string; result: Record<string, unknown> & { identification?: ScanContext["observed"] }; trace?: { type: string; identification?: ScanContext["observed"] }[]; corpus_revision: string };

// Shopping uses the same evidence as the scan, and only while that evidence is current: after a context change
// (for example a demo update or reset) the shopper must scan again, just as for sending.
export async function currentScanContext(client: SupabaseClient, ownerId: string, scanId: string): Promise<{ scan: StoredScan; context: ScanContext } | { error: string; status: number }> {
  const { data: scan } = await client.from("scans").select("id,result,trace,corpus_revision").eq("id", scanId).eq("owner_id", ownerId).maybeSingle();
  if (!scan?.result) return { error: "Scan not found.", status: 404 };
  const { data: sources, error } = await client.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", ownerId).limit(SOURCE_INDEX_LIMIT + 1);
  if (error || (sources?.length ?? 0) > SOURCE_INDEX_LIMIT) return { error: "Could not verify the current context.", status: 503 };
  if (corpusRevision(sources ?? []) !== scan.corpus_revision) return { error: "Context changed since this scan. Scan again.", status: 409 };
  const result = (scan as StoredScan).result as Record<string, never> & StoredScan["result"];
  const observed = result.identification ?? (scan as StoredScan).trace?.find((event) => event.type === "entity_identified")?.identification ?? { item: String(result.observedEntity ?? ""), specificity: (result.specificity as "category") ?? "category" };
  const preferences = result.preferences as Preferences | undefined;
  const connection = result.status === "matched" ? { personId: String(result.person), relation: String(result.relation), caveats: ((result.caveats ?? []) as { reason: string; message: string }[]),
    mention: String(result.mention ?? ""), ...(preferences ? { preferences } : {}) } : null;
  const advice = ((result.advice ?? []) as ScanContext["advice"]).map((item) => ({ personId: item.personId, basis: item.basis, favorable: item.favorable, caution: item.caution, mention: item.mention, message: item.message }));
  return { scan: scan as StoredScan, context: { observed, connection, advice } };
}
