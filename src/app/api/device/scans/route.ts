import { authenticateDevice } from "@/lib/device-auth";
import { scanFailure, scanResponse, validImage } from "@/lib/scan-stream";
import { adminSupabase } from "@/lib/admin-supabase";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return scanFailure("Device scanning is not configured.", 503);
  const device = await authenticateDevice(request.headers.get("authorization"));
  if (!device) return scanFailure("Device token is invalid, expired, or revoked.", 401);
  if (device.kind === "pi") return scanFailure("This device can receive events but cannot scan.", 403);
  const form = await request.formData().catch(() => null);
  const image = form?.get("image") ?? null;
  if (!validImage(image)) return scanFailure("Choose a JPG, PNG, or WebP image under 8 MB.", 400);
  const { data: claimed, error } = await adminSupabase().rpc("claim_device_scan", { p_device_id: device.id });
  if (error) return scanFailure("Device scan limit is not configured.", 503);
  if (!claimed) return scanFailure("Wait 20 seconds between device scans.", 429);
  return scanResponse({ ownerId: device.ownerId, image, captureSource: device.kind, deviceId: device.id, signal: request.signal });
}
