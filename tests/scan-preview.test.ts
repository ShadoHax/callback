import { afterEach, expect, it } from "vitest";
import { signPreview, verifyPreview } from "../src/lib/scan-preview";
const photo = () => new File(["original bytes"], "photo.jpg", { type: "image/jpeg" });
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.PREVIEW_SIGNING_SECRET; });
it("binds an unsaved preview to its owner, original image and expiration", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-signing-secret";
  const input = { ownerId: "alice", image: photo(), result: { status: "matched" as const, scanId: "scan", corpusRevision: "rev", captureSource: "phone_camera", persisted: false }, trace: [] };
  const token = await signPreview(input, 1000);
  expect((await verifyPreview(token, "alice", photo(), 2000)).result.persisted).toBe(false);
  await expect(verifyPreview(token, "bob", photo(), 2000)).rejects.toThrow();
  await expect(verifyPreview(token, "alice", new File(["other photo"], "photo.jpg"), 2000)).rejects.toThrow();
  await expect(verifyPreview(token, "alice", photo(), 601_000)).rejects.toThrow();
  const [body, signature] = token.split(".");
  const edited = JSON.parse(Buffer.from(body, "base64url").toString());
  edited.result.person = "forged";
  await expect(verifyPreview(`${Buffer.from(JSON.stringify(edited)).toString("base64url")}.${signature}`, "alice", photo(), 2000)).rejects.toThrow();
});

it("uses a dedicated signing secret when set, rejects short ones, and never accepts v1 tokens", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-signing-secret";
  const input = { ownerId: "alice", image: photo(), result: { status: "matched" as const, scanId: "scan", corpusRevision: "rev", captureSource: "phone_camera", persisted: false }, trace: [] };
  process.env.PREVIEW_SIGNING_SECRET = "a".repeat(32);
  const token = await signPreview(input, 1000);
  expect((await verifyPreview(token, "alice", photo(), 2000)).result.scanId).toBe("scan");
  process.env.PREVIEW_SIGNING_SECRET = "b".repeat(32);
  await expect(verifyPreview(token, "alice", photo(), 2000)).rejects.toThrow();
  process.env.PREVIEW_SIGNING_SECRET = "too-short";
  await expect(signPreview(input, 1000)).rejects.toThrow(/at least 32/);
  delete process.env.PREVIEW_SIGNING_SECRET;
  // A v1-style token (raw service key as the MAC key) must not verify under the derived v2 key.
  const { createHmac } = await import("node:crypto");
  const [body] = (await signPreview(input, 1000)).split(".");
  const v1 = createHmac("sha256", "test-only-signing-secret").update(`callback-preview-v1:${body}`).digest().toString("base64url");
  await expect(verifyPreview(`${body}.${v1}`, "alice", photo(), 2000)).rejects.toThrow();
});
