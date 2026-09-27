import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";
import { signPreview } from "../src/lib/scan-preview";

const mocks = vi.hoisted(() => ({
  user: { id: "alice" } as { id: string } | null,
  sources: [] as object[],
  saved: null as { result: object } | null,
  sourceError: null as object | null,
  upload: vi.fn(), remove: vi.fn(), insert: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({ configured: () => true, serverSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: () => ({
  from: (table: string) => table === "sources"
    ? { select: () => ({ eq: () => ({ limit: async () => ({ data: mocks.sources, error: mocks.sourceError }) }) }) }
    : { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mocks.saved, error: null }) }) }) }), insert: mocks.insert },
  storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
}) }));
vi.mock("@/lib/scan-stream", () => ({ validImage: (image: unknown) => image instanceof File && image.type === "image/jpeg" && image.size > 0 }));

import { POST } from "../src/app/api/scans/save/route";

const photo = (bytes = "original bytes") => new File([bytes], "photo.jpg", { type: "image/jpeg" });
const result = () => ({ status: "matched" as const, scanId: crypto.randomUUID(), corpusRevision: corpusRevision([]), captureSource: "phone_camera", persisted: false });
async function request(image: File, token: string) {
  const body = new FormData(); body.set("image", image); body.set("previewToken", token);
  return POST(new Request("https://app.test/api/scans/save", { method: "POST", body }));
}
async function tokenFor(image: File, ownerId = "alice", value = result()) {
  return { value, token: await signPreview({ ownerId, image, result: value, trace: [] }) };
}
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-signing-secret";
  mocks.user = { id: "alice" }; mocks.sources = []; mocks.saved = null; mocks.sourceError = null;
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.remove.mockReset().mockResolvedValue({ error: null });
  mocks.insert.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

it("requires a signed-in owner before reading the preview", async () => {
  mocks.user = null;
  const image = photo(); const { token } = await tokenFor(image);
  expect((await request(image, token)).status).toBe(401);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("rejects another owner or a changed image before storage access", async () => {
  const image = photo(); const { token } = await tokenFor(image, "bob");
  expect((await request(image, token)).status).toBe(409);
  const own = await tokenFor(image);
  expect((await request(photo("changed bytes"), own.token)).status).toBe(409);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("rejects a preview after the approved message corpus changes", async () => {
  const image = photo(); const { token } = await tokenFor(image);
  mocks.sources = [{ id: crypto.randomUUID(), speaker_id: "bob", thread_id: "thread", participant_ids: ["bob"], original_text: "changed", source_at: null, is_synthetic: false }];
  expect((await request(image, token)).status).toBe(409);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("persists the signed result and returns an existing owner-owned save on replay", async () => {
  const image = photo(); const { token, value } = await tokenFor(image);
  const first = await request(image, token);
  expect(first.status).toBe(201);
  expect((await first.json()).result).toMatchObject({ scanId: value.scanId, persisted: true });
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ id: value.scanId, owner_id: "alice", result: expect.objectContaining({ persisted: true }) }));
  mocks.saved = { result: { ...value, persisted: true } };
  const second = await request(image, token);
  expect(second.status).toBe(200);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.insert).toHaveBeenCalledTimes(1);
});

it("handles two simultaneous opens without deleting the winning photo", async () => {
  const image = photo(); const { token, value } = await tokenFor(image);
  const insertions: { row: { result: object }; resolve: (outcome: { error: object | null }) => void }[] = [];
  mocks.insert.mockImplementation((row: { result: object }) => new Promise((resolve) => {
    insertions.push({ row, resolve });
    if (insertions.length === 2) {
      mocks.saved = { result: insertions[0].row.result };
      insertions[0].resolve({ error: null });
      insertions[1].resolve({ error: { code: "23505" } });
    }
  }));
  const [first, second] = await Promise.all([request(image, token), request(image, token)]);
  expect([first.status, second.status]).toEqual([201, 200]);
  expect((await second.json()).result).toMatchObject({ scanId: value.scanId, persisted: true });
  const winningPath = mocks.upload.mock.calls[0][0];
  const losingPath = mocks.upload.mock.calls[1][0];
  expect(losingPath).not.toBe(winningPath);
  expect(mocks.remove).toHaveBeenCalledExactlyOnceWith([losingPath]);
  expect(mocks.remove).not.toHaveBeenCalledWith([winningPath]);
});
