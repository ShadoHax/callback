import { expect, it } from "vitest";
import { readScanStream } from "../src/lib/scan-client";

const stream = (chunks: string[], fail = false) => new Response(new ReadableStream({
  start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); if (fail) controller.error(new Error("socket reset")); else controller.close(); },
}));
const stage = JSON.stringify({ type: "context_loaded", message: "Loaded 4" });
const result = JSON.stringify({ type: "result", elapsedMs: 5200, result: { status: "matched", scanId: "s1", person: "maya" } });

it("returns the terminal result and forwards stages, even when lines split across chunks", async () => {
  const stages: string[] = [];
  const outcome = await readScanStream(stream([stage.slice(0, 10), `${stage.slice(10)}\n${result.slice(0, 20)}`, `${result.slice(20)}\n`]), (event) => stages.push(event.type));
  expect(stages).toEqual(["context_loaded"]);
  expect(outcome).toMatchObject({ kind: "result", elapsedMs: 5200, result: { scanId: "s1" } });
});

it("accepts a final line without a trailing newline", async () => {
  expect((await readScanStream(stream([`${stage}\n${result}`]), () => {})).kind).toBe("result");
});

it("reports EOF without a terminal event as an interrupted scan", async () => {
  const outcome = await readScanStream(stream([`${stage}\n`]), () => {});
  expect(outcome).toEqual({ kind: "error", message: expect.stringMatching(/ended without a result/) });
});

it("reports a truncated terminal line as garbled, not complete", async () => {
  const outcome = await readScanStream(stream([`${stage}\n${result.slice(0, 30)}`]), () => {});
  expect(outcome).toEqual({ kind: "error", message: expect.stringMatching(/garbled/) });
});

it("reports a result without a valid outcome as garbled", async () => {
  const outcome = await readScanStream(stream([`${JSON.stringify({ type: "result", result: { scanId: "s1" } })}\n`]), () => {});
  expect(outcome.kind).toBe("error");
});

it("reports a dropped connection", async () => {
  const outcome = await readScanStream(stream([`${stage}\n`], true), () => {});
  expect(outcome).toEqual({ kind: "error", message: expect.stringMatching(/dropped/) });
});

it("passes through a server error event", async () => {
  const outcome = await readScanStream(stream([`${JSON.stringify({ type: "error", message: "Model request timed out." })}\n`]), () => {});
  expect(outcome).toEqual({ kind: "error", message: "Model request timed out." });
});

it("preserves structured memory readiness errors for the scanner UI", async () => {
  const outcome = await readScanStream(stream([`${JSON.stringify({ type: "error", code: "memory_required", reason: "missing_or_stale", message: "Refresh memory, then scan again." })}\n`]), () => {});
  expect(outcome).toEqual({ kind: "error", code: "memory_required", reason: "missing_or_stale", message: "Refresh memory, then scan again." });
});

it("reports a user cancellation as cancelled", async () => {
  const controller = new AbortController(); controller.abort();
  expect(await readScanStream(stream([`${stage}\n`], true), () => {}, controller.signal)).toEqual({ kind: "cancelled" });
});

it("observes stages and terminal events without letting diagnostics break the scan", async () => {
  const observed: string[] = [];
  const outcome = await readScanStream(stream([`${stage}\n${result}\n`]), () => {}, undefined, (event) => {
    observed.push(event.type); throw new Error("console extension failed");
  });
  expect(observed).toEqual(["context_loaded", "result"]);
  expect(outcome.kind).toBe("result");
});
