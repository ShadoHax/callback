import { beforeEach, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), serverSupabase: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
import { POST } from "../src/app/api/messages/route";

const scanId = "885edbf2-d497-4f6f-a2cf-342711970001";
const noahAccount = "885edbf2-d497-4f6f-a2cf-342711970002";
const noahSource = { id: "885edbf2-d497-4f6f-a2cf-342711970003", speaker_id: "noah", thread_id: "noah", participant_ids: ["owner", "noah"], original_text: "Finally got Wingspan last month. Honestly love it.", source_at: null, is_synthetic: true };
const mayaSource = { id: "885edbf2-d497-4f6f-a2cf-342711970004", speaker_id: "maya", thread_id: "maya", participant_ids: ["owner", "maya"], original_text: "We should try Wingspan together sometime.", source_at: null, is_synthetic: true };
const sources = [noahSource, mayaSource];
const scan = { id: scanId, owner_id: "owner", image_path: "owner/p.jpg", corpus_revision: corpusRevision(sources), result: { status: "matched", person: "maya", recipientId: "maya-account", sourceIds: [mayaSource.id], advice: [{ personId: "noah", sourceIds: [noahSource.id] }] } };

function query(data: unknown) {
  return { select() { return this; }, eq() { return this; }, order() { return this; }, async maybeSingle() { return { data }; }, async limit() { return { data }; } };
}
function setup(contacts: Record<string, string | undefined>) {
  const insert = vi.fn().mockReturnValue({ select() { return { async single() { return { data: { id: "new-message" }, error: null }; } }; } });
  const contactFilter: string[] = [];
  mocks.serverSupabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "owner", email: "alex@example.com", user_metadata: {} } } }) },
    from: (table: string) => table === "contacts" ? { select() { return this; }, eq(column: string, value: string) { if (column === "person_id") contactFilter.push(value); return this; }, async maybeSingle() { const id = contacts[contactFilter.at(-1)!]; return { data: id ? { recipient_id: id } : null }; } } : query(table === "scans" ? scan : sources),
  });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(null), insert }) });
  return insert;
}
const ask = (body: object) => POST(new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify({ kind: "advice", scanId, body: "I saw this. How has yours held up?", clientRequestId: "885edbf2-d497-4f6f-a2cf-342711970010", ...body }) }));

beforeEach(() => { mocks.configured.mockReturnValue(true); process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; mocks.serverSupabase.mockReset(); mocks.adminSupabase.mockReset(); });

it("sends an advice request to the mapped account for an eligible advice person", async () => {
  const insert = setup({ noah: noahAccount });
  const response = await ask({ personId: "noah", quotedSourceId: noahSource.id });
  expect(response.status).toBe(201);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ recipient_id: noahAccount, purpose: "advice", about_person_id: "noah", scan_id: scanId, quoted_text: noahSource.original_text }));
});

it("ignores any client-supplied recipient and refuses people who aren't advice contacts for the scan", async () => {
  const insert = setup({ noah: noahAccount, maya: "maya-account", priya: "priya-account" });
  expect((await ask({ personId: "priya", recipientId: noahAccount })).status).toBe(403);
  expect((await ask({ personId: "maya" })).status).toBe(403);
  expect(insert).not.toHaveBeenCalled();
});

it("refuses an advice person with no linked account", async () => {
  const insert = setup({});
  expect((await ask({ personId: "noah" })).status).toBe(409);
  expect(insert).not.toHaveBeenCalled();
});

it("refuses a quote that isn't the advice person's own cited words", async () => {
  const insert = setup({ noah: noahAccount });
  expect((await ask({ personId: "noah", quotedSourceId: mayaSource.id })).status).toBe(403);
  expect(insert).not.toHaveBeenCalled();
});
