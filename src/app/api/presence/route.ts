import { configured, serverSupabase } from "@/lib/supabase";
import { adminSupabase } from "@/lib/admin-supabase";
import { LocationProof, verifyLocation } from "@/lib/location-proof";

const noStore = { "cache-control": "private, no-store" };

export async function GET() {
  if (process.env.NEXT_PUBLIC_ENABLE_PROXIMITY !== "true") return Response.json({ active: false, enabled: false }, { headers: noStore });
  if (!configured()) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to manage presence." }, { status: 401 });
  const { data, error } = await supabase.from("location_presence").select("expires_at").eq("user_id", user.id).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) return Response.json({ error: "Could not check presence." }, { status: 500 });
  return Response.json({ active: Boolean(data), expiresAt: data?.expires_at ?? null }, { headers: noStore });
}

export async function PUT(request: Request) {
  if (process.env.NEXT_PUBLIC_ENABLE_PROXIMITY !== "true") return Response.json({ error: "Nearby sharing is disabled." }, { status: 503, headers: noStore });
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Presence is not configured." }, { status: 503 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to share presence." }, { status: 401 });
  const parsed = LocationProof.safeParse(await request.json().catch(() => null));
  const verified = parsed.success ? verifyLocation(parsed.data) : undefined;
  if (!verified?.verified) return Response.json({ error: "A fresh, accurate location is required." }, { status: 400 });
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  const { error } = await adminSupabase().from("location_presence").upsert({ user_id: user.id, latitude: verified.latitude, longitude: verified.longitude, accuracy: verified.accuracy, captured_at: verified.capturedAt, expires_at: expiresAt }, { onConflict: "user_id" });
  if (error) return Response.json({ error: "Could not share presence." }, { status: 500 });
  return Response.json({ active: true, expiresAt }, { headers: noStore });
}

export async function DELETE() {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ error: "Presence is not configured." }, { status: 503 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to stop sharing presence." }, { status: 401 });
  const { error } = await adminSupabase().from("location_presence").delete().eq("user_id", user.id);
  if (error) return Response.json({ error: "Could not stop sharing presence." }, { status: 500 });
  return Response.json({ active: false }, { headers: noStore });
}
