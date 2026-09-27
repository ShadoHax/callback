import type { StageEvent } from "./scan-types";

let sequence = 0;
const stages = new Set(["frame_received", "memory_checked", "entity_identified", "context_loaded", "searching", "mentions_found", "ruled_out", "matched", "needs_clarification", "no_match", "location_verified", "location_needed", "contact_nearby", "result", "error"]);
const numeric = (value: unknown, keys: string[]) => {
  const object = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(keys.flatMap((key) => typeof object[key] === "number" && Number.isFinite(object[key]) && (object[key] as number) >= 0 ? [[key, object[key]]] : []));
};
const now = () => performance.now();
const rounded = (ms: number) => Math.round(ms);
const info = (...values: unknown[]) => { try { console.info(...values); } catch { /* logging cannot break scanning */ } };
const table = (rows: object[]) => { try { console.table(rows); } catch { /* logging cannot break scanning */ } };

/** Always-on local console diagnostics. Only allowlisted numbers/flags are logged, never whole wire events. */
export function createScanLogger(input: { mode: string; captureSource: string; imageBytes: number }) {
  const label = `[Callback scan ${++sequence}]`;
  const started = now();
  let requested = started;
  let finished = false;
  let lastServerMs: number | undefined;
  let previousServerMs = 0;
  const log = (stage: string, values: object) => info(label, stage, values);
  log("capture_started", { mode: input.mode === "hover" ? "hover" : "manual", imageBytes: input.imageBytes,
    captureSource: ["phone_camera", "phone_upload", "quest", "glasses"].includes(input.captureSource) ? input.captureSource : "other" });
  return {
    request() { requested = now(); log("api_request_started", { browserElapsedMs: rounded(requested - started) }); },
    response(status: number) { log("api_response_headers", { status, requestToHeadersMs: rounded(now() - requested), browserElapsedMs: rounded(now() - started) }); },
    event(event: StageEvent) {
      if (finished) return;
      const elapsed = numeric(event, ["elapsedMs"]).elapsedMs as number | undefined;
      log(stages.has(event.type) ? event.type : "other_stage", {
        browserElapsedMs: rounded(now() - started),
        ...(elapsed === undefined ? {} : { serverElapsedMs: elapsed, serverStageDeltaMs: Math.max(0, elapsed - previousServerMs) }),
        ...numeric(event, ["ms", "sourcesMs", "memoryMs", "sourceCount", "relationCount", "attempts"]),
      });
      if (elapsed !== undefined) { previousServerMs = elapsed; lastServerMs = elapsed; }
      const wire = event as StageEvent & { providerTimings?: unknown; image?: unknown };
      const provider = (wire.providerTimings ?? event.result?.visionDiagnostics?.provider) as { attempts?: unknown } | undefined;
      // Provider timings are emitted immediately after vision, including failed calls.
      if (event.type !== "result" && provider) {
        log("vision_api", numeric(provider, ["requestBytes", "serializationMs"]));
        if (Array.isArray(provider.attempts)) table(provider.attempts.map((attempt) => ({ scan: label, ...numeric(attempt, ["attempt", "responseHeadersMs", "responseBodyMs", "parseMs", "totalMs", "status"]) })));
      }
      if (wire.image) log("vision_image", numeric(wire.image, ["originalBytes", "sentBytes", "width", "height", "maxEdge", "preparationMs"]));
      if (event.type === "result" && event.result) {
        const timings = numeric(event.result.timings, ["sourcesMs", "memoryMs", "imagePreparationMs", "visionMs", "retrievalMs", "relationsMs", "decisionMs", "contactsMs", "assembledMs"]);
        table(Object.entries(timings).map(([phase, ms]) => ({ scan: label, phase, ms })));
        log("model_usage", numeric(event.result.usage?.vision, ["inputTokens", "outputTokens", "reasoningTokens", "totalTokens"]));
      }
    },
    finish(outcome: "result" | "error" | "cancelled") {
      if (finished) return;
      finished = true;
      log("finished", { outcome, browserTotalMs: rounded(now() - started), requestTotalMs: rounded(now() - requested),
        ...(lastServerMs === undefined ? {} : { lastServerElapsedMs: lastServerMs }) });
    },
  };
}

export function logMemoryPreparation(data: unknown, browserMs: number, httpStatus: number) {
  const value = data && typeof data === "object" ? data as Record<string, unknown> : {};
  info("[Callback memory]", { browserMs: rounded(browserMs), httpStatus, ready: value.ready === true, reused: value.reused === true,
    ...numeric(value, ["sourceCount", "relationCount", "modelCalls", "buildMs", "inputTokens", "outputTokens"]) });
}
