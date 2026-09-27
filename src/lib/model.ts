import { ZodError, type z } from "zod";

// Chat Completions adapter. Meta remains the default; the temporary OpenAI
// route has its own credential and a fixed endpoint so keys cannot cross routes.

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";
type Content = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export class ModelError extends Error {
  timings?: ModelTimings;
  constructor(message: string, readonly status?: number) { super(message); }
}

export type ModelProvider = "meta" | "openai";
export type ModelUsage = { inputTokens: number; outputTokens: number; totalTokens?: number; reasoningTokens?: number };
export type ModelAttemptTiming = { attempt: number; responseHeadersMs: number; responseBodyMs: number; parseMs: number; totalMs: number; status?: number; outcome: "ok" | "error" };
export type ModelTimings = { requestBytes: number; serializationMs: number; attempts: ModelAttemptTiming[] };

export function modelDisplayConfig(): { provider: ModelProvider; model: string; visionModel: string } {
  const provider = process.env.MODEL_PROVIDER || "meta";
  if (provider !== "meta" && provider !== "openai") throw new ModelError("MODEL_PROVIDER must be meta or openai.");
  const model = provider === "openai" ? process.env.OPENAI_MODEL || "gpt-5.4-mini" : process.env.META_MODEL || "muse-spark-1.3";
  // Tiered inference: the latency-critical glance can use a smaller, faster model of the same provider, while
  // relationship memory (built ahead of time, quality-critical) keeps the main model. Memory cache keys use `model`.
  const vision = (provider === "openai" ? process.env.OPENAI_VISION_MODEL : process.env.META_VISION_MODEL)?.trim();
  if (vision && !/^[A-Za-z0-9._:-]{1,80}$/.test(vision)) throw new ModelError("The vision model name is invalid.");
  return { provider, model, visionModel: vision || model };
}

export function modelConfig() {
  const { provider, model, visionModel } = modelDisplayConfig();
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new ModelError("OPENAI_API_KEY is not configured.");
    return { provider, model, visionModel, key, base: "https://api.openai.com/v1" };
  }
  const key = process.env.MODEL_API_KEY;
  if (!key) throw new ModelError("MODEL_API_KEY is not configured.");
  const base = (process.env.META_API_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
  let url: URL;
  try { url = new URL(base); } catch { throw new ModelError("META_API_BASE_URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new ModelError("META_API_BASE_URL must be an HTTPS URL without credentials.");
  return { provider, model, visionModel, key, base };
}

function completionTokenLimit(vision = false) {
  const configured = process.env.MODEL_MAX_COMPLETION_TOKENS;
  const tokens = configured === undefined || configured === "" ? 6000 : Number(configured);
  if (!Number.isInteger(tokens) || tokens < 1 || tokens > 6000) throw new ModelError("MODEL_MAX_COMPLETION_TOKENS must be an integer from 1 to 6000.");
  if (!vision) return tokens;
  const visionTokens = Number(process.env.VISION_MAX_COMPLETION_TOKENS || "1536");
  if (!Number.isInteger(visionTokens) || visionTokens < 128 || visionTokens > 6000) throw new ModelError("VISION_MAX_COMPLETION_TOKENS must be an integer from 128 to 6000.");
  return Math.min(tokens, visionTokens);
}

function parseUsage(value: unknown): ModelUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  const valid = (token: unknown): token is number => Number.isSafeInteger(token) && (token as number) >= 0;
  if (!valid(usage.prompt_tokens) || !valid(usage.completion_tokens)) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    ...(valid((usage.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens) ? { reasoningTokens: (usage.completion_tokens_details as { reasoning_tokens: number }).reasoning_tokens } : {}),
    ...(valid(usage.total_tokens) ? { totalTokens: usage.total_tokens } : {}),
  };
}

// A timeout is transient too. Every call still has a strict per-attempt deadline and
// at most one retry, while an upstream/user abort stops immediately.
const retryable = (status?: number) => status === undefined || status === 408 || status === 429 || status >= 500;

export async function structuredCall<T>(input: {
  name: string; schema: object; parse: z.ZodType<T>; instructions: string; content: Content;
  reasoningEffort?: ReasoningEffort; timeoutMs: number; signal?: AbortSignal; purpose?: "vision" | "text";
  /** Server-selected model for a bounded task; never take this value from request input. */
  modelOverride?: string;
}): Promise<{ value: T; ms: number; attempts: number; usage?: ModelUsage; model: string; timings: ModelTimings }> {
  const config = modelConfig();
  const { provider, key, base } = config;
  const model = input.modelOverride ?? (input.purpose === "vision" ? config.visionModel : config.model);
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(model)) throw new ModelError("The model name is invalid.");
  const started = Date.now();
  const maxCompletionTokens = completionTokenLimit(input.purpose === "vision" && provider === "meta");
  const serializationStarted = Date.now();
  const body = JSON.stringify({
    model,
    messages: [{ role: "developer", content: input.instructions }, { role: "user", content: input.content }],
    response_format: { type: "json_schema", json_schema: { name: input.name, schema: input.schema, strict: true } },
    ...(input.reasoningEffort ? { reasoning_effort: provider === "openai" && input.reasoningEffort === "minimal" ? "low" : input.reasoningEffort } : {}),
    max_completion_tokens: maxCompletionTokens,
  });
  const timings: ModelTimings = { requestBytes: Buffer.byteLength(body), serializationMs: Date.now() - serializationStarted, attempts: [] };
  let lastError: ModelError | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptStarted = Date.now();
    const timing: ModelAttemptTiming = { attempt, responseHeadersMs: 0, responseBodyMs: 0, parseMs: 0, totalMs: 0, outcome: "error" };
    const signal = AbortSignal.any([AbortSignal.timeout(input.timeoutMs), ...(input.signal ? [input.signal] : [])]);
    try {
      const response = await fetch(`${base}/chat/completions`, { method: "POST", signal, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body });
      timing.responseHeadersMs = Date.now() - attemptStarted;
      timing.status = response.status;
      if (!response.ok) throw new ModelError(`Model request failed (${response.status}).`, response.status);
      const bodyStarted = Date.now();
      const payload = await response.json();
      timing.responseBodyMs = Date.now() - bodyStarted;
      const parseStarted = Date.now();
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        const finish = payload?.choices?.[0]?.finish_reason;
        const safeReason = ["length", "stop", "content_filter", "tool_calls"].includes(finish) ? finish : "unknown";
        const outputTokens = parseUsage(payload?.usage)?.outputTokens;
        throw new ModelError(`Model returned no content (finish: ${safeReason}${outputTokens === undefined ? "" : `, output tokens: ${outputTokens}`}).`, 200);
      }
      const value = input.parse.parse(JSON.parse(content));
      timing.parseMs = Date.now() - parseStarted;
      timing.totalMs = Date.now() - attemptStarted; timing.outcome = "ok";
      timings.attempts.push(timing);
      return { value, ms: Date.now() - started, attempts: attempt, usage: parseUsage(payload?.usage), model, timings };
    } catch (cause) {
      if (input.signal?.aborted) throw cause;
      if (cause instanceof ModelError) lastError = cause;
      else if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) lastError = new ModelError("Model request timed out.", 408);
      else if (cause instanceof SyntaxError || cause instanceof ZodError) lastError = new ModelError("Model returned malformed output.", 200);
      else lastError = new ModelError("Model request failed (network).");
      timing.totalMs = Date.now() - attemptStarted;
      timing.status ??= lastError.status;
      timings.attempts.push(timing);
      // One bounded retry, only for transient failures. A malformed answer is not retried into a different answer.
      // A timed-out glance needs an explicit retry; doubling a 15-second wait makes a live camera unusable.
      if (attempt === 2 || !retryable(lastError.status) || (input.purpose === "vision" && lastError.status === 408)) break;
      // A rate limit needs a pause; an immediate retry just hits the same limit.
      if (lastError.status === 429) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  if (lastError) { lastError.timings = timings; throw lastError; }
  throw new ModelError("Model request failed.");
}

export function imageDataUrl(bytes: ArrayBuffer, type: string) {
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}
