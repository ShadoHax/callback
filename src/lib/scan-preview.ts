import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { ScanResult } from "./scan-types";

type Preview = { ownerId: string; imageHash: string; expiresAt: number; result: ScanResult & { corpusRevision: string; captureSource: string }; trace: object[] };
// Prefer a dedicated PREVIEW_SIGNING_SECRET. Without one, derive a separate key from the service credential so the
// credential itself is never used directly as a MAC key. Rotating either invalidates outstanding (10-minute) previews.
function signingKey() {
  const dedicated = process.env.PREVIEW_SIGNING_SECRET;
  if (dedicated !== undefined && dedicated !== "") {
    if (dedicated.length < 32) throw new Error("PREVIEW_SIGNING_SECRET must be at least 32 characters.");
    return Buffer.from(dedicated);
  }
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) throw new Error("Preview signing is not configured.");
  return Buffer.from(hkdfSync("sha256", service, "callback-preview", "preview-signing-v2", 32));
}
const signature = (body: string) => createHmac("sha256", signingKey()).update(`callback-preview-v2:${body}`).digest();
export const imageHash = async (file: File) => createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");

// A short-lived, owner-bound signed receipt lets the phone hold an unsaved result.
// Never trust a client-submitted result or upload a hover photo before selection.
export async function signPreview(input: Omit<Preview, "imageHash" | "expiresAt"> & { image: File }, now = Date.now()) {
  const { image, ...rest } = input;
  const payload: Preview = { ...rest, imageHash: await imageHash(image), expiresAt: now + 10 * 60_000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}

export async function verifyPreview(token: string, ownerId: string, image: File, now = Date.now()): Promise<Preview> {
  if (token.length > 200_000) throw new Error("Invalid preview. Point at the item again.");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid preview. Point at the item again.");
  const expected = signature(parts[0]), actual = Buffer.from(parts[1], "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid preview. Point at the item again.");
  const payload: Preview = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  if (payload.ownerId !== ownerId || payload.expiresAt <= now || payload.imageHash !== await imageHash(image)) throw new Error("This preview expired or changed. Point at the item again.");
  return payload;
}
