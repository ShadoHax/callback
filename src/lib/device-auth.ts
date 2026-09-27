import { createHash, randomBytes } from "node:crypto";
import { adminSupabase } from "./admin-supabase";

export type DeviceKind = "quest" | "glasses" | "pi";

export function newDeviceSecret() {
  return `cbdev_${randomBytes(32).toString("base64url")}`;
}

export function hashDeviceSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

export async function authenticateDevice(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const secret = authorization.slice(7);
  if (!/^cbdev_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const { data, error } = await adminSupabase().from("device_tokens")
    .select("id,owner_id,kind,expires_at,revoked_at")
    .eq("token_hash", hashDeviceSecret(secret)).maybeSingle();
  if (error || !data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) return null;
  if (data.kind !== "quest" && data.kind !== "glasses" && data.kind !== "pi") return null;
  return { id: data.id as string, ownerId: data.owner_id as string, kind: data.kind as DeviceKind };
}
