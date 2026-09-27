import { serverSupabase, configured } from "@/lib/supabase";
import { adminSupabase } from "@/lib/admin-supabase";
import { z } from "zod";
import { corpusRevision } from "@/lib/corpus";
import { shareableQuote } from "@/lib/sharing";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { displayName } from "@/lib/decision";
import { glassesMessagingEnabled } from "@/lib/glasses-messaging";
import type { User } from "@supabase/supabase-js";

const senderName = (user: User) => String(user.user_metadata?.display_name || user.user_metadata?.name || displayName(user.email?.split("@")[0] ?? "Someone")).slice(0, 80);

const sendSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scan"), scanId: z.string().uuid(), recipientId: z.string().uuid(), body: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid(), quotedSourceId: z.string().uuid().optional() }),
  z.object({ kind: z.literal("reply"), replyTo: z.string().uuid(), body: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid() }),
  // Asking someone with experience. The recipient is never taken from the client: it is the current contact
  // mapping for an advice person stored with this scan, and quotes must come from that person's advice evidence.
  z.object({ kind: z.literal("advice"), scanId: z.string().uuid(), personId: z.string().min(1).max(100), body: z.string().trim().min(1).max(2000), clientRequestId: z.string().uuid(), quotedSourceId: z.string().uuid().optional() }),
]);

type SendInput = z.infer<typeof sendSchema>;
type Stored = { id: string; scan_id: string | null; recipient_id: string; reply_to: string | null; body: string; quoted_source_id: string | null; purpose: string | null; about_person_id: string | null };

// One client request ID names one immutable send. A replay of the same payload returns the original message;
// reusing the ID for different content is refused rather than silently acknowledged.
async function findByKey(admin: ReturnType<typeof adminSupabase>, senderId: string, key: string) {
  const { data } = await admin.from("messages").select("id,scan_id,recipient_id,reply_to,body,quoted_source_id,purpose,about_person_id").eq("sender_id", senderId).eq("client_request_id", key).maybeSingle();
  return (data as Stored | null) ?? null;
}

function samePayload(stored: Stored, input: SendInput) {
  if (stored.body !== input.body) return false;
  if (input.kind === "scan") return (stored.purpose ?? "connection") === "connection" && stored.reply_to === null && stored.scan_id === input.scanId && stored.recipient_id === input.recipientId && (stored.quoted_source_id ?? null) === (input.quotedSourceId ?? null);
  if (input.kind === "advice") return stored.purpose === "advice" && stored.scan_id === input.scanId && stored.about_person_id === input.personId && (stored.quoted_source_id ?? null) === (input.quotedSourceId ?? null);
  // Replies inherit the original scan for device routing; it is server-derived, not part of the retry payload.
  return stored.purpose === "reply" && stored.reply_to === input.replyTo && stored.quoted_source_id === null && stored.about_person_id === null;
}

function replay(stored: Stored, input: SendInput) {
  if (!samePayload(stored, input)) return Response.json({ error: "This send was already used for a different message. Start a new send." }, { status: 409 });
  return Response.json({ id: stored.id, duplicate: true });
}

export async function GET() {
  if (!configured()) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to view messages." }, { status: 401 });
  const { data, error } = await supabase.from("messages").select("id,sender_id,sender_name,recipient_id,body,created_at,scan_id,reply_to,image_path,quoted_text,quoted_at,purpose,about_person_id").or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`).order("created_at", { ascending: false }).limit(100);
  if (error) return Response.json({ error: "Could not load messages." }, { status: 500 });
  const withImages = await Promise.all((data ?? []).map(async (message) => {
    if (!message.image_path) return message;
    const { data: url } = await supabase.storage.from("scan-images").createSignedUrl(message.image_path, 300);
    return { ...message, imageUrl: url?.signedUrl ?? null };
  }));
  return Response.json({ messages: withImages, userId: user.id }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Messaging is not configured." }, { status: 503 });
  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message." }, { status: 400 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to send a message." }, { status: 401 });
  const admin = adminSupabase();
  const input = parsed.data;
  const existing = await findByKey(admin, user.id, input.clientRequestId);
  if (existing) return replay(existing, input);
  let recipientId: string;
  let scanId: string | null = null;
  let replyTo: string | null = null;
  let imagePath: string | null = null;
  let quote: { id: string; text: string; at: string | null } | null = null;
  let purpose = "connection";
  let aboutPersonId: string | null = null;
  if (input.kind === "scan" || input.kind === "advice") {
    const { data: scan } = await supabase.from("scans").select("id,owner_id,image_path,result,corpus_revision").eq("id", input.scanId).eq("owner_id", user.id).maybeSingle();
    if (!scan) return Response.json({ error: "This scan is unavailable or cannot be shared." }, { status: 403 });
    let personId: string, citedIds: string[];
    if (input.kind === "scan") {
      if (scan.result?.status !== "matched") return Response.json({ error: "This scan is unavailable or cannot be shared." }, { status: 403 });
      const groupEntry = (scan.result.people ?? []).find((item: { recipientId?: string }) => item.recipientId === input.recipientId);
      personId = groupEntry?.personId ?? scan.result.person; citedIds = groupEntry?.sourceIds ?? scan.result.sourceIds ?? [];
    } else {
      const entry = (scan.result?.advice ?? []).find((item: { personId: string }) => item.personId === input.personId);
      if (!entry) return Response.json({ error: "That person isn't an advice contact for this scan." }, { status: 403 });
      personId = entry.personId; citedIds = entry.sourceIds ?? []; purpose = "advice"; aboutPersonId = personId;
    }
    const { data: contact } = await supabase.from("contacts").select("recipient_id").eq("owner_id", user.id).eq("person_id", personId).maybeSingle();
    if (!contact || contact.recipient_id === user.id) return Response.json({ error: "This person isn't linked to an account you can message." }, { status: 409 });
    const allowedRecipients = new Set([scan.result.recipientId, ...(scan.result.people ?? []).map((item: { recipientId?: string }) => item.recipientId)].filter(Boolean));
    if (input.kind === "scan" && (contact.recipient_id !== input.recipientId || !allowedRecipients.has(input.recipientId))) return Response.json({ error: "The selected recipient is no longer available for this scan." }, { status: 409 });
    const { data: sources, error: sourceError } = await supabase.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", user.id).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
    if (sourceError || (sources?.length ?? 0) > SOURCE_INDEX_LIMIT) return Response.json({ error: "Could not verify the current source context." }, { status: 503 });
    if (corpusRevision(sources ?? []) !== scan.corpus_revision) return Response.json({ error: "Context changed since this scan. Scan again before sharing." }, { status: 409 });
    if (input.quotedSourceId) {
      quote = shareableQuote(input.quotedSourceId, personId, citedIds, sources ?? []);
      if (!quote) return Response.json({ error: "This excerpt cannot be shared with the selected recipient." }, { status: 403 });
    }
    recipientId = contact.recipient_id; scanId = scan.id; imagePath = scan.image_path;
  } else {
    const { data: original } = await supabase.from("messages").select("id,sender_id,recipient_id,scan_id").eq("id", input.replyTo).maybeSingle();
    if (!original || original.recipient_id !== user.id) return Response.json({ error: "You cannot reply to this message." }, { status: 403 });
    recipientId = original.sender_id; replyTo = original.id; scanId = original.scan_id; purpose = "reply";
  }
  const { data, error } = await admin.from("messages").insert({ sender_id: user.id, sender_name: senderName(user), recipient_id: recipientId, scan_id: scanId, reply_to: replyTo, image_path: imagePath, quoted_source_id: quote?.id ?? null, quoted_text: quote?.text ?? null, quoted_at: quote?.at ?? null, purpose, about_person_id: aboutPersonId, body: input.body, client_request_id: input.clientRequestId }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      // A concurrent retry with the same key won the insert; answer exactly as a replay would.
      const winner = await findByKey(admin, user.id, input.clientRequestId);
      if (winner) return replay(winner, input);
    }
    return Response.json({ error: "Could not send message." }, { status: 500 });
  }
  if (purpose === "reply" && scanId && glassesMessagingEnabled()) {
    // The message is already committed. An optional device notification must never turn it into a failed send.
    try {
      const { data: scan } = await admin.from("scans").select("device_id").eq("id", scanId).eq("owner_id", recipientId).maybeSingle();
      if (scan?.device_id) {
        const { data: device } = await admin.from("device_tokens").select("id,kind,expires_at,revoked_at")
          .eq("id", scan.device_id).eq("owner_id", recipientId).maybeSingle();
        if (device?.kind === "glasses" && !device.revoked_at && new Date(device.expires_at).getTime() > Date.now()) {
          const { error: eventError } = await admin.from("device_events").insert({ owner_id: recipientId, device_id: device.id, scan_id: scanId, kind: "reply", payload: { messageId: data.id, senderName: senderName(user), body: input.body } });
          if (eventError) console.warn("Optional glasses reply notification could not be stored.");
        }
      }
    } catch {
      console.warn("Optional glasses reply notification failed after the message was saved.");
    }
  }
  return Response.json({ id: data.id, duplicate: false }, { status: 201 });
}
