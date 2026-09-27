import { readFileSync } from "node:fs";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminSupabase: vi.fn(), identifyItem: vi.fn(), extractRelations: vi.fn(), loadCurrentIndex: vi.fn() }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
vi.mock("@/lib/meta", () => ({ identifyItem: mocks.identifyItem, extractRelations: mocks.extractRelations }));

vi.mock("@/lib/knowledge-index", () => ({ loadCurrentIndex: mocks.loadCurrentIndex, relationsForPhoto: (_item: unknown, index: { relations: unknown[] }) => index.relations, memoryTopics: () => [] }));

import { scanResponse } from "../src/lib/scan-stream";
import { ModelError } from "../src/lib/model";
import { Bundle, stableSourceId } from "../src/lib/demo-data";
import type { Source } from "../src/lib/decision";

const sources = [
  { id: "885edbf2-d497-4f6f-a2cf-342711970001", speaker_id: "maya", thread_id: "demo", participant_ids: ["owner", "maya"], original_text: "If you spot an X100V, send me a picture.", source_at: "2026-09-20T15:00:00.000Z", is_synthetic: true },
  { id: "885edbf2-d497-4f6f-a2cf-342711970002", speaker_id: "priya", thread_id: "demo-2", participant_ids: ["owner", "priya"], original_text: "I hated the X100V; I returned mine.", source_at: "2026-09-21T15:00:00.000Z", is_synthetic: true },
  { id: "885edbf2-d497-4f6f-a2cf-342711970003", speaker_id: "sam", thread_id: "demo-3", participant_ids: ["owner", "sam"], original_text: "want an X100V", source_at: "2026-09-01T15:00:00.000Z", is_synthetic: true },
  { id: "885edbf2-d497-4f6f-a2cf-342711970004", speaker_id: "sam", thread_id: "demo-3", participant_ids: ["owner", "sam"], original_text: "update: bought the X100V", source_at: "2026-09-25T15:00:00.000Z", is_synthetic: true },
];
const webcamBundle = Bundle.parse(JSON.parse(readFileSync("fixtures/imaging-edge-webcam-local.json", "utf8")));
const webcamSources: Source[] = webcamBundle.sources.map((source) => ({ ...source, id: stableSourceId("owner", source) }));
const identification = { item: "Fujifilm X100V", category: "camera", specificity: "exact_title", visibleText: [], searchTerms: ["X100V"], ambiguity: "" };
const relation = (personId: string, kind: string, source: number) => ({ personId, subject: "person", relation: kind, evidenceLevel: "exact_title", itemMention: "X100V", sentiment: "none", sourceIds: [sources[source].id], reason: `${personId} ${kind}` });

function fakeAdmin(presence: object[] = [], presenceError: object | null = null,
  contactError: object | null = null, sourceRows: Source[] = sources) {
  const insert = vi.fn<(row: { trace: { type: string }[] }) => Promise<{ error: null }>>(async () => ({ error: null }));
  const remove = vi.fn(async () => ({ error: null }));
  const upload = vi.fn(async () => ({ error: null }));
  const sourceQuery = { select() { return this; }, eq() { return this; }, order() { return this; }, async limit() { return { data: sourceRows, error: null }; } };
  const contactLookup = vi.fn(async (field: string, ids: string[]) => ({
    data: ids.map((person_id) => ({ person_id, recipient_id: person_id === "maya" ? "recipient" : `${person_id}-recipient` })),
    error: contactError,
  }));
  const contactQuery = { select() { return this; }, eq(field: string, value: string) { expect([field, value]).toEqual(["owner_id", "owner"]); return this; },
    in(field: string, ids: string[]) { return contactLookup(field, ids); } };
  const presenceQuery = { select() { return this; }, in() { return this; }, async gt() { return { data: presence, error: presenceError }; } };
  mocks.adminSupabase.mockReturnValue({ from: (table: string) => table === "sources" ? sourceQuery : table === "contacts" ? contactQuery : table === "location_presence" ? presenceQuery : { insert }, storage: { from: () => ({ upload, remove }) } });
  return { insert, remove, upload, contactLookup };
}
const photo = () => new File(["jpg"], "camera.jpg", { type: "image/jpeg" });
const lines = (text: string) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

beforeEach(() => { mocks.loadCurrentIndex.mockResolvedValue({ relations: [] }); });

afterEach(() => {
  vi.clearAllMocks();
  mocks.loadCurrentIndex.mockReset();
  for (const name of ["MODEL_PROVIDER", "MODEL_API_KEY", "OPENAI_API_KEY", "OPENAI_MODEL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_ENABLE_PROXIMITY"]) delete process.env[name];
});

it("streams real pipeline stages, shows the newer message behind an update, and persists provenance", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert, contactLookup } = fakeAdmin();
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 900, attempts: 1 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0), relation("priya", "dislikes", 1), relation("sam", "wanted", 2), relation("sam", "owns", 3)] });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "quest", deviceId: "device" }).text());
  expect(events.map((event) => event.type)).toEqual(["frame_received", "memory_checked", "entity_identified", "context_loaded", "searching", "mentions_found", "ruled_out", "ruled_out", "matched", "result"]);
  expect(events[1]).toMatchObject({ readiness: "ready", sourceCount: 4, corpusRevision: expect.any(String), memoryMs: expect.any(Number) });
  expect(events[3].message).toBe("Prepared memory covers 4 approved messages from 3 people.");
  expect(events.find((event) => event.type === "matched").message).toBe("Match: Maya asked you to find one (Sep 20, 2026).");
  const result = events.at(-1).result;
  expect(result).toMatchObject({ status: "matched", person: "maya", personName: "Maya", recipientId: "recipient", relation: "asked_to_find", sourceIds: [sources[0].id], caveats: [] });
  expect(contactLookup).toHaveBeenCalledOnce();
  expect(contactLookup.mock.calls[0][0]).toBe("person_id");
  expect(new Set(contactLookup.mock.calls[0][1])).toEqual(new Set([
    ...result.people.map((item: { personId: string }) => item.personId),
    ...result.advice.map((item: { personId: string }) => item.personId),
  ]));
  expect(result.advice.every((item: { personId: string; recipientId: string }) => item.recipientId === `${item.personId}-recipient`)).toBe(true);
  expect(result.timings).toEqual(expect.objectContaining({
    sourcesMs: expect.any(Number), memoryMs: expect.any(Number), retrievalMs: expect.any(Number),
    decisionMs: expect.any(Number), contactsMs: expect.any(Number), assembledMs: expect.any(Number),
  }));
  expect(result.evidence[0]).toMatchObject({ role: "match", text: sources[0].original_text, shareableQuote: true });
  const sam = result.ruledOut.find((item: { personId: string }) => item.personId === "sam");
  expect(sam.message).toBe("Ruled out Sam: a newer message says they already have one.");
  expect(sam.evidence.map((item: { role: string; text: string }) => [item.role, item.text])).toEqual([["newer", "update: bought the X100V"], ["earlier", "want an X100V"]]);
  expect(events.every((event) => event.captureSource === "quest")).toBe(true);
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner", capture_source: "quest", device_id: "device" }));
  // The terminal event is written after persistence and is not part of the stored trace.
  expect(insert.mock.calls[0][0].trace.some((event) => event.type === "result")).toBe(false);
});

it("fails the scan when matched contacts cannot be verified", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert, contactLookup } = fakeAdmin([], null, { message: "contact lookup failed" });
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 10 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0)] });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" }).text());
  expect(contactLookup).toHaveBeenCalledOnce();
  expect(events.at(-1)).toMatchObject({ type: "error", message: "Could not verify the demo contact." });
  expect(events.some((event) => event.type === "result")).toBe(false);
  expect(insert).not.toHaveBeenCalled();
});

it("replays the nine synthetic messages: Maya connects, her feedback is cited, and no one is ruled out", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  expect(webcamBundle.label).toMatch(/^SYNTHETIC/);
  expect(webcamSources).toHaveLength(9);
  expect(new Set(webcamSources.map((source) => source.speaker_id)).size).toBe(5);
  expect(webcamSources.every((source) => source.is_synthetic)).toBe(true);
  const maya = webcamSources.find((source) => source.original_text.includes("Imaging Edge Webcam"))!;
  fakeAdmin([], null, null, webcamSources);
  mocks.identifyItem.mockResolvedValue({ value: { item: "Imaging Edge Webcam", title: "Imaging Edge Webcam", category: "software", specificity: "exact_title", visibleText: ["Imaging Edge Webcam"], searchTerms: ["Imaging Edge Webcam"], ambiguity: "" }, ms: 10, attempts: 1 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [{ personId: "maya", subject: "person", relation: "owns", evidenceLevel: "exact_title", itemMention: "Imaging Edge Webcam", sentiment: "positive", sourceIds: [maya.id] }] });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" }).text());
  expect(events.map((event) => event.type)).toEqual(["frame_received", "memory_checked", "entity_identified", "context_loaded", "searching", "mentions_found", "matched", "result"]);
  expect(events[3].message).toBe("Prepared memory covers 9 approved messages from 5 people.");
  expect(events[5].message).toBe("Found 1 mention across 1 person.");
  expect(events.find((event) => event.type === "matched").message).toBe("Match: Maya has one and likes it (Sep 25, 2026).");
  expect(events.at(-1).result).toMatchObject({ status: "matched", person: "maya", relation: "owns", sourceIds: [maya.id], evidence: [{ text: maya.original_text, synthetic: true }], advice: [{ personId: "maya", favorable: true, sourceIds: [maya.id], evidence: [{ text: maya.original_text, synthetic: true }] }], ruledOut: [] });
});

it("requires a verified device location before returning a place callback", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  fakeAdmin();
  mocks.identifyItem.mockResolvedValue({ value: { ...identification, entityKind: "place", item: "X100V Cafe", category: "cafe" }, ms: 10, attempts: 1 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "experienced_together", 0)] });

  const unverified = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" }).text());
  expect(unverified.map((event) => event.type)).toContain("location_needed");
  expect(unverified.at(-1).result).toMatchObject({ status: "needs_clarification", entityKind: "place", people: [] });

  const verified = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", location: { latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: new Date().toISOString() } }).text());
  expect(verified.map((event) => event.type)).toContain("location_verified");
  expect(verified.at(-1).result).toMatchObject({ status: "matched", entityKind: "place", location: { verified: true } });
  expect(verified.at(-1).result.location).not.toHaveProperty("latitude");
});

it("adds only a coarse immediate-action signal when a matched contact opted in nearby", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.NEXT_PUBLIC_ENABLE_PROXIMITY = "true";
  const expires_at = new Date(Date.now() + 300_000).toISOString(), captured_at = new Date().toISOString();
  fakeAdmin([
    { user_id: "owner", latitude: 40.741, longitude: -73.989, accuracy: 20, captured_at, expires_at },
    { user_id: "recipient", latitude: 40.7411, longitude: -73.989, accuracy: 18, captured_at, expires_at },
  ]);
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 10, attempts: 1 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0)] });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", location: { latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: new Date().toISOString() } }).text());
  expect(events.map((event) => event.type)).toContain("contact_nearby");
  expect(events.at(-1).result).toMatchObject({ proximity: { status: "same_place", distanceBand: "within_75m" } });
  expect(JSON.stringify(events.at(-1).result)).not.toContain("40.7411");
});

it("does not disclose a contact's proximity unless the scanner also opted in", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_ENABLE_PROXIMITY = "true";
  fakeAdmin([{ user_id: "recipient", latitude: 40.7411, longitude: -73.989, accuracy: 18, captured_at: new Date().toISOString(), expires_at: new Date(Date.now() + 300_000).toISOString() }]);
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 10, attempts: 1 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0)] });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", location: { latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: new Date().toISOString() } }).text());
  expect(events.at(-1).result.status).toBe("matched");
  expect(events.at(-1).result.proximity).toBeUndefined();
});

it("completes a normal callback when the optional presence table is missing", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_ENABLE_PROXIMITY = "true";
  fakeAdmin([], { code: "42P01", message: "relation location_presence does not exist" });
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 10, attempts: 1 });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0)] });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", location: { latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: new Date().toISOString() } }).text());
  expect(events.at(-1).type).toBe("result");
  expect(events.at(-1).result).toMatchObject({ status: "matched", person: "maya" });
  expect(events.at(-1).result.proximity).toBeUndefined();
});

it("scans with only an OpenAI key and persists provider, model, and vision usage", async () => {
  process.env.MODEL_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.OPENAI_MODEL = "gpt-5.4-mini";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert } = fakeAdmin();
  const visionUsage = { inputTokens: 110, outputTokens: 25, totalTokens: 135 };
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 900, attempts: 1, usage: visionUsage });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0)] });

  const response = scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" });
  expect(response.status).toBe(200);
  const events = lines(await response.text());
  const result = events.at(-1).result;
  expect(result.model).toEqual({ provider: "openai", model: "gpt-5.4-mini", visionModel: "gpt-5.4-mini" });
  expect(result.usage).toEqual({ vision: visionUsage });
  expect(insert.mock.calls[0][0]).toMatchObject({ result: { model: result.model, usage: result.usage } });
  expect(events.at(-1).type).toBe("result");
  expect(mocks.identifyItem).toHaveBeenCalledOnce();
  expect(mocks.extractRelations).not.toHaveBeenCalled();
});

it("rejects a selected provider with only the other provider's key before starting paid work", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.MODEL_PROVIDER = "openai";
  process.env.MODEL_API_KEY = "meta-test-key";
  const openaiResponse = scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" });
  expect(openaiResponse.status).toBe(503);
  expect(lines(await openaiResponse.text())[0].message).toMatch(/OPENAI_API_KEY/);

  delete process.env.MODEL_API_KEY;
  process.env.MODEL_PROVIDER = "meta";
  process.env.OPENAI_API_KEY = "openai-test-key";
  const metaResponse = scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" });
  expect(metaResponse.status).toBe(503);
  expect(lines(await metaResponse.text())[0].message).toMatch(/MODEL_API_KEY/);
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
  expect(mocks.identifyItem).not.toHaveBeenCalled();
  expect(mocks.extractRelations).not.toHaveBeenCalled();
});

it("reports a failed inference as an error, never as a result, and cleans up the photo", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert, remove } = fakeAdmin();
  mocks.identifyItem.mockRejectedValue(new ModelError("Model request timed out.", 408));
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera" }).text());
  expect(events.at(-1)).toMatchObject({ type: "error", message: "Model request timed out." });
  expect(events.some((event) => event.type === "result")).toBe(false);
  expect(insert).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(remove).toHaveBeenCalled());
});

it("stops paid work and never reports completion when the client disconnects mid-inference", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert, remove } = fakeAdmin();
  const request = new AbortController();
  let visionSignal: AbortSignal | undefined;
  mocks.identifyItem.mockImplementation((_image, signal: AbortSignal) => { visionSignal = signal; return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))); });
  const reader = scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", signal: request.signal }).body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("memory_checked")) { const next = await reader.read(); if (next.done) throw new Error(`Stream ended early: ${text}`); text += decoder.decode(next.value); }
  await reader.cancel();
  expect(visionSignal?.aborted).toBe(true);
  await vi.waitFor(() => expect(remove).toHaveBeenCalled());
  expect(insert).not.toHaveBeenCalled();
});


it("uses prepared memory with one vision call and no photo or scan writes for hover", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert } = fakeAdmin();
  const upload = vi.fn();
  mocks.adminSupabase().storage.from = () => ({ upload });
  mocks.loadCurrentIndex.mockResolvedValue({ relations: [relation("maya", "asked_to_find", 0)] });
  mocks.identifyItem.mockResolvedValue({ value: identification, ms: 900 });
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", preview: true }).text());
  expect(events.at(-1).result).toMatchObject({ persisted: false, person: "maya", memory: { ready: true }, timings: { relationsMs: 0 } });
  expect(events.at(-1).result.previewToken).toEqual(expect.any(String));
  expect(mocks.extractRelations).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it("blocks hover before paid vision if prepared memory is stale or missing", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert } = fakeAdmin();
  mocks.loadCurrentIndex.mockResolvedValue(null);
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_camera", preview: true }).text());
  expect(events.at(-1)).toMatchObject({ type: "error", code: "memory_required", reason: "missing_or_stale", sourceCount: 4,
    corpusRevision: expect.any(String), memoryMs: expect.any(Number) });
  expect(mocks.identifyItem).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it.each(["phone_camera", "phone_upload", "quest", "glasses"] as const)("blocks %s before paid vision or photo upload when memory is stale", async (captureSource) => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { insert, upload } = fakeAdmin();
  mocks.loadCurrentIndex.mockResolvedValue(null);
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource }).text());
  expect(events.at(-1)).toMatchObject({ type: "error", code: "memory_required", reason: "missing_or_stale", captureSource });
  expect(events.some((event) => event.type === "entity_identified" || event.type === "result")).toBe(false);
  expect(mocks.identifyItem).not.toHaveBeenCalled();
  expect(mocks.extractRelations).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it("reports index read failure as actionable memory error before paid work", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { upload, insert } = fakeAdmin();
  mocks.loadCurrentIndex.mockRejectedValue(new Error("private database detail"));
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_upload" }).text());
  expect(events.at(-1)).toMatchObject({ type: "error", code: "memory_required", reason: "read_failed", sourceCount: 4,
    corpusRevision: expect.any(String), memoryMs: expect.any(Number) });
  expect(JSON.stringify(events)).not.toContain("private database detail");
  expect(mocks.identifyItem).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it("asks for approved context when the source corpus is empty", async () => {
  process.env.MODEL_API_KEY = "test-only"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const { upload } = fakeAdmin([], null, null, []);
  const events = lines(await scanResponse({ ownerId: "owner", image: photo(), captureSource: "phone_upload" }).text());
  expect(events.at(-1)).toMatchObject({ type: "error", code: "memory_required", reason: "no_sources", sourceCount: 0 });
  expect(events.at(-1).message).toMatch(/Import approved context/);
  expect(mocks.loadCurrentIndex).not.toHaveBeenCalled();
  expect(mocks.identifyItem).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
});
