import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const SOURCE_LIMIT = 1000;

const Record = z.object({
  id: z.string().uuid().optional(), speaker_id: z.string().min(1).max(100), thread_id: z.string().min(1).max(200),
  participant_ids: z.array(z.string().max(100)), original_text: z.string().min(1).max(3000),
  source_at: z.string().datetime({ offset: true }).nullable(), is_synthetic: z.boolean(),
});
export const Bundle = z.object({ label: z.string().min(1), sources: z.array(Record).min(1).max(SOURCE_LIMIT) });
export type Bundle = z.infer<typeof Bundle>;

// A stable per-owner ID lets the same bundle be imported again without duplicates, and two owners never collide.
export function stableSourceId(ownerId: string, record: z.infer<typeof Record>) {
  const hex = createHash("sha256").update(JSON.stringify([ownerId, record.thread_id, record.speaker_id, record.source_at, record.original_text])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Idempotent, owner-scoped import. Refuses if any source ID already belongs to another owner. */
export async function importBundle(admin: SupabaseClient, ownerId: string, bundle: Bundle) {
  const rows = bundle.sources.map((source) => ({ ...source, id: source.id ?? stableSourceId(ownerId, source), owner_id: ownerId, origin: "import" }));
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) throw new Error("The bundle contains duplicate sources.");
  const { data: existing, error: lookupError } = await admin.from("sources").select("id,owner_id").in("id", ids);
  if (lookupError) throw new Error(`Could not check existing sources: ${lookupError.message}`);
  const foreign = (existing ?? []).filter((row) => row.owner_id !== ownerId);
  if (foreign.length) throw new Error(`Refusing to import: ${foreign.length} source ID(s) already belong to another owner. Remove explicit ids from the bundle or use new ones.`);
  const { error } = await admin.from("sources").upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`Import failed: ${error.message}`);
  const { count } = await admin.from("sources").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
  return { imported: rows.length, updated: existing?.length ?? 0, total: count ?? null, overLimit: (count ?? 0) > SOURCE_LIMIT };
}

export async function mapContact(admin: SupabaseClient, ownerId: string, personId: string, recipientId: string) {
  if (recipientId === ownerId) throw new Error("A contact cannot map to the scanner's own account.");
  const { error } = await admin.from("contacts").upsert({ owner_id: ownerId, person_id: personId, recipient_id: recipientId }, { onConflict: "owner_id,person_id" });
  if (error) throw new Error(`Contact mapping failed: ${error.message}`);
}

/** Deletes only synthetic messages added during demo sessions for this owner. Imported originals and other users are untouched. */
export async function resetDemoUpdates(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client.from("sources").delete().eq("owner_id", ownerId).eq("origin", "demo_update").eq("is_synthetic", true).select("id");
  if (error) throw new Error(`Reset failed: ${error.message}`);
  return data?.length ?? 0;
}
