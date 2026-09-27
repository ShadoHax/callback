import { corpusRevision } from "@/lib/corpus";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { smsRecipient } from "@/lib/sms";
import type { serverSupabase } from "@/lib/supabase";

type Supabase = Awaited<ReturnType<typeof serverSupabase>>;
type Denied = { error: string; status: 403 | 409 | 503 };
type Authorized = { phone: string };

// A saved scan alone is not authority to reveal a phone number. The current
// contact mapping and source revision must still match the scan.
export async function authorizePersonalSms(
  supabase: Supabase,
  ownerId: string,
  scanId: string,
  recipientId: string,
): Promise<Denied | Authorized> {
  const { data: scan, error: scanError } = await supabase.from("scans")
    .select("id,result,corpus_revision").eq("id", scanId).eq("owner_id", ownerId).maybeSingle();
  if (scanError) return { error: "Could not verify this scan.", status: 503 };
  if (!scan || scan.result?.status !== "matched") return { error: "This scan is unavailable or cannot be shared.", status: 403 };

  const group = Array.isArray(scan.result.people) ? scan.result.people : [];
  const people = [{ personId: scan.result.person, recipientId: scan.result.recipientId }, ...group];
  const match = people.find((person: { personId?: unknown; recipientId?: unknown }) =>
    person?.recipientId === recipientId && typeof person.personId === "string");
  if (!match) return { error: "The selected recipient is not part of this callback.", status: 403 };

  const { data: contact, error: contactError } = await supabase.from("contacts")
    .select("recipient_id").eq("owner_id", ownerId).eq("person_id", match.personId).maybeSingle();
  if (contactError) return { error: "Could not verify this recipient.", status: 503 };
  if (!contact || contact.recipient_id !== recipientId) return { error: "This recipient mapping changed. Scan again before texting.", status: 409 };

  const { data: sources, error: sourceError } = await supabase.from("sources")
    .select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
    .eq("owner_id", ownerId).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
  if (sourceError || (sources?.length ?? 0) > SOURCE_INDEX_LIMIT) return { error: "Could not verify the current source context.", status: 503 };
  if (corpusRevision(sources ?? []) !== scan.corpus_revision) return { error: "Context changed since this scan. Scan again before texting.", status: 409 };

  let phone: string | null;
  try { phone = smsRecipient(ownerId, match.personId as string); }
  catch { return { error: "Personal texting is not configured correctly. Use the personal-app chooser.", status: 503 }; }
  if (!phone) return { error: "This person's mobile number isn't configured for native texting.", status: 409 };
  return { phone };
}
