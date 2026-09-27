import { z } from "zod";
import { configured, serverSupabase } from "@/lib/supabase";
import { adminSupabase } from "@/lib/admin-supabase";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Device management is not configured." }, { status: 503 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "Invalid device ID." }, { status: 400 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to revoke a device." }, { status: 401 });
  const { data, error } = await adminSupabase().from("device_tokens").update({ revoked_at: new Date().toISOString() })
    .eq("id", id).eq("owner_id", user.id).is("revoked_at", null).select("id").maybeSingle();
  if (error || !data) return Response.json({ error: "Device not found or already revoked." }, { status: 404 });
  return Response.json({ revoked: true }, { headers: { "cache-control": "private, no-store" } });
}
