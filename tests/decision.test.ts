import { describe, expect, it } from "vitest";
import { caveatMessage, connectionReason, decide, ruledOutMessage, sameMention, type ExtractedRelation, type Identification, type Source } from "../src/lib/decision";

const id = (n: number) => `885edbf2-d497-4f6f-a2cf-3427119700${String(n).padStart(2, "0")}`;
const src = (n: number, speaker: string, text: string, at: string | null, participants = ["owner", speaker]): Source => ({ id: id(n), speaker_id: speaker, thread_id: `t-${participants.filter((p) => p !== "owner").join("-")}`, participant_ids: participants, original_text: text, source_at: at, is_synthetic: true });
const rel = (personId: string, relation: ExtractedRelation["relation"], sourceNumbers: number[], extra: Partial<ExtractedRelation> = {}): ExtractedRelation => ({ personId, subject: "person", relation, evidenceLevel: "exact_title", sentiment: "none", itemMention: "X100V", sourceIds: sourceNumbers.map(id), reason: `${personId} ${relation}.`, ...extra });
const camera: Identification = { item: "Fujifilm X100V", category: "camera", specificity: "exact_title", visibleText: ["X100V"], searchTerms: ["X100V", "the Fuji"], ambiguity: "" };
const record: Identification = { item: "Frank Ocean - Blonde (vinyl)", category: "vinyl record", specificity: "exact_title", visibleText: ["BLONDE"], searchTerms: ["Blonde", "Frank Ocean"], ambiguity: "" };

// The four-message camera case from the demo spec.
const fourSources = [
  src(1, "maya", "If you spot an X100V, send me a picture. I'm still looking for one.", "2026-09-20T15:00:00Z"),
  src(2, "priya", "I hated the X100V; I returned mine.", "2026-09-21T15:00:00Z"),
  src(3, "noah", "I bought an X100V yesterday.", "2026-09-22T15:00:00Z"),
  src(4, "jordan", "My sister wants an X100V.", "2026-09-23T15:00:00Z"),
];
const fourRelations = [rel("maya", "asked_to_find", [1]), rel("priya", "dislikes", [2]), rel("noah", "owns", [3]), rel("jordan", "wanted", [4], { subject: "third_party" })];

describe("decide", () => {
  it("keeps a named soda preference unconfirmed on a generic shelf, with its cited evidence", () => {
    const shelf: Identification = { item: "soda bottles", category: "soda", specificity: "category", visibleText: [], searchTerms: ["Diet Coke", "zero sugar soda"], ambiguity: "The labels are not readable" };
    const sources = [src(1, "agarwal", "i really love diet coke but I don't like coke zero as much", "2026-09-25T00:00:00Z")];
    const decision = decide({ identification: shelf, relations: [rel("agarwal", "prefers", [1], { itemMention: "diet coke", evidenceLevel: "product_family", sentiment: "positive" })], sources, ownerIds: [] });
    expect(decision.status).toBe("needs_clarification");
    expect(decision.connection).toBeNull();
    expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "agarwal", code: "needs_exact", mention: "diet coke", sourceIds: [id(1)] })]);
  });

  it("keeps that unconfirmed preference visible when another person's related soda taste is added", () => {
    const shelf: Identification = { item: "regular Coca-Cola and Pepsi cans", category: "soda", specificity: "product_family", visibleText: ["Coca-Cola", "Pepsi"], searchTerms: ["soda"], ambiguity: "Other labels are unclear", visibleItems: [{ name: "Coca-Cola", category: "soda" }, { name: "Pepsi", category: "soda" }] };
    const sources = [
      src(1, "agarwal", "i really love diet coke but I don't like coke zero as much", "2026-09-25T00:00:00Z"),
      src(2, "alan", "i love all zero sugar sodas", "2026-09-26T00:00:00Z"),
    ];
    const decision = decide({ identification: shelf, relations: [
      rel("agarwal", "prefers", [1], { itemMention: "diet coke", evidenceLevel: "product_family", sentiment: "positive" }),
      rel("alan", "prefers", [2], { itemMention: "zero sugar sodas", evidenceLevel: "category", sentiment: "positive" }),
    ], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "alan", relation: "prefers", preferenceMatch: "related", sourceIds: [id(2)] });
    expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "agarwal", code: "needs_exact", mention: "diet coke", sourceIds: [id(1)] })]);
  });

  it("matches a named preference only when that product is explicitly observed", () => {
    const shelf: Identification = { item: "soda shelf", category: "soda", specificity: "category", visibleText: [], searchTerms: ["soda"], ambiguity: "", visibleItems: [{ name: "Diet Coke", category: "soda" }, { name: "Pepsi", category: "soda" }] };
    const sources = [src(1, "agarwal", "i really love diet coke but I don't like coke zero as much", "2026-09-25T00:00:00Z")];
    const decision = decide({ identification: shelf, relations: [rel("agarwal", "prefers", [1], { itemMention: "diet coke", evidenceLevel: "exact_title", sentiment: "positive" })], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "agarwal", preferenceMatch: "observed", mention: "diet coke" });
  });

  it("prefers a confirmed named taste over a newer related taste on the same shelf", () => {
    const shelf: Identification = { item: "Pepsi", title: "Pepsi", category: "soda", specificity: "exact_title", visibleText: ["Pepsi"], searchTerms: ["soda"], ambiguity: "", visibleItems: [{ name: "Pepsi", category: "soda" }, { name: "Diet Coke", category: "soda" }] };
    const sources = [src(1, "agarwal", "i really love diet coke", "2026-09-25T00:00:00Z"), src(2, "alan", "i love all zero sugar sodas", "2026-09-26T00:00:00Z")];
    const decision = decide({ identification: shelf, relations: [
      rel("agarwal", "prefers", [1], { itemMention: "diet coke", evidenceLevel: "exact_title", sentiment: "positive" }),
      rel("alan", "prefers", [2], { itemMention: "zero sugar sodas", evidenceLevel: "category", sentiment: "positive" }),
    ], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "agarwal", preferenceMatch: "observed" });
  });

  it("uses a confirmed secondary shelf item for an exact request", () => {
    const shelf: Identification = { item: "Pepsi", title: "Pepsi", category: "soda", specificity: "exact_title", visibleText: ["Pepsi"], searchTerms: ["soda"], ambiguity: "", visibleItems: [{ name: "Pepsi", category: "soda" }, { name: "Diet Coke", category: "soda" }] };
    const sources = [src(1, "agarwal", "I want Diet Coke", "2026-09-25T00:00:00Z")];
    const decision = decide({ identification: shelf, relations: [rel("agarwal", "wanted", [1], { itemMention: "Diet Coke", evidenceLevel: "exact_title" })], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "agarwal", relation: "wanted" });
  });

  it("does not let a primary inventory name erase its confirmed edition", () => {
    const edition: Identification = { item: "Wingspan 2nd Edition", title: "Wingspan", edition: "2nd Edition", category: "board game", specificity: "exact_title", visibleText: ["Wingspan", "2nd Edition"], searchTerms: ["Wingspan"], ambiguity: "", visibleItems: [{ name: "Wingspan", category: "board game" }] };
    const sources = [src(1, "maya", "I want Wingspan", "2026-09-25T00:00:00Z"), src(2, "sam", "I want Wingspan 2nd Edition", "2026-09-25T01:00:00Z")];
    const decision = decide({ identification: edition, relations: [
      rel("maya", "wanted", [1], { itemMention: "Wingspan" }),
      rel("sam", "wanted", [2], { itemMention: "Wingspan 2nd Edition" }),
    ], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("sam");
    expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "maya", code: "different_item" })]);
    const taste = decide({ identification: edition, relations: [rel("maya", "prefers", [1], { itemMention: "Wingspan", sentiment: "positive" })], sources, ownerIds: [] });
    expect(taste.status).toBe("needs_clarification");
    expect(taste.ruledOut).toEqual([expect.objectContaining({ personId: "maya", code: "needs_exact" })]);
  });

  it("returns a group when equally strong friends share the same conversation", () => {
    const participants = ["owner", "maya", "noah"];
    const sources = [
      src(1, "maya", "Remember when we played Wingspan together?", "2026-01-01T00:00:00Z", participants),
      src(2, "noah", "Remember when we had Wingspan night? It was the best", "2026-01-01T00:01:00Z", participants),
    ];
    const identification: Identification = { item: "Wingspan", category: "board game", specificity: "exact_title", visibleText: ["Wingspan"], searchTerms: ["Wingspan"], ambiguity: "" };
    const relations = [rel("maya", "experienced_together", [1], { itemMention: "Wingspan" }), rel("noah", "experienced_together", [2], { itemMention: "Wingspan" })];
    const decision = decide({ identification, relations, sources, ownerIds: [] });
    expect(decision.connections.map((item) => item.personId)).toEqual(["noah", "maya"]);
    expect(decision.ruledOut).toEqual([]);
  });
  it("keeps multiple relations from one person as one connection", () => {
    const sources = [
      src(1, "maya", "We should play Wingspan together", "2026-01-01T00:00:00Z"),
      src(2, "maya", "Still want our Wingspan night", "2026-02-01T00:00:00Z"),
    ];
    const identification: Identification = { item: "Wingspan", category: "board game", specificity: "exact_title", visibleText: ["Wingspan"], searchTerms: ["Wingspan"], ambiguity: "" };
    const relations = [rel("maya", "planned_together", [1], { itemMention: "Wingspan" }), rel("maya", "planned_together", [2], { itemMention: "Wingspan" })];
    const decision = decide({ identification, relations, sources, ownerIds: [] });
    expect(decision.connections.map((item) => item.personId)).toEqual(["maya"]);
  });
  it("constructs explanations from verified relation fields", () => {
    expect(connectionReason("maya-chen", "asked_to_find")).toBe("Maya Chen asked you to look out for one.");
  });

  it("routes the four-message camera to the one person with an active request", () => {
    const decision = decide({ identification: camera, relations: fourRelations, sources: fourSources, ownerIds: ["owner-uuid"] });
    expect(decision.status).toBe("matched");
    expect(decision.connection).toMatchObject({ personId: "maya", sourceIds: [id(1)], caveats: [] });
    expect(Object.fromEntries(decision.ruledOut.map((item) => [item.personId, item.code]))).toEqual({ priya: "dislikes", noah: "owns", jordan: "third_party" });
    expect(decision.mentionCount).toBe(4);
    expect(decision.peopleCount).toBe(4);
  });

  it("changes the answer when newer context says the person bought this model, and shows that message", () => {
    const sources = [...fourSources, src(5, "maya", "Update: I bought the X100V last week!", "2026-09-26T15:00:00Z")];
    const decision = decide({ identification: camera, relations: [...fourRelations, rel("maya", "owns", [5])], sources, ownerIds: [] });
    expect(decision.status).toBe("no_match");
    const maya = decision.ruledOut.find((item) => item.personId === "maya")!;
    expect(maya).toMatchObject({ code: "superseded", sourceIds: [id(1)], contradiction: { relation: "owns", sourceIds: [id(5)] } });
    expect(ruledOutMessage(maya)).toBe("Ruled out Maya: a newer message says they already have one.");
  });

  it("keeps an older purchase from cancelling a newer wish", () => {
    const sources = [src(1, "maya", "Got an X100V", "2026-01-01T00:00:00Z"), src(2, "maya", "Sold mine, want an X100V again", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "owns", [1]), rel("maya", "wanted", [2])], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "maya", caveats: [] });
  });

  it("does not let ownership fulfil a plan to use the thing together", () => {
    const sources = [src(1, "owner", "we should listen to Blonde on vinyl together", "2025-10-01T00:00:00Z", ["owner", "maya"]), src(2, "maya", "yes!! deal", "2025-10-01T00:01:00Z"), src(3, "maya", "I bought Blonde on vinyl", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: record, relations: [rel("maya", "planned_together", [1, 2], { itemMention: "Blonde" }), rel("maya", "owns", [3], { itemMention: "Blonde" })], sources, ownerIds: [] });
    expect(decision.status).toBe("matched");
    expect(decision.connection).toMatchObject({ relation: "planned_together", caveats: [] });
  });

  it("lets a newer cancellation of the same plan end it", () => {
    const sources = [src(1, "maya", "let's listen to Blonde together", "2026-01-01T00:00:00Z"), src(2, "maya", "let's skip the Blonde listening night", "2026-02-01T00:00:00Z")];
    const decision = decide({ identification: record, relations: [rel("maya", "planned_together", [1], { itemMention: "Blonde" }), rel("maya", "cancelled", [2], { itemMention: "Blonde" })], sources, ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.ruledOut[0]).toMatchObject({ code: "superseded", contradiction: { relation: "cancelled", sourceIds: [id(2)] } });
  });

  it("asks for clarification when the photo cannot confirm the exact edition a message names", () => {
    const decision = decide({ identification: { ...camera, item: "Fujifilm X100-series camera", specificity: "product_family", ambiguity: "X100V or X100VI" }, relations: fourRelations, sources: fourSources, ownerIds: [] });
    expect(decision.status).toBe("needs_clarification");
    expect(decision.connection).toBeNull();
    expect(decision.clarification).toMatch(/scan again/);
  });

  it("rules out a wish for a different edition than the one in the photo", () => {
    const sources = [src(1, "maya", "I really want the X100VI", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1], { itemMention: "X100VI" })], sources, ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(ruledOutMessage(decision.ruledOut[0])).toBe("Ruled out Maya: mentions “X100VI”, not this one.");
  });

  it("matches family-level evidence when the photo is at least that specific", () => {
    const sources = [src(1, "sam", "I really want a Fuji X100 at some point", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("sam", "wanted", [1], { evidenceLevel: "product_family", itemMention: "Fuji X100" })], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("sam");
  });

  it("does not surface a generic interest", () => {
    const sources = [src(1, "sam", "I love cameras", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("sam", "wanted", [1], { evidenceLevel: "category", itemMention: "cameras" })], sources, ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.ruledOut[0].code).toBe("general_interest");
  });

  it("surfaces an explicit category-level need without pretending it names a specific model", () => {
    const sources = [src(1, "allah", "i kinda need a webcam for my twitch streams", "2026-09-26T00:00:00Z")];
    const webcam: Identification = { item: "Imaging Edge Webcam", title: "Imaging Edge Webcam", category: "webcam software", specificity: "exact_title", visibleText: ["Imaging Edge Webcam"], searchTerms: ["webcam", "webcam software"], ambiguity: "" };
    const decision = decide({ identification: webcam, relations: [rel("allah", "wanted", [1], { evidenceLevel: "category", itemMention: "webcam" })], sources, ownerIds: [] });
    expect(decision.status).toBe("matched");
    expect(decision.connection).toMatchObject({ personId: "allah", relation: "wanted", evidenceLevel: "category", mention: "webcam" });
  });

  it("allows category-level links that are not wants or requests", () => {
    const sources = [src(1, "sam", "I recommend webcams for remote workshops", "2026-09-26T00:00:00Z")];
    const webcam: Identification = { item: "USB webcam", category: "webcam", specificity: "category", visibleText: [], searchTerms: ["webcam"], ambiguity: "" };
    const decision = decide({ identification: webcam, relations: [rel("sam", "recommended", [1], { evidenceLevel: "category", itemMention: "webcams" })], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "sam", relation: "recommended" });
  });

  it("rules out an item name that is not in the cited messages", () => {
    const sources = [src(1, "maya", "send me a pic if you see one of those Fuji cameras", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "asked_to_find", [1], { itemMention: "X100V" })], sources, ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.ruledOut[0].code).toBe("unverified_item");
  });

  it("drops citations outside the corpus, unknown people, and the owner", () => {
    const relations = [rel("maya", "wanted", [99]), rel("stranger", "wanted", [1]), rel("owner", "wanted", [1]), rel("owner-uuid", "wanted", [1])];
    const decision = decide({ identification: camera, relations, sources: fourSources, ownerIds: ["owner-uuid"] });
    expect(decision.status).toBe("no_match");
    expect(decision.droppedCount).toBe(4);
    expect(decision.mentionCount).toBe(0);
  });

  it("rejects a wish attributed to someone who did not say it", () => {
    const sources = [src(1, "priya", "Maya wants an X100V", "2026-09-01T00:00:00Z", ["owner", "priya", "maya"])];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1])], sources, ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.ruledOut[0].code).toBe("misattributed");
  });

  it("ranks an open shared plan over a newer recommendation, and reports the weaker one", () => {
    const sources = [src(1, "maya", "we should listen to Blonde together", "2026-01-01T00:00:00Z"), src(2, "sam", "you have to hear Blonde", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: record, relations: [rel("sam", "recommended", [2], { itemMention: "Blonde" }), rel("maya", "planned_together", [1], { itemMention: "Blonde" })], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("maya");
    expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "sam", code: "weaker" })]);
  });

  it("breaks ties within a tier by recency", () => {
    const sources = [src(1, "maya", "want an X100V", "2026-01-01T00:00:00Z"), src(2, "sam", "want an X100V", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1]), rel("sam", "wanted", [2])], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("sam");
  });

  it("returns no_match when nothing refers to the item", () => {
    const decision = decide({ identification: { ...camera, item: "Swingline stapler", category: "stapler" }, relations: [], sources: fourSources, ownerIds: [] });
    expect(decision).toMatchObject({ status: "no_match", connection: null, ruledOut: [], mentionCount: 0 });
  });
});

describe("supersession regressions", () => {
  it("does not let a family-level purchase cancel an exact-model wish, and shows it as a caveat", () => {
    const sources = [src(1, "maya", "If you spot an X100V, send me a picture.", "2026-09-20T15:00:00Z"), src(2, "maya", "I bought a Fuji X100-series camera!", "2026-09-26T15:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "asked_to_find", [1]), rel("maya", "owns", [2], { evidenceLevel: "product_family", itemMention: "Fuji X100-series camera" })], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("maya");
    expect(decision.connection?.caveats).toEqual([expect.objectContaining({ relation: "owns", reason: "item_unconfirmed", sourceIds: [id(2)] })]);
    expect(caveatMessage("maya", decision.connection!.caveats[0])).toBe("Maya also mentioned having “Fuji X100-series camera”. It isn't clear that's this exact item.");
  });

  it("does not let an ownership relation citing someone else's purchase cancel a wish", () => {
    const decision = decide({ identification: camera, relations: [rel("maya", "asked_to_find", [1]), rel("maya", "owns", [3])], sources: fourSources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "maya", caveats: [] });
  });

  it("does not invent chronology when both dates are unknown", () => {
    const sources = [src(1, "maya", "I want an X100V", null), src(2, "maya", "I have an X100V", null)];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1]), rel("maya", "owns", [2])], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("maya");
    expect(decision.connection?.caveats).toEqual([expect.objectContaining({ reason: "order_unknown" })]);
  });

  it("does not treat identical timestamps as an order", () => {
    const sources = [src(1, "maya", "I want an X100V", "2026-09-01T00:00:00Z"), src(2, "maya", "I have an X100V", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1]), rel("maya", "owns", [2])], sources, ownerIds: [] });
    expect(decision.connection?.caveats[0]?.reason).toBe("order_unknown");
  });

  it("ignores a newer purchase of a different exact model", () => {
    const sources = [src(1, "maya", "I want an X100V", "2026-09-01T00:00:00Z"), src(2, "maya", "Ended up buying the X100VI", "2026-09-10T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1]), rel("maya", "owns", [2], { itemMention: "X100VI" })], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "maya", caveats: [] });
  });

  it("treats buying a gift as unconfirmed, not as the recipient owning it", () => {
    const sources = [src(1, "maya", "I want an X100V", "2026-09-01T00:00:00Z"), src(2, "priya", "I got Maya an X100V for her birthday", "2026-09-10T00:00:00Z", ["owner", "priya"])];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1]), rel("maya", "purchased_as_gift", [2])], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("maya");
    expect(decision.connection?.caveats).toEqual([expect.objectContaining({ relation: "purchased_as_gift", reason: "gift_not_confirmed" })]);
  });

  it("ranks a clean candidate above one with an unresolved caveat in the same tier", () => {
    const sources = [src(1, "maya", "I want an X100V", "2026-09-05T00:00:00Z"), src(2, "maya", "I have an X100V", null), src(3, "sam", "I want an X100V", "2026-09-01T00:00:00Z")];
    const decision = decide({ identification: camera, relations: [rel("maya", "wanted", [1]), rel("maya", "owns", [2]), rel("sam", "wanted", [3])], sources, ownerIds: [] });
    expect(decision.connection?.personId).toBe("sam");
  });
});

describe("sameMention", () => {
  it.each([["X100V", "Fujifilm X100V", true], ["Fuji X100V", "Fujifilm X100V", true], ["X100V", "X100VI", false], ["Fuji X100-series camera", "X100V", false], ["Blonde", "Blonde on vinyl", true], ["Blonde", "Channel Orange", false], ["the", "X100V", false], ["X100 V", "X100V", true], ["PS 5", "PS5", true], ["X100", "X100V", false], ["iPhone 15", "iPhone 15 Pro", true], ["iPhone 15", "iPhone 14", false]])("%s vs %s → %s", (a, b, expected) => {
    expect(sameMention(a, b)).toBe(expected);
  });
});

describe("advice contacts (shopping) are a separate action from reconnecting", () => {
  const sources = [
    src(1, "noah", "Bought an X100V, love it", "2026-09-10T00:00:00Z"),
    src(2, "priya", "Returned my X100V, hated it", "2026-09-11T00:00:00Z"),
    src(3, "sam", "Noah has an X100V I think", "2026-09-12T00:00:00Z", ["owner", "sam", "noah"]),
    src(4, "leo", "Got the X100VI last week", "2026-09-13T00:00:00Z"),
    src(5, "maya", "You have to get the X100V", "2026-09-14T00:00:00Z"),
    src(6, "jordan", "My brother owns an X100V", "2026-09-15T00:00:00Z"),
  ];

  it("keeps an owner as an advice contact without treating ownership as praise", () => {
    const decision = decide({ identification: camera, relations: [rel("noah", "owns", [1])], sources, ownerIds: [] });
    expect(decision.advice).toEqual([expect.objectContaining({ personId: "noah", basis: "owns", favorable: false, caution: false })]);
    expect(decision.connection).toBeNull();
  });

  it("connects to an owner only when their cited words show a positive experience", () => {
    const decision = decide({ identification: camera, relations: [rel("noah", "owns", [1], { sentiment: "positive" })], sources, ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "noah", relation: "owns", sourceIds: [id(1)], reason: "Noah said they own one and like it." });
    expect(decision.advice).toEqual([expect.objectContaining({ personId: "noah", basis: "owns", favorable: true, sourceIds: [id(1)] })]);
  });

  it("does not accept a positive sentiment label when the owner's cited words are neutral", () => {
    const neutral = src(7, "noah", "I bought an X100V last month.", "2026-09-16T00:00:00Z");
    const decision = decide({ identification: camera, relations: [rel("noah", "owns", [7], { sentiment: "positive" })], sources: [neutral], ownerIds: [] });
    expect(decision.connection).toBeNull();
    expect(decision.advice).toEqual([expect.objectContaining({ personId: "noah", favorable: false, sourceIds: [id(7)] })]);
  });

  it("does not treat negated praise as favorable ownership", () => {
    const negative = src(7, "noah", "I have an X100V, but I don't like it.", "2026-09-16T00:00:00Z");
    const decision = decide({ identification: camera, relations: [rel("noah", "owns", [7], { sentiment: "positive" })], sources: [negative], ownerIds: [] });
    expect(decision.connection).toBeNull();
    expect(decision.advice).toEqual([expect.objectContaining({ personId: "noah", favorable: false, sourceIds: [id(7)] })]);
  });

  it("lets a later exact-item dislike supersede ownership praise and control advice", () => {
    const dislike = src(7, "noah", "I tried the X100V again and I hate it now.", "2026-09-20T00:00:00Z");
    const decision = decide({ identification: camera, relations: [
      rel("noah", "owns", [1], { sentiment: "positive" }),
      rel("noah", "dislikes", [7], { sentiment: "negative" }),
    ], sources: [...sources, dislike], ownerIds: [] });
    expect(decision.connection).toBeNull();
    expect(decision.ruledOut).toEqual([expect.objectContaining({ personId: "noah", code: "superseded", contradiction: expect.objectContaining({ relation: "dislikes", sourceIds: [id(7)] }) })]);
    expect(decision.advice).toEqual([expect.objectContaining({ personId: "noah", basis: "dislikes", favorable: false, caution: true, sourceIds: [id(7)] })]);
  });

  it("marks favorable only from the person's own positive words or a recommendation, and a dislike as a caution", () => {
    const decision = decide({ identification: camera, relations: [rel("noah", "owns", [1], { sentiment: "positive" }), rel("priya", "dislikes", [2], { sentiment: "negative" }), rel("maya", "recommended", [5])], sources, ownerIds: [] });
    // Maya's recommendation makes her the reconnect match, so she isn't repeated as someone to ask.
    expect(decision.connection).toMatchObject({ personId: "maya", relation: "recommended" });
    expect(decision.advice.map((item) => [item.personId, item.favorable, item.caution])).toEqual([["noah", true, false], ["priya", false, true]]);
    expect(decide({ identification: camera, relations: [rel("maya", "recommended", [5])], sources, ownerIds: [] }).advice).toEqual([]);
  });

  it("excludes someone else's report, a different model, and a third party", () => {
    const decision = decide({ identification: camera, relations: [rel("noah", "owns", [3], { sentiment: "positive" }), rel("leo", "owns", [4], { itemMention: "X100VI" }), rel("jordan", "owns", [6], { subject: "third_party" })], sources, ownerIds: [] });
    expect(decision.advice).toEqual([]);
  });

  it("lets favorable ownership take over an earlier wish and keeps its cited opinion for advice", () => {
    const wish = src(7, "noah", "I want an X100V", "2026-09-01T00:00:00Z");
    const decision = decide({ identification: camera, relations: [rel("noah", "wanted", [7]), rel("noah", "owns", [1], { sentiment: "positive" })], sources: [...sources, wish], ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "noah", relation: "owns", sourceIds: [id(1)] });
    expect(decision.advice[0]).toMatchObject({ personId: "noah", favorable: true, sourceIds: [id(1)] });
  });
});

describe("shared relations must involve the user", () => {
  const noahSays = src(1, "noah", "Finally got Wingspan last month. Honestly love it, we play every Sunday now.", "2026-09-15T00:00:00Z");
  const mayaSays = src(2, "maya", "We should try Wingspan together sometime.", "2026-09-10T00:00:00Z");
  const memory = src(3, "leo", "Remember when we played Wingspan all night?", "2026-09-01T00:00:00Z");
  const game: Identification = { item: "Wingspan", category: "board game", specificity: "exact_title", visibleText: ["WINGSPAN"], searchTerms: ["Wingspan"], ambiguity: "" };

  it("drops a 'we' about someone's own household while allowing their positive ownership to connect", () => {
    const decision = decide({ identification: game, relations: [rel("noah", "experienced_together", [1], { itemMention: "Wingspan" }), rel("noah", "owns", [1], { itemMention: "Wingspan", sentiment: "positive" })], sources: [noahSays], ownerIds: [] });
    expect(decision.connection).toMatchObject({ personId: "noah", relation: "owns", sourceIds: [id(1)] });
    expect(decision.connections.map((item) => item.relation)).toEqual(["owns"]);
  });

  it.each([
    "My wife and I play Wingspan together every Sunday.",
    "My roommates love Wingspan. It's a weekly ritual for us.",
    "I remember playing Wingspan with my brother as a kid.",
  ])("does not infer user participation from household wording: %s", (text) => {
    const statement = src(1, "noah", text, "2026-09-15T00:00:00Z");
    const decision = decide({ identification: game, relations: [rel("noah", "experienced_together", [1], { itemMention: "Wingspan" })], sources: [statement], ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.connection).toBeNull();
  });

  it("keeps a plan that addresses the user, and a shared memory that says 'remember when we'", () => {
    expect(decide({ identification: game, relations: [rel("maya", "planned_together", [2], { itemMention: "Wingspan" })], sources: [mayaSays], ownerIds: [] }).connection?.personId).toBe("maya");
    expect(decide({ identification: game, relations: [rel("leo", "experienced_together", [3], { itemMention: "Wingspan" })], sources: [memory], ownerIds: [] }).connection?.personId).toBe("leo");
  });

  it("keeps a plan the user proposed and the person accepted", () => {
    const sources = [src(4, "owner", "we should play Wingspan", "2026-09-01T00:00:00Z", ["owner", "sam"]), src(5, "sam", "yes!!", "2026-09-01T00:01:00Z", ["owner", "sam"])];
    expect(decide({ identification: game, relations: [rel("sam", "planned_together", [4, 5], { itemMention: "Wingspan" })], sources, ownerIds: [] }).connection?.personId).toBe("sam");
  });

  it("with Maya's plan cancelled, Noah's household 'we' does not become the match", () => {
    const cancel = src(6, "maya", "Let's skip the Wingspan plan, not really my thing after all.", "2026-09-26T00:00:00Z");
    const decision = decide({ identification: game, relations: [rel("maya", "planned_together", [2], { itemMention: "Wingspan" }), rel("maya", "cancelled", [6], { itemMention: "Wingspan" }), rel("noah", "experienced_together", [1], { itemMention: "Wingspan" }), rel("noah", "owns", [1], { itemMention: "Wingspan" })], sources: [mayaSays, cancel, noahSays], ownerIds: [] });
    expect(decision.status).toBe("no_match");
  });
});

describe("evidence that names the photo's exact title is exact, whatever the model labeled it", () => {
  const game: Identification = { item: "Wingspan", title: "Wingspan", category: "board game", specificity: "exact_title", visibleText: ["WINGSPAN"], searchTerms: ["Wingspan"], ambiguity: "" };
  const noahSays = src(1, "noah", "Finally got Wingspan last month.", "2026-09-15T00:00:00Z");
  const mayaSays = src(2, "maya", "We should try Wingspan together sometime.", "2026-09-10T00:00:00Z");
  const samSays = src(3, "sam", "I'm into board games in general.", "2026-09-10T00:00:00Z");

  it("keeps an owner mislabeled as category evidence as someone to ask", () => {
    const decision = decide({ identification: game, relations: [rel("noah", "owns", [1], { itemMention: "Wingspan", evidenceLevel: "category" })], sources: [noahSays], ownerIds: [] });
    expect(decision.advice).toEqual([expect.objectContaining({ personId: "noah", basis: "owns" })]);
  });

  it("still matches the hero plan if its title was mislabeled as category evidence", () => {
    const decision = decide({ identification: game, relations: [rel("maya", "planned_together", [2], { itemMention: "Wingspan", evidenceLevel: "category" })], sources: [mayaSays], ownerIds: [] });
    expect(decision.connection?.personId).toBe("maya");
  });

  it("never upgrades genuinely generic or brand-only words", () => {
    const generic = decide({ identification: game, relations: [rel("sam", "wanted", [3], { itemMention: "board games", evidenceLevel: "category" })], sources: [samSays], ownerIds: [] });
    expect(generic.ruledOut[0]?.code).toBe("general_interest");
    const camera: Identification = { item: "Fujifilm X100V", title: "Fujifilm X100V", category: "camera", specificity: "exact_title", visibleText: [], searchTerms: [], ambiguity: "" };
    const brand = decide({ identification: camera, relations: [rel("sam", "wanted", [4], { itemMention: "Fujifilm", evidenceLevel: "category" })], sources: [src(4, "sam", "I want a Fujifilm someday", "2026-09-01T00:00:00Z")], ownerIds: [] });
    expect(brand.status).toBe("no_match");
  });

  it.each(["exact_title", "product_family"] as const)("rejects a distinct explicit title even with a broad item description and %s evidence", (evidenceLevel) => {
    const asia = { ...game, title: "Wingspan Asia", item: "Wingspan board game" };
    const decision = decide({ identification: asia, relations: [
      rel("maya", "planned_together", [2], { itemMention: "Wingspan", evidenceLevel }),
      rel("noah", "owns", [1], { itemMention: "Wingspan", evidenceLevel }),
    ], sources: [mayaSays, noahSays], ownerIds: [] });
    expect(decision.status).toBe("no_match");
    expect(decision.advice).toEqual([]);
  });
});
