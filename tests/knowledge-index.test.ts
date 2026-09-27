import { afterEach, expect, it, vi } from "vitest";
import type { adminSupabase } from "../src/lib/admin-supabase";
import { corpusRevision } from "../src/lib/corpus";
import type { Identification, Source } from "../src/lib/decision";
import { INDEX_PROMPT_VERSION, loadCurrentIndex, prepareKnowledgeIndex, presentationForConnection, selectIndexedRelations, type IndexedRelation, type KnowledgeIndex } from "../src/lib/knowledge-index";

// Relations are stored with the hash of their thread; compare the evidence itself.
const withoutHash = (list: IndexedRelation[]) => list.map((item) => { const copy = { ...item }; delete copy.threadHash; return copy; });

const ownerId = "1cb4ac67-696a-49c5-9be1-65040ff9e38d";
const source: Source = { id: "885edbf2-d497-4f6f-a2cf-342711970001", speaker_id: "maya", thread_id: "demo",
  participant_ids: ["owner", "maya"], original_text: "If you spot an X100V, send me a picture.", source_at: "2026-09-20T00:00:00Z", is_synthetic: true };
const relation: IndexedRelation = { personId: "maya", subject: "person", relation: "asked_to_find", evidenceLevel: "exact_title",
  itemMention: "X100V", sentiment: "none", sourceIds: [source.id], reason: "Maya asked you to look for one.", aliases: [], itemCategory: "camera" };
const identification: Identification = { item: "Fujifilm X100V", category: "camera", specificity: "exact_title", visibleText: ["X100V"], searchTerms: ["X100V"], ambiguity: "" };

function fakeAdmin(initialSources = [source]) {
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
    setRow: (value: Record<string, unknown> | null) => { row = value; },
    setSources: (value: Source[]) => { currentSources = value; } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MODEL_API_KEY;
  delete process.env.MODEL_PROVIDER;
  delete process.env.META_MODEL;
});

it("extracts relationships once, persists them, and reuses the current revision without another model call", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.messages[1].content).toContain(source.id);
    expect(body.messages[0].content).toMatch(/ALL distinct physical items/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [relation] }) } }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const first = await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  expect(first).toMatchObject({ reused: false, modelCalls: 1, droppedCount: 0 });
  expect(withoutHash(first.index.relations)).toEqual([relation]);
  expect(db.upsert).toHaveBeenCalledOnce();
  const second = await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  expect(second).toMatchObject({ reused: true, modelCalls: 0 });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("prepares concise presentation metadata and reads it only from the selected cited relation", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin();
  const presented = { ...relation, shortLabel: "Camera Search", suggestedActions: [
    { kind: "plan", label: "Do you want to plan a search for the X100V?" },
    { kind: "plan", label: "Would you like another camera search plan?" },
  ] };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({
    choices: [{ message: { content: JSON.stringify({ relations: [presented] }) } }],
  }) })));
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  const expectedActions = presented.suggestedActions.slice(0, 1);
  expect(prepared.index.relations[0]).toMatchObject({ shortLabel: "Camera Search", suggestedActions: expectedActions });
  const chosen = { personId: "maya", relation: "asked_to_find", sourceIds: [source.id], mention: "X100V" };
  expect(presentationForConnection(prepared.index, chosen)).toEqual({
    shortLabel: "Camera Search", suggestedActions: expectedActions,
  });
  expect(presentationForConnection(prepared.index, { ...chosen, personId: "someone-else" })).toEqual({
    shortLabel: "X100V", suggestedActions: [],
  });
  expect(presentationForConnection(prepared.index, { ...chosen, sourceIds: ["885edbf2-d497-4f6f-a2cf-342711970002"] })).toEqual({
    shortLabel: "X100V", suggestedActions: [],
  });
});

it("coalesces concurrent preparations and rejects a stale corpus before persisting", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const fetchMock = vi.fn(async () => {
    await gate;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [relation] }) } }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const first = prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  const second = prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  expect(second).toBe(first);
  db.setSources([{ ...source, original_text: "A changed message." }]);
  release();
  await expect(first).rejects.toThrow(/Context changed/);
  expect(db.upsert).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("never loads a row for an old revision or another model", async () => {
  const db = fakeAdmin();
  const revision = corpusRevision([source]);
  db.setRow({ cache_key: "wrong-key", corpus_revision: revision, provider: "meta", model: "muse-spark-1.3",
    prompt_version: INDEX_PROMPT_VERSION, source_count: 1, relations: [relation] });
  expect(await loadCurrentIndex({ ownerId, sources: [source], admin: db.admin })).toBeNull();
});

it("selects the named model while excluding other models and editions", () => {
  const index: KnowledgeIndex = { revision: corpusRevision([source]), provider: "meta", model: "muse-spark-1.3",
    promptVersion: INDEX_PROMPT_VERSION, sourceCount: 1, relations: [relation,
      { ...relation, personId: "lee", itemMention: "X100VI", aliases: [] },
      { ...relation, personId: "ria", itemMention: "X100V Deluxe", aliases: [] },
      { ...relation, personId: "sam", itemMention: "Nikon Zf", aliases: [], itemCategory: "camera" }] };
  expect(selectIndexedRelations(identification, index).map((item) => item.personId)).toEqual(["maya"]);
});

it("does not let a primary visible-item name erase its confirmed edition during retrieval", () => {
  const index: KnowledgeIndex = { revision: "a".repeat(64), provider: "meta", model: "muse-spark-1.3",
    promptVersion: INDEX_PROMPT_VERSION, sourceCount: 2, relations: [
      { ...relation, personId: "maya", relation: "wanted", itemMention: "Wingspan", itemCategory: "board game" },
      { ...relation, personId: "sam", relation: "wanted", itemMention: "Wingspan 2nd Edition", itemCategory: "board game" },
    ] };
  const photo: Identification = { item: "Wingspan 2nd Edition", title: "Wingspan", edition: "2nd Edition", category: "board game",
    specificity: "exact_title", visibleText: ["Wingspan", "2nd Edition"], searchTerms: ["Wingspan"], ambiguity: "",
    visibleItems: [{ name: "Wingspan", category: "board game" }] };
  expect(selectIndexedRelations(photo, index).map((item) => item.personId)).toEqual(["sam"]);
  const book = { ...photo, item: "War and Peace", title: "War and Peace", edition: "Penguin Classics", category: "book",
    visibleItems: [{ name: "War and Peace", category: "book" }] };
  const bookIndex = { ...index, relations: [{ ...relation, personId: "maya", itemMention: "War and Peace", itemCategory: "book" }] };
  expect(selectIndexedRelations(book, bookIndex).map((item) => item.personId)).toEqual(["maya"]);
  const otherVariant = { ...index, relations: [...index.relations,
    { ...relation, personId: "lee", relation: "wanted" as const, itemMention: "Wingspan Deluxe Edition", itemCategory: "board game" }] };
  expect(selectIndexedRelations({ ...photo, visibleItems: [...photo.visibleItems!, { name: "Wingspan Deluxe Edition", category: "board game" }] }, otherVariant)
    .map((item) => item.personId)).toEqual(["sam", "lee"]);
});

it("retains named and category soda evidence for broad photos without accepting a different exact title", () => {
  const soda: KnowledgeIndex = { revision: "a".repeat(64), provider: "meta", model: "muse-spark-1.3",
    promptVersion: INDEX_PROMPT_VERSION, sourceCount: 2, relations: [
      { ...relation, personId: "agarwal", relation: "prefers", sentiment: "positive", itemMention: "Diet Coke", itemCategory: "soda" },
      { ...relation, personId: "alan", relation: "prefers", sentiment: "positive", evidenceLevel: "category", itemMention: "zero sugar sodas", itemCategory: "soda" },
      { ...relation, personId: "lee", itemMention: "Wingspan", itemCategory: "board game" },
    ] };
  const photo = { ...identification, item: "soda cans on a shelf", category: "soda can", specificity: "category" as const,
    title: undefined, visibleText: [], searchTerms: [] };
  expect(selectIndexedRelations(photo, soda).map((item) => item.personId)).toEqual(["agarwal", "alan"]);
  expect(selectIndexedRelations({ ...photo, category: "soft drink can" }, soda)
    .map((item) => item.personId)).toEqual(["agarwal", "alan"]);
  expect(selectIndexedRelations({ ...photo, item: "Coca-Cola cans", specificity: "product_family", searchTerms: ["Coca-Cola"] }, soda)
    .map((item) => item.personId)).toEqual(["agarwal", "alan"]);
  expect(selectIndexedRelations({ ...photo, item: "Coca-Cola cans", category: "carbonated drink can", specificity: "product_family" }, soda)
    .map((item) => item.personId)).toEqual(["agarwal", "alan"]);
  expect(selectIndexedRelations({ ...photo, item: "Coke Zero", title: "Coke Zero", specificity: "exact_title" }, soda)
    .map((item) => item.personId)).toEqual(["alan"]);
  expect(selectIndexedRelations({ ...photo, item: "Coke Zero", title: "Coke Zero", specificity: "exact_title",
    visibleItems: [{ name: "Diet Coke", category: "soda" }] }, soda).map((item) => item.personId)).toEqual(["agarwal", "alan"]);
});

it("keeps Wingspan Asia distinct from the base Wingspan title in both directions", () => {
  const base = { ...relation, itemMention: "Wingspan", itemCategory: "board game", evidenceLevel: "exact_title" as const };
  const asia = { ...relation, personId: "lee", itemMention: "Wingspan Asia", itemCategory: "board game", evidenceLevel: "exact_title" as const };
  const index: KnowledgeIndex = { revision: corpusRevision([source]), provider: "meta", model: "muse-spark-1.3",
    promptVersion: INDEX_PROMPT_VERSION, sourceCount: 1, relations: [base, asia] };
  const item = { ...identification, item: "Wingspan Asia", category: "board game", visibleText: ["Wingspan", "Asia"], searchTerms: ["Wingspan"] };
  expect(selectIndexedRelations(item, index).map((entry) => entry.personId)).toEqual(["lee"]);
  expect(selectIndexedRelations({ ...item, item: "Wingspan" }, index).map((entry) => entry.personId)).toEqual(["maya"]);
  expect(selectIndexedRelations({ ...item, item: "Wingspan (Stonemaier Games)" }, index).map((entry) => entry.personId)).toEqual(["maya"]);
  expect(selectIndexedRelations({ ...item, item: "Wingspan (Asia)" }, index).map((entry) => entry.personId)).toEqual(["lee"]);
});

it("prepares an empty corpus without a model call", async () => {
  const db = fakeAdmin([]);
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const result = await prepareKnowledgeIndex({ ownerId, sources: [], admin: db.admin });
  expect(result).toMatchObject({ modelCalls: 0, index: { sourceCount: 0, relations: [] } });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("packs short threads into bounded calls without losing source IDs", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const sources = Array.from({ length: 21 }, (_, index): Source => ({ ...source,
    id: `885edbf2-d497-4f6f-a2cf-${String(index + 1).padStart(12, "0")}`,
    thread_id: `thread-${index}`, original_text: `Camera mention ${index}` }));
  const db = fakeAdmin(sources);
  const seen = new Set<string>();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const records = JSON.parse(String(JSON.parse(String(init.body)).messages[1].content).split("(JSON): ")[1]) as { id: string }[];
    records.forEach((record) => seen.add(record.id));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [] }) } }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const result = await prepareKnowledgeIndex({ ownerId, sources, admin: db.admin });
  expect(result.modelCalls).toBe(3);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(seen.size).toBe(21);
});

it("keeps a long thread within the output-safe message batch size while preserving its context", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const sources = Array.from({ length: 24 }, (_, index): Source => ({ ...source,
    id: `885edbf2-d497-4f6f-a2cf-${String(index + 1).padStart(12, "0")}`,
    original_text: `Camera update ${index}`, source_at: `2026-09-20T${String(index).padStart(2, "0")}:00:00Z`,
  }));
  const db = fakeAdmin(sources);
  const batches: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const records = JSON.parse(String(JSON.parse(String(init.body)).messages[1].content).split("(JSON): ")[1]) as { id: string }[];
    batches.push(records.map((record) => record.id));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [] }) } }] }) };
  }));
  await prepareKnowledgeIndex({ ownerId, sources, admin: db.admin });
  expect(batches.length).toBeGreaterThan(1);
  expect(batches.every((batch) => batch.length <= 8)).toBe(true);
  expect(new Set(batches.flat())).toEqual(new Set(sources.map((item) => item.id)));
  expect(batches.slice(1).every((batch, index) =>
    batches[index].slice(-2).every((id) => batch.includes(id)))).toBe(true);
});

it("does not turn a relayed wish into the speaker's own request", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const relay: Source = { ...source, speaker_id: "jordan", thread_id: "jordan", participant_ids: ["owner", "jordan"],
    original_text: "My brother keeps asking for Wingspan for his birthday, any idea where to get it?" };
  const db = fakeAdmin([relay]);
  const thirdParty: IndexedRelation = { ...relation, personId: "jordan", subject: "third_party", relation: "wanted",
    itemMention: "Wingspan", sourceIds: [relay.id], itemCategory: "board game" };
  const mistakenSelf: IndexedRelation = { ...thirdParty, subject: "person", relation: "asked_to_find" };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ relations: [thirdParty, mistakenSelf] }),
  } }] }) }));
  vi.stubGlobal("fetch", fetchMock);
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [relay], admin: db.admin });
  expect(withoutHash(prepared.index.relations)).toEqual([thirdParty]);
  expect(prepared.droppedCount).toBe(1);
});

it("keeps a separate explicit wish by the speaker in the same source", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const relay: Source = { ...source, speaker_id: "jordan", thread_id: "jordan", participant_ids: ["owner", "jordan"],
    original_text: "My brother wants Wingspan. I also want one." };
  const db = fakeAdmin([relay]);
  const thirdParty: IndexedRelation = { ...relation, personId: "jordan", subject: "third_party", relation: "wanted",
    itemMention: "Wingspan", sourceIds: [relay.id], itemCategory: "board game" };
  const ownWish: IndexedRelation = { ...thirdParty, subject: "person" };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ relations: [thirdParty, ownWish] }),
  } }] }) })));
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [relay], admin: db.admin });
  expect(withoutHash(prepared.index.relations)).toEqual([thirdParty, ownWish]);
  expect(prepared.droppedCount).toBe(0);
});

it("does not collapse a speaker's different edition into a third party's title", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const relay: Source = { ...source, speaker_id: "jordan", thread_id: "jordan", participant_ids: ["owner", "jordan"],
    original_text: "My brother wants Wingspan. I want Wingspan Asia." };
  const db = fakeAdmin([relay]);
  const thirdParty: IndexedRelation = { ...relation, personId: "jordan", subject: "third_party", relation: "wanted",
    itemMention: "Wingspan", sourceIds: [relay.id], itemCategory: "board game" };
  const ownWish: IndexedRelation = { ...thirdParty, subject: "person", itemMention: "Wingspan Asia" };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ relations: [thirdParty, ownWish] }),
  } }] }) })));
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [relay], admin: db.admin });
  expect(withoutHash(prepared.index.relations)).toEqual([thirdParty, ownWish]);
});

// ---- Fixes after the hover review (Sept 26) ----
import { productName } from "../src/lib/knowledge-index";

const planIndex = (itemMention: string, category = "board game"): KnowledgeIndex => ({
  revision: "a".repeat(64), provider: "openai", model: "m", promptVersion: INDEX_PROMPT_VERSION, sourceCount: 1,
  relations: [{ ...relation, relation: "planned_together", itemMention, itemCategory: category }],
});
const photoOf = (item: string, title?: string, category = "board game"): Identification =>
  ({ item, ...(title !== undefined ? { title } : {}), category, specificity: "exact_title", searchTerms: ["Wingspan"], visibleText: ["WINGSPAN"], ambiguity: "" });

it.each([
  ["Wingspan", undefined],
  ["Wingspan board game by Stonemaier Games", undefined],
  ["Wingspan: A Competitive Bird-Collection Game", undefined],
  ["Stonemaier Games Wingspan", "Wingspan"],
  ["Wingspan: A Competitive Bird-Collection Game, 2nd printing", "Wingspan"],
])("matches Maya's 'Wingspan' plan when the photo is described as %s (title %s)", (item, title) => {
  expect(selectIndexedRelations(photoOf(item, title), planIndex("Wingspan"))).toHaveLength(1);
});

it.each([
  ["Wingspan Asia", "Wingspan Asia"],
  ["Wingspan: European Expansion", undefined],
  ["Wingspan European Expansion by Stonemaier Games", "Wingspan European Expansion"],
  ["Wyrmspan", "Wyrmspan"],
  ["Wingspan (2nd Edition)", undefined],
  ["Ticket to Ride: Rails and Sails", "Ticket to Ride: Rails and Sails"],
])("still rejects a different product described as %s", (item, title) => {
  const mention = item.startsWith("Ticket") ? "Ticket to Ride" : "Wingspan";
  expect(selectIndexedRelations(photoOf(item, title), planIndex(mention))).toHaveLength(0);
});

it("treats an explicit title as authoritative even when the description or search terms name another product", () => {
  const base = planIndex("Wingspan");
  const photo = { ...photoOf("Wingspan base game", "Wingspan Asia"), searchTerms: ["Wingspan"], visibleText: ["Wingspan"] };
  expect(selectIndexedRelations(photo, base)).toHaveLength(0);
  expect(selectIndexedRelations({ ...photo, item: "Wingspan Asia expansion", title: "Wingspan" }, base)).toHaveLength(1);
});

it("does not trust a family label when the cited words name a different exact product", () => {
  const index = planIndex("Wingspan");
  index.relations[0] = { ...index.relations[0], evidenceLevel: "product_family" };
  expect(selectIndexedRelations(photoOf("Wingspan Asia", "Wingspan Asia"), index)).toHaveLength(0);
});

it("keeps camera editions apart through the title field", () => {
  expect(selectIndexedRelations(photoOf("Fujifilm X100VI mirrorless camera", "Fujifilm X100VI", "camera"), planIndex("X100V", "camera"))).toHaveLength(0);
  expect(selectIndexedRelations(photoOf("Fujifilm X100V digital camera", "Fujifilm X100V", "camera"), planIndex("X100V", "camera"))).toHaveLength(1);
});

it.each([
  ["Wingspan board game by Stonemaier Games", "Wingspan board game"],
  ["Wingspan (2nd Edition)", "Wingspan (2nd Edition)"],
  ["Wingspan: A Competitive Bird-Collection Game", "Wingspan"],
  ["Wingspan: European Expansion", "Wingspan: European Expansion"],
  ["Catan: 5-6 Player Extension", "Catan: 5-6 Player Extension"],
  ["Stand by Me", "Stand by Me"],
  ["Blonde - Deluxe Edition", "Blonde - Deluxe Edition"],
  ["Ticket to Ride: Rails and Sails", "Ticket to Ride: Rails and Sails"],
  ["Call Me by Your Name", "Call Me by Your Name"],
])("productName(%s) → %s", (input, expected) => expect(productName(input)).toBe(expected));

it("refuses to save a batch that remains unverifiable after two retries", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const other: Source = { ...source, id: "885edbf2-d497-4f6f-a2cf-342711970002", thread_id: "elsewhere", original_text: "Anyway, the X100V." };
  const db = fakeAdmin([source, other]);
  const good = relation;
  const crossThread = { ...relation, sourceIds: [source.id, other.id] };
  const namesOwner = { ...relation, personId: "owner" };
  const paraphrased = { ...relation, itemMention: "Fuji X100 five" };
  const malformed = { ...relation, sourceIds: ["not-a-uuid"] };
  const missingField = { personId: "maya" };
  // Each thread now gets its own call; the mock answers only for the thread it is given.
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => ({ ok: true, json: async () => ({ choices: [{ message: {
    content: JSON.stringify({ relations: String(JSON.parse(String(init.body)).messages[1].content).includes(source.id) ? [good, crossThread, namesOwner, paraphrased, malformed, missingField] : [] }),
  } }] }) })));
  await expect(prepareKnowledgeIndex({ ownerId, sources: [source, other], admin: db.admin }))
    .rejects.toThrow(/unverifiable context evidence after retries/);
  expect(db.upsert).not.toHaveBeenCalled();
});

it("drops an invented alias instead of retrying or failing the whole memory", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin();
  // "Fuji X100V" is not in the cited message, and "X100VI" names a different model; neither may become an alias.
  const answer = { ...relation, aliases: ["Fuji X100V", "X100VI"] };
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [answer] }) } }] }) }));
  vi.stubGlobal("fetch", fetchMock);
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  expect(prepared).toMatchObject({ modelCalls: 1, rejectedCount: 0 });
  expect(withoutHash(prepared.index.relations)).toEqual([relation]);
});

it("tells the model a liked item is owns with positive sentiment, never dislikes", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin();
  let prompt = "";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    prompt = JSON.parse(String(init.body)).messages[0].content;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [] }) } }] }) };
  }));
  await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  expect(prompt).toMatch(/love it" is owns with sentiment positive/);
  expect(prompt).toMatch(/Never use dislikes for a positive opinion/);
  expect(prompt).toMatch(/positive opinion about a named product without ownership is prefers at exact_title level/);
  expect(prompt).toMatch(/named variants separate/);
  expect(prompt).toMatch(/I love all zero sugar sodas/);
});

it("no longer asks the model for a reason it would discard", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin();
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const item = body.response_format.json_schema.schema.properties.relations.items;
    expect(item.required).not.toContain("reason");
    expect(item.properties.reason).toBeUndefined();
    const withoutReason: Partial<IndexedRelation> = { ...relation };
    delete withoutReason.reason;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [withoutReason] }) } }] }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  expect(prepared.index.relations).toHaveLength(1);
});

it("rebuilds only changed threads: an added update reads one thread, and removing it reads none", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const noah: Source = { ...source, id: "885edbf2-d497-4f6f-a2cf-342711970003", speaker_id: "noah", thread_id: "noah", participant_ids: ["owner", "noah"], original_text: "Finally got the X100V, love it." };
  const update: Source = { ...source, id: "885edbf2-d497-4f6f-a2cf-342711970004", thread_id: "demo-update-1", original_text: "Update: I bought the X100V!", source_at: "2026-09-26T00:00:00Z" };
  const noahOwns: IndexedRelation = { ...relation, personId: "noah", relation: "owns", sentiment: "positive", sourceIds: [noah.id] };
  const mayaOwns: IndexedRelation = { ...relation, relation: "owns", sourceIds: [update.id] };
  const db = fakeAdmin([source, noah]);
  const seen: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const text = JSON.parse(String(init.body)).messages[1].content as string;
    const ids = [source.id, noah.id, update.id].filter((id) => text.includes(id));
    seen.push(ids);
    const relations = [relation, noahOwns, mayaOwns].filter((item) => ids.includes(item.sourceIds[0]));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations }) } }] }) };
  }));
  const first = await prepareKnowledgeIndex({ ownerId, sources: [source, noah], admin: db.admin });
  expect(first).toMatchObject({ modelCalls: 2, extractedThreads: 2, reusedThreads: 0 });

  db.setSources([source, noah, update]);
  const updated = await prepareKnowledgeIndex({ ownerId, sources: [source, noah, update], admin: db.admin });
  expect(updated).toMatchObject({ modelCalls: 1, extractedThreads: 1, reusedThreads: 2 });
  expect(seen.at(-1)).toEqual([update.id]);
  expect(withoutHash(updated.index.relations)).toEqual(expect.arrayContaining([relation, noahOwns, mayaOwns]));

  db.setSources([source, noah]);
  const reset = await prepareKnowledgeIndex({ ownerId, sources: [source, noah], admin: db.admin });
  expect(reset).toMatchObject({ modelCalls: 0, extractedThreads: 0, reusedThreads: 2 });
  expect(withoutHash(reset.index.relations)).toEqual(withoutHash(first.index.relations));
  expect(seen).toHaveLength(3);
});

it("keeps two soda preferences when an unrelated source is added", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const agarwal: Source = { ...source, speaker_id: "agarwal", thread_id: "agarwal",
    participant_ids: ["owner", "agarwal"], original_text: "i really love diet coke but I don't like coke zero as much" };
  const alan: Source = { ...source, id: "885edbf2-d497-4f6f-a2cf-342711970005", speaker_id: "alan", thread_id: "alan",
    participant_ids: ["owner", "alan"], original_text: "i love all zero sugar sodas" };
  const unrelated: Source = { ...source, id: "885edbf2-d497-4f6f-a2cf-342711970006", speaker_id: "lee", thread_id: "lee",
    participant_ids: ["owner", "lee"], original_text: "See you at lunch." };
  const agarwalPreference: IndexedRelation = { ...relation, personId: "agarwal", relation: "prefers", evidenceLevel: "exact_title",
    itemMention: "diet coke", sentiment: "positive", sourceIds: [agarwal.id], itemCategory: "soda" };
  const alanPreference: IndexedRelation = { ...relation, personId: "alan", relation: "prefers", evidenceLevel: "category",
    itemMention: "zero sugar sodas", sentiment: "positive", sourceIds: [alan.id], itemCategory: "soda" };
  const db = fakeAdmin([agarwal, alan]);
  const calls: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const text = JSON.parse(String(init.body)).messages[1].content as string;
    const ids = [agarwal.id, alan.id, unrelated.id].filter((id) => text.includes(id));
    calls.push(ids);
    const relations = [agarwalPreference, alanPreference].filter((item) => ids.includes(item.sourceIds[0]));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations }) } }] }) };
  }));
  const first = await prepareKnowledgeIndex({ ownerId, sources: [agarwal, alan], admin: db.admin });
  expect(first).toMatchObject({ modelCalls: 2, extractedThreads: 2 });
  db.setSources([agarwal, alan, unrelated]);
  const next = await prepareKnowledgeIndex({ ownerId, sources: [agarwal, alan, unrelated], admin: db.admin });
  expect(next).toMatchObject({ modelCalls: 1, reusedThreads: 2, extractedThreads: 1 });
  expect(calls.at(-1)).toEqual([unrelated.id]);
  expect(withoutHash(next.index.relations)).toEqual([agarwalPreference, alanPreference]);
  expect(await loadCurrentIndex({ ownerId, sources: [agarwal, alan, unrelated], admin: db.admin })).not.toBeNull();
});

it("gives each thread of a small context its own call", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const threads = ["a", "b", "c"].map((thread, index) => ({ ...source, id: `885edbf2-d497-4f6f-a2cf-3427119701${index}0`, thread_id: thread }));
  const db = fakeAdmin(threads);
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(threads.filter((item) => String(JSON.parse(String(init.body)).messages[1].content).includes(item.id)).map((item) => item.thread_id).join(","));
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [] }) } }] }) };
  }));
  const prepared = await prepareKnowledgeIndex({ ownerId, sources: threads, admin: db.admin });
  expect(prepared.modelCalls).toBe(3);
  expect(calls.sort()).toEqual(["a", "b", "c"]);
});

it("re-reads a thread whose text changed, and reads memory with low effort unless configured", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const db = fakeAdmin([source]);
  const efforts: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    efforts.push(JSON.parse(String(init.body)).reasoning_effort);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ relations: [relation] }) } }] }) };
  }));
  await prepareKnowledgeIndex({ ownerId, sources: [source], admin: db.admin });
  const edited = { ...source, original_text: "If you spot an X100V, send me a picture. Still looking!" };
  db.setSources([edited]);
  process.env.MEMORY_REASONING_EFFORT = "medium";
  const again = await prepareKnowledgeIndex({ ownerId, sources: [edited], admin: db.admin });
  delete process.env.MEMORY_REASONING_EFFORT;
  expect(again).toMatchObject({ modelCalls: 1, reusedThreads: 0, extractedThreads: 1 });
  expect(efforts).toEqual(["low", "medium"]);
});
