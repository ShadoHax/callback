import { afterEach, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";
import { SOURCE_INDEX_LIMIT } from "../src/lib/source-selection";

const mocks = vi.hoisted(() => ({ authenticateDevice: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/device-auth", () => ({ authenticateDevice: mocks.authenticateDevice }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
import { POST } from "../src/app/api/device/messages/route";

const scanId = "885edbf2-d497-4f6f-a2cf-342711970001";
const recipientId = "885edbf2-d497-4f6f-a2cf-342711970002";
const clientRequestId = "885edbf2-d497-4f6f-a2cf-342711970003";
const payload = { scanId, recipientId, body: "Sunday?", clientRequestId };
const request = (body: object = payload) => new Request("http://localhost/api/device/messages", { method: "POST", headers: { authorization: "Bearer token" }, body: JSON.stringify(body) });
const source = { id: "885edbf2-d497-4f6f-a2cf-342711970004", speaker_id: "maya", thread_id: "chat", participant_ids: ["owner", "maya"], original_text: "Let's meet Sunday", source_at: "2026-09-26T00:00:00Z", is_synthetic: true };
const sources = [source];
const savedScan = { id: scanId, device_id: "glasses", corpus_revision: corpusRevision(sources), result: { status: "matched", person: "maya", recipientId, sourceIds: [source.id] } };
type Stored = { id: string; scan_id: string | null; recipient_id: string; body: string; purpose: string | null; reply_to: string | null; quoted_source_id: string | null; about_person_id: string | null };
const stored: Stored = { id: "message-1", scan_id: scanId, recipient_id: recipientId, body: "Sunday?", purpose: "connection", reply_to: null, quoted_source_id: null, about_person_id: null };

function setup(options: { scan?: typeof savedScan | null; sources?: typeof sources; contact?: { recipient_id: string } | null; reads?: (Stored | null)[]; insertError?: { code: string } | null } = {}) {
  process.env.GLASSES_MESSAGING_ENABLED = "true";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  mocks.authenticateDevice.mockResolvedValue({ id: "glasses", ownerId: "owner", kind: "glasses" });
  const reads = [...(options.reads ?? [null])];
  const insert = vi.fn(() => ({ select: () => ({ single: async () => options.insertError ? { data: null, error: options.insertError } : { data: { id: "message-1" }, error: null } }) }));
  const sourceLimit = vi.fn(async () => ({ data: options.sources ?? sources, error: null }));
  const query = (data: unknown) => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data, error: null }; } });
  const admin = {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "alex@example.com", user_metadata: { display_name: "Alex" } } } }) } },
    from: (table: string) => {
      if (table === "messages") return { ...query(null), maybeSingle: async () => ({ data: reads.shift() ?? null, error: null }), insert };
      if (table === "scans") return query(options.scan === undefined ? savedScan : options.scan);
      if (table === "contacts") return query(options.contact === undefined ? { recipient_id: recipientId } : options.contact);
      if (table === "sources") return { select() { return this; }, eq() { return this; }, order() { return this; }, limit: sourceLimit };
      throw new Error(`Unexpected table ${table}`);
    },
  };
  mocks.adminSupabase.mockReturnValue(admin);
  return { insert, sourceLimit };
}

afterEach(() => {
  mocks.authenticateDevice.mockReset(); mocks.adminSupabase.mockReset();
  delete process.env.GLASSES_MESSAGING_ENABLED;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
});

it("is disabled by default before device authentication", async () => {
  expect((await POST(request())).status).toBe(503);
  expect(mocks.authenticateDevice).not.toHaveBeenCalled();
});

it("allows only glasses tokens to send reviewed messages", async () => {
  setup(); mocks.authenticateDevice.mockResolvedValue({ id: "quest", ownerId: "owner", kind: "quest" });
  expect((await POST(request())).status).toBe(403);
});

it("sends to the saved contact on the exact glasses scan with current source context", async () => {
  const { insert, sourceLimit } = setup();
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(sourceLimit).toHaveBeenCalledWith(SOURCE_INDEX_LIMIT + 1);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sender_id: "owner", recipient_id: recipientId, scan_id: scanId, body: "Sunday?", purpose: "connection" }));
});

it("rejects an unavailable scan or a recipient outside its saved callback", async () => {
  setup({ scan: null });
  expect((await POST(request())).status).toBe(403);
  setup({ scan: { ...savedScan, result: { ...savedScan.result, recipientId: "other" } } });
  expect((await POST(request())).status).toBe(403);
});

it("rejects a changed contact mapping before sending", async () => {
  const { insert } = setup({ contact: { recipient_id: "other" } });
  expect((await POST(request())).status).toBe(409);
  expect(insert).not.toHaveBeenCalled();
});

it("rejects stale or oversized source context before sending", async () => {
  const changed = [{ ...source, original_text: "The plan was cancelled" }];
  const stale = setup({ sources: changed });
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/Context changed/);
  expect(stale.insert).not.toHaveBeenCalled();
  const oversized = setup({ sources: Array.from({ length: SOURCE_INDEX_LIMIT + 1 }, () => source) });
  expect((await POST(request())).status).toBe(503);
  expect(oversized.insert).not.toHaveBeenCalled();
});

it("replays only the same full connection payload", async () => {
  setup({ reads: [stored] });
  expect(await (await POST(request())).json()).toEqual({ id: "message-1", duplicate: true });
  for (const altered of [
    { ...stored, purpose: "advice" }, { ...stored, reply_to: "reply-id" },
    { ...stored, quoted_source_id: source.id }, { ...stored, about_person_id: "maya" },
    { ...stored, body: "Different" },
  ]) {
    const { insert } = setup({ reads: [altered] });
    expect((await POST(request())).status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  }
});

it("re-reads a 23505 winner and validates its full payload", async () => {
  setup({ reads: [null, stored], insertError: { code: "23505" } });
  expect(await (await POST(request())).json()).toEqual({ id: "message-1", duplicate: true });
  setup({ reads: [null, { ...stored, purpose: "reply" }], insertError: { code: "23505" } });
  expect((await POST(request())).status).toBe(409);
  setup({ reads: [null, null], insertError: { code: "23505" } });
  expect((await POST(request())).status).toBe(500);
});
