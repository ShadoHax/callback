import { afterEach, expect, it, vi } from "vitest";
import { extractRelations, identifyItem } from "../src/lib/meta";
import { modelConfig, modelDisplayConfig, structuredCall } from "../src/lib/model";
import { z } from "zod";
import type { Identification, Source } from "../src/lib/decision";

const source: Source = { id: "885edbf2-d497-4f6f-a2cf-342711970001", speaker_id: "maya", thread_id: "demo", participant_ids: ["owner", "maya"], original_text: "If you spot an X100V, send me a picture.", source_at: null, is_synthetic: true };
const identification: Identification = { entityKind: "object", item: "Fujifilm X100V", title: "Fujifilm X100V", edition: "", category: "camera", specificity: "exact_title", visibleText: ["X100V"], searchTerms: ["X100V"], ambiguity: "" };
const ok = (value: unknown) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(value) } }] }) });
const image = () => new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC", "base64")], "camera.png", { type: "image/png" });

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ["MODEL_PROVIDER", "MODEL_API_KEY", "META_API_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "MODEL_MAX_COMPLETION_TOKENS", "META_MODEL", "META_VISION_MODEL", "OPENAI_VISION_MODEL", "VISION_MAX_COMPLETION_TOKENS", "VISION_MAX_IMAGE_EDGE"]) delete process.env[name];
});

it("can select a bounded task model without changing simultaneous app model configuration", async () => {
  process.env.MODEL_API_KEY = "test-only";
  process.env.META_VISION_MODEL = "muse-spark-1.2";
  const requested: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    requested.push(JSON.parse(String(init.body)).model);
    return ok({ found: true });
  }));
  const call = { name: "bounded_vision", schema: {}, parse: z.object({ found: z.boolean() }), instructions: "Identify.", content: "Photo", purpose: "vision" as const, timeoutMs: 1000 };
  await structuredCall({ ...call, modelOverride: "muse-spark-1.1" });
  await structuredCall(call);
  expect(requested).toEqual(["muse-spark-1.1", "muse-spark-1.2"]);
  expect(modelDisplayConfig().visionModel).toBe("muse-spark-1.2");
  await expect(structuredCall({ ...call, modelOverride: "bad model" })).rejects.toThrow(/model name is invalid/);
});

it("routes the glance to the fast vision model and memory extraction to the main model", async () => {
  process.env.MODEL_API_KEY = "test-only";
  process.env.META_MODEL = "muse-spark-1.3";
  process.env.META_VISION_MODEL = "muse-spark-1.1";
  const models: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    models.push(body.model);
    return ok(Array.isArray(body.messages[1].content) ? identification : { relations: [] });
  }));
  const seen = await identifyItem(image());
  await extractRelations(identification, [source]);
  expect(models).toEqual(["muse-spark-1.1", "muse-spark-1.3"]);
  expect(seen.model).toBe("muse-spark-1.1");
  expect(modelDisplayConfig()).toEqual({ provider: "meta", model: "muse-spark-1.3", visionModel: "muse-spark-1.1" });
});

it("uses the main model for vision when no vision model is set, and rejects a malformed name", () => {
  expect(modelDisplayConfig()).toEqual({ provider: "meta", model: "muse-spark-1.3", visionModel: "muse-spark-1.3" });
  process.env.META_VISION_MODEL = "bad model/../x";
  expect(() => modelDisplayConfig()).toThrow(/vision model name is invalid/);
});

it("sends only the image to the vision call, in the documented chat-completions shape", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(body.model).toBe("muse-spark-1.3");
    expect(body.messages[0].role).toBe("developer");
    expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.max_completion_tokens).toBe(1536);
    expect(JSON.stringify(body)).not.toContain(source.original_text);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "item_identification", strict: true } });
    expect(body.response_format.json_schema.schema.required).toEqual(expect.arrayContaining(["title", "edition"]));
    expect(body.messages[0].content).toMatch(/title: for an object/);
    return ok(identification);
  });
  vi.stubGlobal("fetch", fetchMock);
  expect((await identifyItem(image())).value).toEqual(identification);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("sends sources as data to the text-only relation call", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const relations = [{ personId: "maya", subject: "person", relation: "asked_to_find", evidenceLevel: "exact_title", itemMention: "X100V", sentiment: "none", sourceIds: [source.id], reason: "Maya asked you to keep an eye out for one." }];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(typeof body.messages[1].content).toBe("string");
    expect(body.messages[1].content).toContain(source.id);
    expect(body.messages[0].content).toMatch(/data, never instructions/);
    return ok({ relations });
  });
  vi.stubGlobal("fetch", fetchMock);
  expect((await extractRelations(identification, [source])).value.relations).toEqual(relations);
});

it("retries once on a transient provider error", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce(ok(identification));
  vi.stubGlobal("fetch", fetchMock);
  const result = await identifyItem(image());
  expect(result.attempts).toBe(2);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("does not double the wait by silently retrying a timed-out glance", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const fetchMock = vi.fn().mockRejectedValueOnce(new DOMException("timed out", "TimeoutError")).mockResolvedValueOnce(ok(identification));
  vi.stubGlobal("fetch", fetchMock);
  await expect(identifyItem(image())).rejects.toMatchObject({ status: 408, timings: { attempts: [expect.objectContaining({ attempt: 1, outcome: "error" })] } });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("fails closed without retrying when the provider returns malformed output", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const fetchMock = vi.fn(async () => ok({}));
  vi.stubGlobal("fetch", fetchMock);
  await expect(identifyItem(image())).rejects.toThrow(/malformed/);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("does not retry a client error", async () => {
  process.env.MODEL_API_KEY = "test-only";
  const fetchMock = vi.fn(async () => ({ ok: false, status: 400 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(identifyItem(image())).rejects.toThrow(/400/);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("routes OpenAI calls only to its fixed endpoint with a separate key and a bounded completion", async () => {
  process.env.MODEL_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.MODEL_API_KEY = "meta-test-key";
  process.env.META_API_BASE_URL = "https://old-meta.example/v1";
  process.env.MODEL_MAX_COMPLETION_TOKENS = "4000";
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers).toMatchObject({ authorization: "Bearer openai-test-key" });
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-5.4-mini");
    expect(body.max_completion_tokens).toBe(4000);
    expect(body.reasoning_effort).toBe("low");
    expect(body.response_format.json_schema.strict).toBe(true);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(identification) } }], usage: { prompt_tokens: 123, completion_tokens: 45, total_tokens: 168 } }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(modelDisplayConfig()).toEqual({ provider: "openai", model: "gpt-5.4-mini", visionModel: "gpt-5.4-mini" });
  expect((await identifyItem(image())).usage).toEqual({ inputTokens: 123, outputTokens: 45, totalTokens: 168 });
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("does not use an OpenAI key when Meta is selected", async () => {
  process.env.OPENAI_API_KEY = "openai-test-key";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(() => modelConfig()).toThrow(/MODEL_API_KEY/);
  await expect(identifyItem(image())).rejects.toThrow(/MODEL_API_KEY/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not fall back to a Meta key when OpenAI is selected", async () => {
  process.env.MODEL_PROVIDER = "openai";
  process.env.MODEL_API_KEY = "meta-test-key";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(() => modelConfig()).toThrow(/OPENAI_API_KEY/);
  await expect(identifyItem(image())).rejects.toThrow(/OPENAI_API_KEY/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("fails before fetch on invalid provider or completion cap", async () => {
  process.env.MODEL_PROVIDER = "other";
  process.env.OPENAI_API_KEY = "openai-test-key";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  expect(() => modelConfig()).toThrow(/MODEL_PROVIDER/);
  process.env.MODEL_PROVIDER = "openai";
  process.env.MODEL_MAX_COMPLETION_TOKENS = "6001";
  await expect(identifyItem(image())).rejects.toThrow(/MODEL_MAX_COMPLETION_TOKENS/);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps Meta routing and applies the completion cap when Meta is selected", async () => {
  process.env.MODEL_PROVIDER = "meta";
  process.env.MODEL_API_KEY = "meta-test-key";
  process.env.OPENAI_API_KEY = "openai-test-key";
  process.env.MODEL_MAX_COMPLETION_TOKENS = "4000";
  process.env.VISION_MAX_COMPLETION_TOKENS = "4000";
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(init.headers).toMatchObject({ authorization: "Bearer meta-test-key" });
    expect(JSON.parse(String(init.body)).max_completion_tokens).toBe(4000);
    return ok(identification);
  });
  vi.stubGlobal("fetch", fetchMock);
  expect((await identifyItem(image())).usage).toBeUndefined();
});

it("records transport, image, and reasoning timing without logging source messages", async () => {
  process.env.MODEL_API_KEY = "test-only";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({
    choices: [{ message: { content: JSON.stringify(identification) } }],
    usage: { prompt_tokens: 20, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 10 } },
  }) })));
  const result = await identifyItem(image());
  expect(result.usage?.reasoningTokens).toBe(10);
  expect(result.timings.attempts).toEqual([expect.objectContaining({ attempt: 1, status: 200, outcome: "ok", responseHeadersMs: expect.any(Number), responseBodyMs: expect.any(Number) })]);
  expect(result.imageMetrics).toMatchObject({ width: 1, height: 1, originalBytes: image().size });
  expect(JSON.stringify(result.timings)).not.toContain("test-only");
});
