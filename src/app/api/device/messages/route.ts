import { z } from "zod";
import { adminSupabase } from "@/lib/admin-supabase";
import { authenticateDevice } from "@/lib/device-auth";
import { corpusRevision } from "@/lib/corpus";
import { glassesMessagingEnabled } from "@/lib/glasses-messaging";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";

const Input = z.object({ scanId: z.string().uuid(), recipientId: z.string().uuid(), body: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid() });
type SendInput = z.infer<typeof Input>;
type Stored = { id: string; scan_id: string | null; recipient_id: string; reply_to: string | null; body: string; quoted_source_id: string | null; purpose: string | null; about_person_id: string | null };
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function findByKey(admin: ReturnType<typeof adminSupabase>, senderId: string, key: string) {
  const { data, error } = await admin.from("messages").select("id,scan_id,recipient_id,reply_to,body,quoted_source_id,purpose,about_person_id").eq("sender_id", senderId).eq("client_request_id", key).maybeSingle();
  if (error) throw new Error("Could not verify the send confirmation.");
  return (data as Stored | null) ?? null;
}

function replay(stored: Stored, input: SendInput) {
  const same = stored.scan_id === input.scanId && stored.recipient_id === input.recipientId && stored.body === input.body &&
    stored.purpose === "connection" && stored.reply_to === null && stored.quoted_source_id === null && stored.about_person_id === null;
  if (!same) return reply({ error: "This confirmation ID was already used for a different message." }, 409);
  return reply({ id: stored.id, duplicate: true });
}

export async function POST(request: Request) {
  if (!glassesMessagingEnabled()) return reply({ error: "Glasses messaging is disabled." }, 503);
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return reply({ error: "Device messaging is unavailable." }, 503);
  const device = await authenticateDevice(request.headers.get("authorization"));
  if (!device) return reply({ error: "Invalid device token." }, 401);
  if (device.kind !== "glasses") return reply({ error: "This device cannot send reviewed messages." }, 403);
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Invalid reviewed message." }, 400);
  const input = parsed.data;
  const admin = adminSupabase();
  let prior: Stored | null;
  try { prior = await findByKey(admin, device.ownerId, input.clientRequestId); }
  catch { return reply({ error: "Could not verify the send confirmation." }, 503); }
  if (prior) return replay(prior, input);
  const { data: scan, error: scanError } = await admin.from("scans").select("id,result,device_id,corpus_revision").eq("id", input.scanId).eq("owner_id", device.ownerId).eq("device_id", device.id).maybeSingle();
  if (scanError) return reply({ error: "Could not verify this glasses scan." }, 503);
  if (!scan || scan.result?.status !== "matched") return reply({ error: "This glasses scan is unavailable or cannot be shared." }, 403);
  const people = [{ personId: scan.result.person, recipientId: scan.result.recipientId }, ...(scan.result.people ?? [])];
  const match = people.find((person: { personId?: string; recipientId?: string }) => person.recipientId === input.recipientId);
  if (!match?.personId) return reply({ error: "The selected recipient is not part of this callback." }, 403);
  const { data: contact } = await admin.from("contacts").select("recipient_id").eq("owner_id", device.ownerId).eq("person_id", match.personId).maybeSingle();
  if (!contact || contact.recipient_id !== input.recipientId || contact.recipient_id === device.ownerId) return reply({ error: "This recipient mapping changed. Scan again before sending." }, 409);
  const { data: sources, error: sourceError } = await admin.from("sources")
    .select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
    .eq("owner_id", device.ownerId).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
  if (sourceError || (sources?.length ?? 0) > SOURCE_INDEX_LIMIT) return reply({ error: "Could not verify the current source context." }, 503);
  if (corpusRevision(sources ?? []) !== scan.corpus_revision) return reply({ error: "Context changed since this scan. Scan again before sharing." }, 409);
  const { data: account } = await admin.auth.admin.getUserById(device.ownerId);
  const senderName = String(account.user?.user_metadata?.display_name || account.user?.email?.split("@")[0] || "Someone").slice(0, 80);
  const { data, error } = await admin.from("messages").insert({ sender_id: device.ownerId, sender_name: senderName, recipient_id: input.recipientId, scan_id: input.scanId, body: input.body, purpose: "connection", client_request_id: input.clientRequestId }).select("id").single();
  if (error?.code === "23505") {
    try {
      const winner = await findByKey(admin, device.ownerId, input.clientRequestId);
      if (winner) return replay(winner, input);
    } catch { /* The winning send could not be verified. */ }
  }
  if (error || !data) return reply({ error: "Could not send the reviewed message." }, 500);
  return reply({ id: data.id, duplicate: false }, 201);
}
