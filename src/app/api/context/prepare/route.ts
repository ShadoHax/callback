import { adminSupabase } from "@/lib/admin-supabase";
import { Source } from "@/lib/decision";
import { prepareKnowledgeIndex } from "@/lib/knowledge-index";
import { ModelError, modelConfig } from "@/lib/model";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { configured, serverSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return reply({ error: "Context preparation is not configured." }, 503);
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in to prepare context." }, 401);
  try { modelConfig(); }
  catch (error) { return reply({ error: error instanceof ModelError ? error.message : "Model settings are invalid." }, 503); }
  const admin = adminSupabase();
  const { data, error } = await admin.from("sources")
    .select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
    .eq("owner_id", user.id).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
  if (error) return reply({ error: "Could not load private sources." }, 503);
  if ((data?.length ?? 0) > SOURCE_INDEX_LIMIT)
    return reply({ error: `Source corpus exceeds the current ${SOURCE_INDEX_LIMIT}-record index limit.` }, 413);
  const parsed = Source.array().safeParse(data ?? []);
  if (!parsed.success) return reply({ error: "Private sources could not be verified." }, 503);
  try {
    const prepared = await prepareKnowledgeIndex({ ownerId: user.id, sources: parsed.data, admin, signal: request.signal });
    const completeUsage = prepared.usage.length === prepared.modelCalls;
    const inputTokens = completeUsage ? prepared.usage.reduce((sum, call) => sum + call.inputTokens, 0) : null;
    const outputTokens = completeUsage ? prepared.usage.reduce((sum, call) => sum + call.outputTokens, 0) : null;
    return reply({ ready: prepared.index.sourceCount > 0, sourceCount: prepared.index.sourceCount,
      relationCount: prepared.index.relations.length, revision: prepared.index.revision, reused: prepared.reused,
      modelCalls: prepared.modelCalls, inputTokens, outputTokens,
      droppedCount: prepared.droppedCount, rejectedCount: prepared.rejectedCount, reusedThreads: prepared.reusedThreads, extractedThreads: prepared.extractedThreads, buildMs: prepared.buildMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("Context changed while")) return reply({ error: message }, 409);
    if (message.startsWith("Context needs ") || message === "A context message is too long to prepare safely.")
      return reply({ error: message }, 413);
    if (message.startsWith("Context preparation exceeded")) return reply({ error: message }, 503);
    if (message.startsWith("Context preparation reached") || message.startsWith("Model returned unverifiable context evidence after retries."))
      return reply({ error: message }, 503);
    if (message === "Context preparation was cancelled.") return reply({ error: message }, 499);
    if (error instanceof ModelError) return reply({ error: error.message }, 503);
    if (message === "Could not load the prepared context index.")
      return reply({ error: "Could not load the prepared context index.", code: "index_read" }, 503);
    if (message === "Could not save the prepared context index.")
      return reply({ error: "Could not save the prepared context index.", code: "index_write" }, 503);
    return reply({ error: "Could not prepare private context. Please retry." }, 503);
  }
}
