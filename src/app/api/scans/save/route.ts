import { adminSupabase } from "@/lib/admin-supabase";
import { corpusRevision } from "@/lib/corpus";
import { Source } from "@/lib/decision";
import { verifyPreview } from "@/lib/scan-preview";
import { validImage } from "@/lib/scan-stream";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { configured, serverSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!configured()) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before saving." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const image = form?.get("image") ?? null, token = form?.get("previewToken");
  if (!validImage(image) || typeof token !== "string") return Response.json({ error: "Choose a valid photo and preview." }, { status: 400 });
  let preview;
  try { preview = await verifyPreview(token, user.id, image); }
  catch { return Response.json({ error: "This preview expired or changed. Point at the item again." }, { status: 409 }); }
  const admin = adminSupabase();
  const { data: sources, error: sourceError } = await admin.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", user.id).limit(SOURCE_INDEX_LIMIT + 1);
  if (sourceError) return Response.json({ error: "Could not verify current context." }, { status: 503 });
  if ((sources?.length ?? 0) > SOURCE_INDEX_LIMIT || corpusRevision(Source.array().parse(sources ?? [])) !== preview.result.corpusRevision) return Response.json({ error: "Your context changed. Prepare memory and point at the item again." }, { status: 409 });
  const existing = await admin.from("scans").select("result").eq("owner_id", user.id).eq("id", preview.result.scanId).maybeSingle();
  if (existing.error) return Response.json({ error: "Could not verify saved scan." }, { status: 503 });
  if (existing.data) return Response.json({ result: existing.data.result });
  // Concurrent opens can race after the first lookup. Give each attempt its own object so a losing
  // insert can only clean up its own upload, never the winner's photo.
  const path = `${user.id}/${preview.result.scanId}-${crypto.randomUUID()}.${image.type.split("/")[1]}`;
  const { error: uploadError } = await admin.storage.from("scan-images").upload(path, image, { contentType: image.type, upsert: false });
  if (uploadError) return Response.json({ error: "Could not save photo. Try opening this preview again." }, { status: 503 });
  const result = { ...preview.result, persisted: true };
  const { error } = await admin.from("scans").insert({ id: result.scanId, owner_id: user.id, image_path: path, result, trace: preview.trace, corpus_revision: result.corpusRevision, capture_source: result.captureSource });
  if (error) {
    await admin.storage.from("scan-images").remove([path]);
    if (error.code === "23505") {
      const saved = await admin.from("scans").select("result").eq("owner_id", user.id).eq("id", preview.result.scanId).maybeSingle();
      if (!saved.error && saved.data) return Response.json({ result: saved.data.result });
    }
    return Response.json({ error: "Could not save this preview. Please retry." }, { status: 503 });
  }
  return Response.json({ result }, { status: 201 });
}
