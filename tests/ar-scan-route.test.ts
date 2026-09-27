import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recognize: vi.fn(),
  configured: vi.fn(), serverSupabase: vi.fn(), adminSupabase: vi.fn(),
  verifyDecision: vi.fn(), signArConnection: vi.fn(), loadCurrentIndex: vi.fn(), memoryTopics: vi.fn(), relationsForPhoto: vi.fn(), presentationForConnection: vi.fn(), decide: vi.fn(),
}));
vi.mock("@/lib/ar-demo", () => ({ recognizeArObject: mocks.recognize }));
vi.mock("@/lib/ar-activity", () => ({ signArConnection: mocks.signArConnection }));
vi.mock("@/lib/verify", () => ({ verifyDecision: mocks.verifyDecision }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
vi.mock("@/lib/knowledge-index", () => ({ loadCurrentIndex: mocks.loadCurrentIndex,
  memoryTopics: mocks.memoryTopics, relationsForPhoto: mocks.relationsForPhoto, presentationForConnection: mocks.presentationForConnection }));
vi.mock("@/lib/decision", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/decision")>()), decide: mocks.decide }));

import { POST } from "../src/app/api/demo/ar/scan/route";
import { corpusRevision } from "../src/lib/corpus";

const observed = (item: string, category = "soda") => ({
  detected: true, identification: { item, category, title: item, specificity: "exact_title",
    visibleText: [item], searchTerms: [], ambiguity: "", confidence: 0.96, boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, entityKind: "object", topicMatches: [] },
  visionMs: 100, visionModel: "test-model", visionDiagnostics: { model: "test-model" },
});
const source = { id: "885edbf2-d497-4f6f-a2cf-342711970001", speaker_id: "maya", thread_id: "demo",
  participant_ids: ["owner", "maya"], original_text: "I like Diet Coke", source_at: "2026-09-01T00:00:00Z", is_synthetic: false };
function request(withLegacyToken = false) {
  const form = new FormData();
  form.set("image", new File(["image"], "frame.jpg", { type: "image/jpeg" }));
  if (withLegacyToken) form.set("prepareToken", "legacy-demo-token");
  return new Request("http://localhost/api/demo/ar/scan", { method: "POST", body: form });
}

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.configured.mockReturnValue(false);
  mocks.memoryTopics.mockReturnValue([]);
  mocks.signArConnection.mockReturnValue("signed-owner-connection");
  mocks.presentationForConnection.mockReturnValue({ shortLabel: "Diet Coke", suggestedActions: [] });
});
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

it("recognizes different branded products without a demo token or fabricated story", async () => {
  for (const item of ["Coca-Cola Original Taste", "Diet Coke"]) {
    mocks.recognize.mockResolvedValueOnce(observed(item));
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ detected: true, matched: false, memoryStatus: "memory_unavailable",
      identification: { item, title: item, category: "soda" } });
    expect(body).not.toHaveProperty("scenario");
    expect(body).not.toHaveProperty("memory");
    expect(body).not.toHaveProperty("cart");
    expect(body).not.toHaveProperty("sessionId");
  }
});

it("never attaches a fixture story or checkout even when a legacy demo token is submitted", async () => {
  for (const item of ["banana", "coffee"]) {
    mocks.recognize.mockResolvedValueOnce(observed(item, item === "banana" ? "fruit" : "drink"));
    const body = await (await POST(request(true))).json();
    expect(body).toMatchObject({ detected: true, matched: false, identification: { item } });
    expect(body).not.toHaveProperty("scenario");
    expect(body).not.toHaveProperty("memory");
    expect(body).not.toHaveProperty("cart");
    expect(body).not.toHaveProperty("plan");
    expect(body).not.toHaveProperty("sessionId");
  }
});

it("uses only the signed-in owner's current index for a generic memory match", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.configured.mockReturnValue(true);
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner-id" } } }) } });
  const eq = vi.fn(() => ({ order: () => ({ limit: async () => ({ data: [source], error: null }) }) }));
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [] });
  mocks.recognize.mockResolvedValue(observed("Diet Coke"));
  mocks.relationsForPhoto.mockReturnValue([{ personId: "maya" }]);
  mocks.decide.mockReturnValue({ connection: { personId: "maya", relation: "prefers", evidenceLevel: "exact_title", reason: "Maya likes Diet Coke.", sourceIds: [source.id] } });
  const body = await (await POST(request())).json();
  expect(eq).toHaveBeenCalledWith("owner_id", "owner-id");
  expect(mocks.loadCurrentIndex).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner-id", sources: [source] }));
  expect(mocks.relationsForPhoto).toHaveBeenCalledWith(expect.objectContaining({ item: "Diet Coke" }), expect.any(Object), { activityCues: true });
  expect(body).toMatchObject({ detected: true, matched: true, connectionToken: "signed-owner-connection",
    memory: { personName: "Maya", quote: source.original_text, synthetic: false, sourceIds: [source.id],
      shortLabel: "Diet Coke", suggestedActions: [] } });
  expect(mocks.presentationForConnection).toHaveBeenCalledWith({ relations: [] }, expect.objectContaining({
    personId: "maya", sourceIds: [source.id], relation: "prefers",
  }));
  expect(mocks.signArConnection).toHaveBeenCalledWith(expect.objectContaining({
    ownerId: "owner-id", personId: "maya", sourceIds: [source.id],
    identification: expect.objectContaining({ item: "Diet Coke" }), corpusRevision: corpusRevision([source]),
  }));
  expect(body).not.toHaveProperty("cart");
  expect(body).not.toHaveProperty("sessionId");
});

it("does not read private sources for an unsigned user", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.configured.mockReturnValue(true);
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: null } }) } });
  mocks.recognize.mockResolvedValue(observed("Diet Coke"));
  const body = await (await POST(request())).json();
  expect(body).toMatchObject({ detected: true, matched: false, memoryStatus: "not_signed_in" });
  expect(body).not.toHaveProperty("connectionToken");
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
  expect(mocks.loadCurrentIndex).not.toHaveBeenCalled();
});

it("keeps an exact Diet Coke memory separate from regular Coca-Cola", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.configured.mockReturnValue(true);
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner-id" } } }) } });
  const eq = vi.fn(() => ({ order: () => ({ limit: async () => ({ data: [source], error: null }) }) }));
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq }) }) });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [{ personId: "maya", subject: "person", relation: "prefers",
    evidenceLevel: "exact_title", itemMention: "Diet Coke", itemCategory: "soda", sentiment: "positive",
    sourceIds: [source.id], aliases: [] }] });
  const realIndex = await vi.importActual<typeof import("../src/lib/knowledge-index")>("../src/lib/knowledge-index");
  const realDecision = await vi.importActual<typeof import("../src/lib/decision")>("../src/lib/decision");
  mocks.relationsForPhoto.mockImplementation(realIndex.relationsForPhoto);
  mocks.decide.mockImplementation(realDecision.decide);
  mocks.recognize.mockResolvedValueOnce(observed("Coca-Cola Original Taste"))
    .mockResolvedValueOnce(observed("Diet Coke"));
  const regular = await (await POST(request())).json();
  expect(regular).toMatchObject({ detected: true, matched: false, memoryStatus: "no_match" });
  expect(regular).not.toHaveProperty("memory");
  expect(regular).not.toHaveProperty("connectionToken");
  const diet = await (await POST(request())).json();
  expect(diet).toMatchObject({ detected: true, matched: true, memory: { personName: "Maya", quote: "I like Diet Coke" } });
});

it("withholds a loose connection when verification fails to run", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.configured.mockReturnValue(true);
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner-id" } } }) } });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [source], error: null }) }) }) }) }) });
  mocks.loadCurrentIndex.mockResolvedValue({relations: []}); mocks.relationsForPhoto.mockReturnValue([]);
  mocks.recognize.mockResolvedValue(observed("a soda can"));
  const decision = {connection: {personId: "maya", evidenceLevel: "category", sourceIds:[source.id]}};
  mocks.decide.mockReturnValue(decision);
  mocks.verifyDecision.mockResolvedValue({decision, verification:{checked:false,error:"timeout"}});
  const body = await (await POST(request())).json();
  expect(body).toMatchObject({detected:true,matched:false,memoryStatus:"no_match"});
  expect(body).not.toHaveProperty("memory");
  expect(mocks.signArConnection).not.toHaveBeenCalled();
});
