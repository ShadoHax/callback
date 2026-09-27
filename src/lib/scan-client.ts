import type { ScanResult, StageEvent } from "./scan-types";

export type ScanOutcome = { kind: "result"; result: ScanResult; elapsedMs?: number } | { kind: "error"; message: string; code?: string; reason?: string } | { kind: "cancelled" };

class Garbled extends Error {}

// Reads the NDJSON scan stream. Only a terminal `result` or `error` event ends a scan; a stream that breaks,
// garbles, or simply ends without one is reported as an interrupted scan, never as a completed one.
export async function readScanStream(response: Response, onStage: (event: StageEvent) => void, signal?: AbortSignal, onDiagnostic?: (event: StageEvent) => void): Promise<ScanOutcome> {
  if (!response.body) return { kind: "error", message: "The server returned no scan stream. Try again." };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let terminal: ScanOutcome | null = null;
  let done = false;
  const handle = (line: string) => {
    if (!line.trim() || terminal) return;
    let event: StageEvent;
    try { event = JSON.parse(line); } catch { throw new Garbled(); }
    if (!event || typeof event.type !== "string") throw new Garbled();
    if (event.type === "result") {
      if (!event.result?.scanId || !["matched", "no_match", "needs_clarification"].includes(event.result.status)) throw new Garbled();
      terminal = { kind: "result", result: event.result, elapsedMs: event.elapsedMs };
    } else if (event.type === "error") terminal = { kind: "error", message: event.message || "The scan failed. Try again.",
      ...(event.code ? { code: event.code } : {}), ...(event.reason ? { reason: event.reason } : {}) };
    else onStage(event);
    // Console instrumentation must never interrupt an otherwise valid scan.
    try { onDiagnostic?.(event); } catch { /* diagnostics are best-effort */ }
  };
  try {
    while (!terminal) {
      const chunk = await reader.read();
      if (chunk.done) { done = true; pending += decoder.decode(); handle(pending); break; }
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
  } catch (cause) {
    if (signal?.aborted) return { kind: "cancelled" };
    if (cause instanceof Garbled) return { kind: "error", message: "The scan response was garbled, so no result is shown. Check Recent scans, then try again." };
    return { kind: "error", message: "The connection dropped before the scan finished. Check Recent scans before scanning again." };
  } finally {
    if (!done) reader.cancel().catch(() => {});
  }
  if (terminal) return terminal;
  if (signal?.aborted) return { kind: "cancelled" };
  return { kind: "error", message: "The scan ended without a result. Check Recent scans, then try again." };
}
