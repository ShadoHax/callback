import { adminSupabase } from "@/lib/admin-supabase";
import { authenticateDevice } from "@/lib/device-auth";
import { glassesMessagingEnabled } from "@/lib/glasses-messaging";

const headers = { "cache-control": "private, no-store" };

export async function GET(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return Response.json({ error: "Device service is unavailable." }, { status: 503, headers });
  const device = await authenticateDevice(request.headers.get("authorization"));
  if (!device) return Response.json({ error: "Invalid device token." }, { status: 401, headers });
  if (device.kind !== "pi" && device.kind !== "glasses") return Response.json({ error: "This device cannot receive events." }, { status: 403, headers });
  if (device.kind === "glasses" && !glassesMessagingEnabled()) return Response.json({ error: "Glasses messaging is not enabled." }, { status: 503, headers });
  const raw = new URL(request.url).searchParams.get("after") ?? "0";
  const after = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(after))
    return Response.json({ error: "Invalid event cursor." }, { status: 400, headers });
  let query = adminSupabase().from("device_events")
    .select("id,kind,payload,created_at")
    .eq("owner_id", device.ownerId).gt("id", after);
  if (device.kind === "glasses") query = query.eq("device_id", device.id);
  // Pi tokens are scoped to short celebration events, never private conversation text.
  if (device.kind === "pi") query = query.eq("kind", "connection");
  const { data, error } = await query.order("id", { ascending: true }).limit(20);
  if (error) return Response.json({ error: "Could not read events." }, { status: 500, headers });
  const events = data ?? [];
  return Response.json({ events, cursor: events.length ? events[events.length - 1].id : after }, { headers });
}
