import { configured, serverSupabase } from "@/lib/supabase";
import { corpusRevision } from "@/lib/corpus";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!configured()) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid scan ID." }, { status: 400 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to view this scan." }, { status: 401 });
  const { data, error } = await supabase.from("scans").select("id,result,trace,created_at,image_path,corpus_revision").eq("id", id).eq("owner_id", user.id).maybeSingle();
  if (error || !data) return Response.json({ error: "Scan not found." }, { status: 404 });
  const { data: sources, error: sourceError } = await supabase.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", user.id).limit(SOURCE_INDEX_LIMIT + 1);
  if (sourceError || (sources?.length ?? 0) > SOURCE_INDEX_LIMIT) return Response.json({ error: "Could not verify the current source context." }, { status: 503 });
  if (corpusRevision(sources ?? []) !== data.corpus_revision) return Response.json({ error: "Context changed since this scan. Scan again for a current result." }, { status: 409 });
  const { data: image } = await supabase.storage.from("scan-images").createSignedUrl(data.image_path, 300);
  return Response.json({ scan: { id: data.id, result: data.result, trace: data.trace, createdAt: data.created_at, imageUrl: image?.signedUrl ?? null } }, { headers: { "cache-control": "private, no-store" } });
}
