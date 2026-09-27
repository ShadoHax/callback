import { afterEach, expect, it, vi } from "vitest";
import type { adminSupabase } from "../src/lib/admin-supabase";
import { decide, type Source } from "../src/lib/decision";
import { loadCurrentIndex, prepareKnowledgeIndex, type IndexedRelation } from "../src/lib/knowledge-index";

const ownerId = "1cb4ac67-696a-49c5-9be1-65040ff9e38d";
const oldId = "885edbf2-d497-4f6f-a2cf-342711970001";
const updateId = "885edbf2-d497-4f6f-a2cf-342711970002";
const source = (id: string, text: string, date: string): Source => ({
  id, speaker_id: "maya", thread_id: "maya", participant_ids: ["owner", "maya"],
  original_text: text, source_at: date, is_synthetic: true,
});
const relation = (kind: IndexedRelation["relation"], id: string): IndexedRelation => ({
  personId: "maya", subject: "person", relation: kind, evidenceLevel: "exact_title", itemMention: "Wingspan",
  sentiment: "none", sourceIds: [id], aliases: [], itemCategory: "board game",
});
const photo = { item: "Wingspan", title: "Wingspan", category: "board game", specificity: "exact_title" as const,
  visibleText: ["WINGSPAN"], searchTerms: ["Wingspan"], ambiguity: "" };

function fakeAdmin(initialSources: Source[]) {
  let row: Record<string, unknown> | null = null;
  let currentSources = initialSources;
  const upsert = vi.fn(async (value: Record<string, unknown>) => { row = value; return { error: null }; });
  const from = vi.fn((table: string) => {
    if (table === "context_indexes") return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
      upsert,
    };
    if (table === "sources") return {
      select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: currentSources, error: null }) }) }) }),
    };
    throw new Error(`Unexpected table ${table}`);
  });
  return { admin: { from } as unknown as ReturnType<typeof adminSupabase>, upsert,
    setSources: (value: Source[]) => { currentSources = value; },
    corruptRelation: (kind: IndexedRelation["relation"]) => {
      if (!row || !Array.isArray(row.relations)) throw new Error("No saved index");
      row = { ...row, relations: row.relations.map((item: IndexedRelation) => item.relation === kind ? { ...item, sourceIds: ["not-a-uuid"] } : item) };
    } };
}

function answer(relations: unknown[]) {
  return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_PROVIDER;
});

it.each([
  { before: "Let's play Wingspan next weekend.", after: "Let's cancel our Wingspan plan.", positive: "planned_together", negative: "cancelled" },
  { before: "I want Wingspan for my birthday.", after: "I bought Wingspan yesterday.", positive: "wanted", negative: "owns" },
] as const)("retries an invalid newer $negative before saving an old $positive", async ({ before, after, positive, negative }) => {
  process.env.MODEL_API_KEY = "test-only";
  const old = source(oldId, before, "2026-09-01T00:00:00Z");
  const update = source(updateId, after, "2026-09-26T00:00:00Z");
  const db = fakeAdmin([old]);
  const firstRelation = relation(positive, oldId);
  const newer = relation(negative, updateId);
  const malformedNewer = { ...newer, sourceIds: ["not-a-uuid"] };
  const calls: { ids: string[]; feedback: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const ids = [oldId, updateId].filter((id) => String(body.messages[1].content).includes(id));
    const feedback = String(body.messages[0].content);
    calls.push({ ids, feedback });
    if (ids.length === 1) return answer([firstRelation]);
    return answer(feedback.includes("previous answer could not be verified") ? [firstRelation, newer] : [firstRelation, malformedNewer]);
  }));

  await prepareKnowledgeIndex({ ownerId, sources: [old], admin: db.admin });
  db.setSources([old, update]);
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [old, update], admin: db.admin });

  expect(prepared).toMatchObject({ modelCalls: 2, rejectedCount: 1, extractedThreads: 1, reusedThreads: 0 });
  expect(prepared.usage).toHaveLength(2);
  expect(calls).toHaveLength(3);
  expect(calls.slice(1).map((call) => call.ids)).toEqual([[oldId, updateId], [oldId, updateId]]);
  expect(calls[2].feedback).toMatch(/invalid sourceIds/);
  expect(prepared.index.relations.map((item) => item.relation)).toEqual([positive, negative]);
  expect(decide({ identification: photo, relations: prepared.index.relations, sources: [old, update], ownerIds: [] }).status).toBe("no_match");
  expect(db.upsert).toHaveBeenCalledTimes(2);
});

it("does not publish a partial new revision when the newer cancellation stays invalid", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const old = source(oldId, "Let's play Wingspan next weekend.", "2026-09-01T00:00:00Z");
  const update = source(updateId, "Let's cancel our Wingspan plan.", "2026-09-26T00:00:00Z");
  const db = fakeAdmin([old]);
  const plan = relation("planned_together", oldId);
  const malformedCancel = { ...relation("cancelled", updateId), sourceIds: ["not-a-uuid"] };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const changed = String(JSON.parse(String(init.body)).messages[1].content).includes(updateId);
    return answer(changed ? [plan, malformedCancel] : [plan]);
  });
  vi.stubGlobal("fetch", fetchMock);

  await prepareKnowledgeIndex({ ownerId, sources: [old], admin: db.admin });
  db.setSources([old, update]);
  await expect(prepareKnowledgeIndex({ ownerId, sources: [old, update], admin: db.admin }))
    .rejects.toThrow(/unverifiable context evidence after retries/);
  // One call for the first build, then the first answer and two retries for the changed thread.
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(db.upsert).toHaveBeenCalledOnce();
  expect(await loadCurrentIndex({ ownerId, sources: [old, update], admin: db.admin })).toBeNull();
});

it("counts verification retries against the 60-batch budget", async () => {
  process.env.MODEL_API_KEY = "test-only";
  // One near-limit message per thread forces 31 model batches; repairing every first answer would need 62 calls.
  const sources = Array.from({ length: 31 }, (_, index): Source => ({
    ...source(`885edbf2-d497-4f6f-a2cf-${String(index + 1).padStart(12, "0")}`, `Wingspan ${"x".repeat(22_900)}`, "2026-09-01T00:00:00Z"),
    thread_id: `thread-${index}`,
  }));
  const db = fakeAdmin(sources);
  const attempts = new Map<string, number>();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const content = String(JSON.parse(String(init.body)).messages[1].content);
    const record = JSON.parse(content.split("(JSON): ")[1]) as { id: string }[];
    const id = record[0].id;
    const count = (attempts.get(id) ?? 0) + 1;
    attempts.set(id, count);
    return answer([{ ...relation("wanted", id), sourceIds: count === 1 ? ["not-a-uuid"] : [id] }]);
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(prepareKnowledgeIndex({ ownerId, sources, admin: db.admin })).rejects.toThrow(/60-call model budget/);
  expect(fetchMock).toHaveBeenCalledTimes(60);
  expect(db.upsert).not.toHaveBeenCalled();
});

it("re-extracts instead of reusing a saved thread with a damaged cancellation", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const old = source(oldId, "Let's play Wingspan next weekend.", "2026-09-01T00:00:00Z");
  const update = source(updateId, "Let's cancel our Wingspan plan.", "2026-09-26T00:00:00Z");
  const unrelated = { ...source("885edbf2-d497-4f6f-a2cf-342711970003", "See you soon.", "2026-09-26T01:00:00Z"), thread_id: "unrelated" };
  const db = fakeAdmin([old, update]);
  const plan = relation("planned_together", oldId);
  const cancellation = relation("cancelled", updateId);
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const content = String(JSON.parse(String(init.body)).messages[1].content);
    return answer(content.includes(oldId) ? [plan, cancellation] : []);
  });
  vi.stubGlobal("fetch", fetchMock);
  await prepareKnowledgeIndex({ ownerId, sources: [old, update], admin: db.admin });
  db.corruptRelation("cancelled");
  db.setSources([old, update, unrelated]);

  const rebuilt = await prepareKnowledgeIndex({ ownerId, sources: [old, update, unrelated], admin: db.admin });
  expect(rebuilt.reusedThreads).toBe(0);
  expect(rebuilt.index.relations.map((item) => item.relation)).toEqual(["planned_together", "cancelled"]);
  expect(decide({ identification: photo, relations: rebuilt.index.relations, sources: [old, update, unrelated], ownerIds: [] }).status).toBe("no_match");
});
