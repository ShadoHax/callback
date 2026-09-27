import { recognizeArObject } from "@/lib/ar-demo";
import { signArConnection } from "@/lib/ar-activity";
import { adminSupabase } from "@/lib/admin-supabase";
import { corpusRevision } from "@/lib/corpus";
import { decide, displayName, Source } from "@/lib/decision";
import { loadCurrentIndex, memoryTopics, presentationForConnection, relationsForPhoto } from "@/lib/knowledge-index";
import { validImage } from "@/lib/scan-stream";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { verifyDecision } from "@/lib/verify";
import { configured, serverSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 45;

const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function currentMemory() {
  // The demo also works anonymously. Private context is used only after cookie auth
  // and every service-role query is scoped to that authenticated owner.
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { status: "memory_unavailable" as const };
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "not_signed_in" as const };
  const admin = adminSupabase();
  const { data, error } = await admin.from("sources")
    .select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
    .eq("owner_id", user.id).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
  if (error || !data?.length || data.length > SOURCE_INDEX_LIMIT) return { status: "memory_unavailable" as const };
  const parsed = Source.array().safeParse(data);
  if (!parsed.success) return { status: "memory_unavailable" as const };
  const index = await loadCurrentIndex({ ownerId: user.id, sources: parsed.data, admin });
  return index ? { status: "ready" as const, ownerId: user.id, sources: parsed.data, index }
    : { status: "memory_unavailable" as const };
}

export async function POST(request: Request) {
  const started = Date.now();
  const form = await request.formData().catch(() => null);
  const image = form?.get("image") ?? null;
  if (!validImage(image)) return reply({ error: "Choose a JPG, PNG, or WebP image under 8 MB." }, 400);
  try {
    const memoryState = await currentMemory().catch(() => ({ status: "memory_unavailable" as const }));
    const context = memoryState.status === "ready" ? memoryState : null;
    const observed = await recognizeArObject(image, request.signal, context ? memoryTopics(context.index) : []);
    const timingMs = Date.now() - started;
    const { detected, identification } = observed;
    console.info("ar_demo.scan", JSON.stringify({ timingMs, visionMs: observed.visionMs, detected, visionModel: observed.visionModel, imageBytes: image.size }));
    const base = { detected, identification, timingMs, visionDiagnostics: observed.visionDiagnostics, verificationMs: null as number | null };
    if (!detected) return reply({ ...base, matched: false, memoryStatus: context ? "no_match" : memoryState.status });
    if (context) {
      const relations = relationsForPhoto(identification, context.index, { activityCues: true });
      let decision = decide({ identification, relations, sources: context.sources, ownerIds: [context.ownerId] });
      // Loose semantic associations need a positive check; a failed check never exposes the proposed friend.
      if (decision.connection && (decision.connection.evidenceLevel !== "exact_title" || identification.specificity !== "exact_title")) {
        const checked = await verifyDecision(decision, identification, context.sources, request.signal, observed.visionModel);
        base.verificationMs = checked.verification.ms ?? null;
        if (!checked.verification.checked || !checked.verification.sensible)
          return reply({ ...base, matched: false, memoryStatus: "no_match", timingMs: Date.now() - started });
        decision = checked.decision;
      }
      const match = decision.connection;
      if (match) {
        const citation = context.sources.find((source) => match.sourceIds.includes(source.id) && source.speaker_id === match.personId)
          ?? context.sources.find((source) => match.sourceIds.includes(source.id));
        if (citation) return reply({ ...base, matched: true, connectionToken: signArConnection({
          ownerId: context.ownerId, identification, sourceIds: match.sourceIds, personId: match.personId,
          corpusRevision: corpusRevision(context.sources),
        }), memory: {
          personName: displayName(match.personId), quote: citation.original_text, sourceAt: citation.source_at,
          synthetic: citation.is_synthetic, connection: match.reason, relation: match.relation, sourceIds: match.sourceIds,
          ...presentationForConnection(context.index, match),
        }, timingMs: Date.now() - started });
      }
    }
    return reply({ ...base, matched: false, memoryStatus: context ? "no_match" : memoryState.status, timingMs: Date.now() - started });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not scan this image.";
    console.error("ar_demo.scan_failed", JSON.stringify({ timingMs: Date.now() - started, message }));
    return reply({ error: message }, 503);
  }
}
