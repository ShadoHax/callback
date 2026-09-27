import { beforeEach, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), serverSupabase: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
import { POST } from "../src/app/api/messages/route";

const scanId = "885edbf2-d497-4f6f-a2cf-342711970001";
const recipientId = "885edbf2-d497-4f6f-a2cf-342711970002";
const sourceId = "885edbf2-d497-4f6f-a2cf-342711970003";
const source = { id: sourceId, speaker_id: "maya", thread_id: "demo", participant_ids: ["owner", "maya"], original_text: "Send me a photo.", source_at: null, is_synthetic: true };

function query(data: unknown) {
  return { select() { return this; }, eq() { return this; }, order() { return this; }, async maybeSingle() { return { data }; }, async limit() { return { data }; } };
}

beforeEach(() => {
  mocks.configured.mockReturnValue(true);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.serverSupabase.mockReset(); mocks.adminSupabase.mockReset();
});

function setup(cited: string[]) {
  const insert = vi.fn().mockReturnValue({ select() { return { async single() { return { data: { id: "new-message" }, error: null }; } }; } });
  const scan = { id: scanId, owner_id: "owner", image_path: "owner/photo.jpg", corpus_revision: corpusRevision([source]), result: { status: "matched", person: "maya", recipientId, sourceIds: cited } };
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from: (table: string) => query(table === "scans" ? scan : table === "contacts" ? { recipient_id: recipientId } : [source]) });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(null), insert }) });
  return insert;
}

function request() {
  return new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify({ kind: "scan", scanId, recipientId, body: "I saw this.", clientRequestId: "885edbf2-d497-4f6f-a2cf-342711970004", quotedSourceId: sourceId }) });
}

it("rejects an excerpt absent from the scan evidence", async () => {
  const insert = setup([]);
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(insert).not.toHaveBeenCalled();
});

it("sends the exact stored recipient-authored excerpt when explicitly selected", async () => {
  const insert = setup([sourceId]);
  const response = await POST(request());
  expect(response.status).toBe(201);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ quoted_source_id: sourceId, quoted_text: source.original_text }));
});
