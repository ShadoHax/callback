import { z } from "zod";
import { configured, serverSupabase } from "@/lib/supabase";
import { adminSupabase } from "@/lib/admin-supabase";
import { SOURCE_LIMIT, resetDemoUpdates } from "@/lib/demo-data";

const inputSchema = z.object({ speakerId: z.string().min(1).max(100), text: z.string().trim().min(1).max(3000) });

async function authorize() {
  if (!configured() || process.env.DEMO_MODE !== "true" || !process.env.DEMO_OWNER_ID) return null;
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id === process.env.DEMO_OWNER_ID ? { supabase, user } : null;
}

export async function GET() {
  const auth = await authorize();
  return Response.json({ enabled: Boolean(auth) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth) return Response.json({ error: "Demo context editing is unavailable." }, { status: 403 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a speaker and a short update." }, { status: 400 });
  const { count, error: countError } = await auth.supabase.from("sources").select("id", { count: "exact", head: true }).eq("owner_id", auth.user.id);
  if (countError) return Response.json({ error: "Could not check source limit." }, { status: 500 });
  if ((count ?? 0) >= SOURCE_LIMIT) return Response.json({ error: `The ${SOURCE_LIMIT}-source limit has been reached. Reset demo updates first.` }, { status: 409 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Demo editor is not configured." }, { status: 503 });
  const { data, error } = await adminSupabase().from("sources").insert({ owner_id: auth.user.id, speaker_id: parsed.data.speakerId, thread_id: `demo-update-${crypto.randomUUID()}`, participant_ids: ["owner", parsed.data.speakerId], original_text: parsed.data.text, source_at: new Date().toISOString(), is_synthetic: true, origin: "demo_update" }).select("id,source_at").single();
  if (error) return Response.json({ error: "Could not add demo context." }, { status: 500 });
  return Response.json({ id: data.id, at: data.source_at, label: "Synthetic demo context added during this session" }, { status: 201 });
}

// Removes only this demo owner's synthetic session updates, so repeated judging starts from the imported context.
export async function DELETE() {
  const auth = await authorize();
  if (!auth) return Response.json({ error: "Demo context editing is unavailable." }, { status: 403 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Demo editor is not configured." }, { status: 503 });
  try {
    const removed = await resetDemoUpdates(adminSupabase(), auth.user.id);
    return Response.json({ removed });
  } catch { return Response.json({ error: "Could not reset demo updates." }, { status: 500 }); }
}
