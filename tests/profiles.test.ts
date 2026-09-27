// Profiles + classifier: AI-made topics, per-person confidence scores, and the LoCoMo conversion.
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { connectionScore, decide, MATCH_THRESHOLD, type ExtractedRelation, type Identification, type Source } from "../src/lib/decision";
import { memoryTopics, relationsForPhoto, selectByTopic, type KnowledgeIndex } from "../src/lib/knowledge-index";
import { identifyItem } from "../src/lib/meta";
import { consolidate, friendships } from "../scripts/profiles-build";

const id = (n: number) => `7b0c2b3d-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const src = (n: number, speaker: string, thread: string, text: string, at = "2023-09-01T12:00:00Z"): Source =>
  ({ id: id(n), speaker_id: speaker, thread_id: thread, participant_ids: ["owner", thread], original_text: text, source_at: at, is_synthetic: true });
const sources = [
  src(1, "melanie", "melanie", "Pottery's so relaxing and creative. I made this bowl in pottery class yesterday!"),
  src(2, "gina", "gina", "I'm opening my own dance studio this fall, it's my dream.", "2023-07-01T12:00:00Z"),
  src(3, "nate", "nate", "I play video games most nights, it's how I unwind."),
];
const hook = (personId: string, n: number, relation: ExtractedRelation["relation"], itemMention: string, topic: string, strength: number, cues: string[] = []) =>
  ({ personId, subject: "person", relation, evidenceLevel: "category", itemMention, sentiment: "positive", sourceIds: [id(n)], aliases: [], itemCategory: topic, topic, cues, strength });
const index = { relations: [
  hook("melanie", 1, "enjoys", "Pottery", "pottery", 1, ["clay bowl", "pottery wheel"]),
  hook("gina", 2, "pursuing", "dance studio", "dance", 0.9, ["dance shoes", "studio mirror"]),
  hook("nate", 3, "enjoys", "video games", "video games", 0.6, ["game controller"]),
] } as unknown as KnowledgeIndex;
const photo = (topicMatches: { topic: string; confidence: number }[]): Identification =>
  ({ entityKind: "object", item: "handmade ceramic bowl", category: "bowl", specificity: "category", visibleText: [], searchTerms: ["bowl"], ambiguity: "", title: "", edition: "", topicMatches });

afterEach(() => { vi.unstubAllGlobals(); delete process.env.MODEL_API_KEY; });

it("lists the memory's AI-made topics with cues, strongest first, and never people's names", () => {
  const topics = memoryTopics(index);
  expect(topics.map((t) => t.topic)).toEqual(["pottery", "dance", "video games"]);
  expect(topics[0].cues).toEqual(["clay bowl", "pottery wheel"]);
  expect(JSON.stringify(topics)).not.toMatch(/melanie|gina|nate/i);
});

it("scores every friend and picks the most confident, not the first survivor", () => {
  const identification = photo([{ topic: "pottery", confidence: 0.9 }, { topic: "video games", confidence: 0.4 }]);
  const decision = decide({ identification, relations: relationsForPhoto(identification, index), sources, ownerIds: [] });
  expect(decision.connection?.personId).toBe("melanie");
  expect(decision.connection?.reason).toBe("Melanie is into Pottery.");
  expect(decision.ranking.map((r) => r.personId)).toEqual(["melanie", "nate"]);
  expect(decision.ranking[0].score).toBeGreaterThan(decision.ranking[1].score);
  expect(decision.ruledOut.map((r) => [r.personId, r.code])).toEqual([["nate", "weaker"]]);
});

it("abstains when nobody clears the confidence bar, and says why", () => {
  const identification = photo([{ topic: "video games", confidence: 0.4 }]);
  const decision = decide({ identification, relations: relationsForPhoto(identification, index), sources, ownerIds: [] });
  expect(decision.status).toBe("no_match");
  expect(decision.ranking[0].score).toBeLessThan(MATCH_THRESHOLD);
  expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "nate", code: "low_confidence" })]);
});

it("ignores classifier guesses below the minimum confidence", () => {
  expect(selectByTopic(index, [{ topic: "dance", confidence: 0.2 }])).toEqual([]);
  expect(selectByTopic(index, [{ topic: "Dance", confidence: 0.8 }])[0]).toMatchObject({ personId: "gina", matchConfidence: 0.8 });
});

it("combines match quality, kind of reason, importance, recency, and caveats into one 0–1 score", () => {
  const newest = Date.parse("2023-09-01T12:00:00Z");
  const base = { relation: "enjoys" as const, strength: 1, at: newest, caveats: [] };
  expect(connectionScore(base, newest)).toBe(0.8);
  expect(connectionScore({ ...base, matchConfidence: 0.5 }, newest)).toBe(0.4);
  expect(connectionScore({ ...base, at: newest - 365 * 86_400_000 }, newest)).toBeLessThan(0.8);
  expect(connectionScore({ ...base, strength: 0.2 }, newest)).toBeLessThan(connectionScore(base, newest));
  expect(connectionScore({ ...base, caveats: [{}] }, newest)).toBe(0.68);
});

it("sends the vision call topic names and cues only, never messages or names", async () => {
  process.env.MODEL_API_KEY = "test-only";
  let body = "";
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    body = String(init.body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ ...photo([{ topic: "pottery", confidence: 0.9 }]), visibleItems: [] }) } }] }) };
  }));
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c96" } }).png().toBuffer();
  await identifyItem(new File([new Uint8Array(png)], "frame.png", { type: "image/png" }), undefined, memoryTopics(index));
  expect(body).toMatch(/pottery: clay bowl, pottery wheel/);
  expect(body).toMatch(/topicMatches/);
  const request = JSON.parse(body) as { messages: { content: string | { type: string; text?: string }[] }[] };
  const text = request.messages.map((message) => typeof message.content === "string" ? message.content : message.content.filter((part) => part.type === "text").map((part) => part.text).join(" ")).join(" ");
  expect(text).not.toMatch(/Pottery's so relaxing|\bmelanie\b|\bgina\b|\bnate\b/i);
});

it("converts a LoCoMo conversation into one friendship and merges repeated mentions", () => {
  const data = [{ sample_id: "s0", conversation: { speaker_a: "Caroline", speaker_b: "Melanie", session_1_date_time: "1:56 pm on 8 May, 2023",
    session_1: [{ speaker: "Caroline", dia_id: "D1:1", text: "Hi Mel!" }, { speaker: "Melanie", dia_id: "D1:2", text: "I did pottery today.", blip_caption: "a photo of a clay bowl" }] } }];
  const [friend] = friendships(data as never, "11111111-1111-4111-8111-111111111111");
  expect(friend).toMatchObject({ friend: "melanie", name: "Melanie", sessions: 1 });
  expect(friend.batches[0].map((s) => [s.speaker_id, s.original_text, s.source_at])).toEqual([
    ["owner", "Hi Mel!", "2023-05-08T13:56:00.000Z"], ["melanie", "I did pottery today.", "2023-05-08T13:57:00.000Z"]]);
  expect(friend.images).toEqual([expect.objectContaining({ friend: "melanie", caption: "a photo of a clay bowl", speakerIsFriend: true })]);
  const merged = consolidate([
    { ...hook("melanie", 1, "enjoys", "pottery", "Pottery", 0.6, ["kiln"]) } as never,
    { ...hook("melanie", 1, "enjoys", "pottery class", "pottery", 0.7, ["clay bowl"]) } as never,
  ]);
  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({ itemMention: "pottery class", topic: "pottery", strength: 0.75, mentions: 2, cues: ["kiln", "clay bowl"] });
});

it("discounts a topic many friends share, and a generic object's loose match", async () => {
  const { selectByTopic: select } = await import("../src/lib/knowledge-index");
  const shared = { relations: [...index.relations, hook("gina", 2, "enjoys", "dance studio", "pottery", 0.5), hook("nate", 3, "enjoys", "video games", "pottery", 0.5)] } as unknown as KnowledgeIndex;
  // Three friends hold "pottery": 0.9 × 1/(1 + 0.15 × 2)
  expect(select(shared, [{ topic: "pottery", confidence: 0.9 }])[0].matchConfidence).toBe(0.69);
  expect(select(index, [{ topic: "pottery", confidence: 0.9, specific: false }])[0].matchConfidence).toBe(0.45);
});

it("treats a same-category word match as weak evidence for profile memories, but an exact title as certain", async () => {
  const { relationsForPhoto: forPhoto } = await import("../src/lib/knowledge-index");
  const book = { ...hook("melanie", 1, "enjoys", "Pottery", "pottery books", 0.8), itemCategory: "book" };
  const titled = { ...hook("melanie", 1, "recommended", "Pottery", "pottery", 0.8), evidenceLevel: "exact_title", itemCategory: "book" };
  const memory = { relations: [book, titled] } as unknown as KnowledgeIndex;
  const photoOfBook: Identification = { entityKind: "object", item: "Pottery", title: "Pottery", edition: "", category: "book", specificity: "exact_title", visibleText: ["POTTERY"], searchTerms: ["Pottery"], ambiguity: "" };
  const reached = forPhoto(photoOfBook, memory);
  expect(reached.find((r) => r.relation === "recommended")?.matchConfidence).toBeUndefined();
  expect(reached.find((r) => r.relation === "enjoys")?.matchConfidence).toBe(0.5);
});

it("does not turn a book topic into a recommendation for an unidentified exact title", () => {
  const source = src(4, "tim", "tim", "I really recommend War and Peace.");
  const memory = { relations: [{ ...hook("tim", 4, "recommended", "War and Peace", "books", 1),
    evidenceLevel: "exact_title", itemCategory: "book" }] } as unknown as KnowledgeIndex;
  const identification: Identification = { entityKind: "object", item: "unidentified book", category: "book",
    specificity: "category", visibleText: [], searchTerms: ["book"], ambiguity: "", title: "", edition: "",
    topicMatches: [{ topic: "books", confidence: 0.95, specific: true }] };
  const decision = decide({ identification, relations: relationsForPhoto(identification, memory), sources: [source], ownerIds: [] });
  expect(decision.connection).toBeNull();
  expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "tim", code: "needs_exact" })]);
});

it.each(["recommended", "prefers"] as const)("requires a named soda variant for %s even with a topic match, and accepts a confirmed secondary item", (relation) => {
  const source = src(5, "tim", "tim", relation === "recommended" ? "I really recommend Diet Coke." : "I really love Diet Coke.");
  const memory = { relations: [{ ...hook("tim", 5, relation, "Diet Coke", "soda", 1),
    evidenceLevel: "exact_title", itemCategory: "soda" }] } as unknown as KnowledgeIndex;
  const shelf: Identification = { entityKind: "object", item: "mixed soda shelf", category: "soda",
    specificity: "category", visibleText: ["Coke Zero"], searchTerms: ["soda"], ambiguity: "", title: "", edition: "",
    visibleItems: [{ name: "Coke Zero", category: "soda" }],
    topicMatches: [{ topic: "soda", confidence: 0.95, specific: true }] };
  const wrongVariant = decide({ identification: shelf, relations: relationsForPhoto(shelf, memory), sources: [source], ownerIds: [] });
  expect(wrongVariant.connection).toBeNull();

  const withDietCoke = { ...shelf, visibleItems: [...shelf.visibleItems!, { name: "Diet Coke", category: "soda" }] };
  const confirmed = decide({ identification: withDietCoke, relations: relationsForPhoto(withDietCoke, memory), sources: [source], ownerIds: [] });
  expect(confirmed.connection).toMatchObject({ personId: "tim", mention: "Diet Coke" });
});

it("holds back a proposed match the second check rejects, and keeps it when the check can't run", async () => {
  const { verifyDecision } = await import("../src/lib/verify");
  process.env.MODEL_API_KEY = "test-only";
  const identification = photo([{ topic: "pottery", confidence: 0.9 }]);
  const proposed = decide({ identification, relations: relationsForPhoto(identification, index), sources, ownerIds: [] });
  const answer = (value: object) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
  vi.stubGlobal("fetch", vi.fn(async () => answer({ sensible: false, why: "A generic bowl is too loose." })));
  const rejected = await verifyDecision(proposed, identification, sources);
  expect(rejected.decision.status).toBe("no_match");
  expect(rejected.decision.ruledOut[0]).toMatchObject({ personId: "melanie", code: "not_specific" });
  const acceptedFetch = vi.fn<(url: unknown, init?: RequestInit) => Promise<ReturnType<typeof answer>>>().mockImplementation(async () => answer({ sensible: true, why: "Clay bowl, her pottery." }));
  vi.stubGlobal("fetch", acceptedFetch);
  expect((await verifyDecision(proposed, identification, sources, undefined, "fast-verifier-test")).decision.connection?.personId).toBe("melanie");
  expect(JSON.parse(acceptedFetch.mock.calls[0][1]!.body as string).model).toBe("fast-verifier-test");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })));
  const unavailable = await verifyDecision(proposed, identification, sources);
  expect(unavailable.decision.connection?.personId).toBe("melanie");
  expect(unavailable.verification.checked).toBe(false);
});
