import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ serverSupabase: vi.fn(), adminSupabase: vi.fn(), modelConfig: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: () => true, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
vi.mock("@/lib/model", () => ({ modelConfig: mocks.modelConfig, ModelError: class ModelError extends Error {} }));
vi.mock("@/lib/knowledge-index", () => ({ prepareKnowledgeIndex: mocks.prepare }));

import { POST } from "../src/app/api/context/prepare/route";

const request = () => new Request("http://localhost/api/context/prepare", { method: "POST" });
const source = { id: "885edbf2-d497-4f6f-a2cf-342711970001", speaker_id: "maya", thread_id: "demo",
  participant_ids: ["owner", "maya"], original_text: "X100V", source_at: null, is_synthetic: true };

afterEach(() => {
  mocks.serverSupabase.mockReset(); mocks.adminSupabase.mockReset(); mocks.modelConfig.mockReset(); mocks.prepare.mockReset();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

it("requires a signed-in owner before loading sources or building", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
  const response = await POST(request());
  expect(response.status).toBe(401);
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("awaits preparation and returns only safe readiness metadata", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner-id" } } }) } });
  const limit = vi.fn(async () => ({ data: [source], error: null }));
  const eq = vi.fn(() => ({ order: () => ({ limit }) }));
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });
  mocks.prepare.mockResolvedValue({ index: { sourceCount: 1, relations: [{ itemMention: "X100V" }], revision: "revision" },
    reused: false, modelCalls: 2, droppedCount: 0, rejectedCount: 1, buildMs: 123,
    usage: [{ inputTokens: 10, outputTokens: 5 }, { inputTokens: 12, outputTokens: 6 }] });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(eq).toHaveBeenCalledWith("owner_id", "owner-id");
  expect(limit).toHaveBeenCalledWith(1001);
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner-id", sources: [source] }));
  expect(await response.json()).toEqual({ ready: true, sourceCount: 1, relationCount: 1, revision: "revision",
    reused: false, modelCalls: 2, inputTokens: 22, outputTokens: 11, droppedCount: 0, rejectedCount: 1, buildMs: 123 });
});

it("reports missing provider usage as unknown rather than zero", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner-id" } } }) } });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [source], error: null }) }) }) }) }) });
  mocks.prepare.mockResolvedValue({ index: { sourceCount: 1, relations: [], revision: "revision" },
    reused: false, modelCalls: 1, droppedCount: 0, buildMs: 123, usage: [] });
  const body = await (await POST(request())).json();
  expect(body).toMatchObject({ modelCalls: 1, inputTokens: null, outputTokens: null });
});
