import { z } from "zod";
import { configured, serverSupabase } from "@/lib/supabase";
import { adminSupabase } from "@/lib/admin-supabase";
import { hashDeviceSecret, newDeviceSecret } from "@/lib/device-auth";

const input = z.object({ kind: z.enum(["quest", "glasses", "pi"]), name: z.string().trim().min(1).max(80) });
const privateHeaders = { "cache-control": "private, no-store" };

async function owner() {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const ownerId = await owner();
  if (!ownerId) return Response.json({ error: "Sign in to manage devices." }, { status: 401, headers: privateHeaders });
  const { data, error } = await adminSupabase().from("device_tokens")
    .select("id,kind,name,expires_at,revoked_at,created_at")
    .eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(20);
  if (error) return Response.json({ error: "Could not list devices." }, { status: 500, headers: privateHeaders });
  return Response.json({ devices: data }, { headers: privateHeaders });
}

export async function POST(request: Request) {
  const ownerId = await owner();
  if (!ownerId) return Response.json({ error: "Sign in to pair a device." }, { status: 401, headers: privateHeaders });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a device type and a short name." }, { status: 400, headers: privateHeaders });
  const admin = adminSupabase();
  const { count, error: countError } = await admin.from("device_tokens").select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId).is("revoked_at", null).gt("expires_at", new Date().toISOString());
  if (countError) return Response.json({ error: "Could not check active devices." }, { status: 500, headers: privateHeaders });
  if ((count ?? 0) >= 3) return Response.json({ error: "Revoke an active device before pairing another." }, { status: 409, headers: privateHeaders });
  const secret = newDeviceSecret();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from("device_tokens").insert({ owner_id: ownerId, kind: parsed.data.kind, name: parsed.data.name, token_hash: hashDeviceSecret(secret), expires_at: expiresAt }).select("id,kind,name,expires_at").single();
  if (error) return Response.json({ error: "Could not pair the device." }, { status: 500, headers: privateHeaders });
  return Response.json({ device: data, token: secret, notice: parsed.data.kind === "pi" ? "Copy this receive-only Pi token now. It is shown once and expires in 24 hours." : "Copy this scan-only token now. It is shown once and expires in 24 hours." }, { status: 201, headers: privateHeaders });
}
