import { configured, serverSupabase } from "@/lib/supabase";
import { scanFailure, scanResponse, validImage } from "@/lib/scan-stream";
import { LocationProof } from "@/lib/location-proof";

export async function GET() {
  if (!configured()) return Response.json({ error: "Supabase is not configured." }, { status: 503 });
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to view scans." }, { status: 401 });
  const { data, error } = await supabase.from("scans").select("id,created_at,capture_source,result").eq("owner_id", user.id).order("created_at", { ascending: false }).limit(10);
  if (error) return Response.json({ error: "Could not load recent scans." }, { status: 500 });
  return Response.json({ scans: data }, { headers: { "cache-control": "private, no-store" } });
}

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!configured()) return scanFailure("Supabase is not configured. See .env.example.", 503);
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return scanFailure("Sign in before scanning.", 401);
  const form = await request.formData().catch(() => null);
  const image = form?.get("image") ?? null;
  if (!validImage(image)) return scanFailure("Choose a JPG, PNG, or WebP image under 8 MB.", 400);
  const captureSource = form?.get("captureSource") === "phone_camera" ? "phone_camera" : "phone_upload";
  const locationRaw = form?.get("location");
  let location: ReturnType<typeof LocationProof.safeParse> | null = null;
  if (typeof locationRaw === "string") {
    try { location = LocationProof.safeParse(JSON.parse(locationRaw)); }
    catch { return scanFailure("The location proof is invalid.", 400); }
  }
  if (location && !location.success) return scanFailure("The location proof is invalid.", 400);
  return scanResponse({ ownerId: user.id, image, captureSource, preview: form?.get("mode") === "hover", location: location?.data, signal: request.signal });
}
