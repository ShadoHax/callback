import { afterEach, expect, it, vi } from "vitest";
import { createScanLogger, logMemoryPreparation } from "../src/lib/scan-logging";
import type { StageEvent } from "../src/lib/scan-types";

afterEach(() => vi.restoreAllMocks());

function captureConsole() {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const table = vi.spyOn(console, "table").mockImplementation(() => {});
  return { info, table };
}

it("logs allowlisted stage and provider attempt timings without scan content", () => {
  const { info, table } = captureConsole();
  const logger = createScanLogger({ mode: "manual", captureSource: "phone_camera", imageBytes: 1234 });
  logger.response(200);
  logger.event({
    type: "entity_identified", elapsedMs: 420, message: "PRIVATE_MESSAGE", photo: "PRIVATE_PHOTO",
    credentials: "PRIVATE_CREDENTIALS", previewToken: "PRIVATE_PREVIEW_TOKEN", person: "PRIVATE_PERSON",
    evidence: [{ text: "PRIVATE_EVIDENCE" }], ms: 310, attempts: 2,
    providerTimings: {
      requestBytes: 600, serializationMs: 12,
      attempts: [{ attempt: 1, responseHeadersMs: 60, responseBodyMs: 70, parseMs: 8, totalMs: 138, status: 503,
        credential: "PRIVATE_ATTEMPT_CREDENTIAL" }],
    },
  } as StageEvent);
  logger.event({ type: "result", elapsedMs: 600, result: {
    status: "matched", scanId: "PRIVATE_SCAN_ID", person: "PRIVATE_RESULT_PERSON", previewToken: "PRIVATE_RESULT_TOKEN",
    evidence: [{ id: "id", speakerId: "speaker", text: "PRIVATE_RESULT_EVIDENCE", date: "today", synthetic: false }],
    timings: { visionMs: 310, relationsMs: 20, totalMs: 600 },
  } });
  logger.finish("result");

  const rendered = JSON.stringify([...info.mock.calls, ...table.mock.calls]);
  for (const secret of ["PRIVATE_MESSAGE", "PRIVATE_PHOTO", "PRIVATE_CREDENTIALS", "PRIVATE_PREVIEW_TOKEN",
    "PRIVATE_PERSON", "PRIVATE_EVIDENCE", "PRIVATE_ATTEMPT_CREDENTIAL", "PRIVATE_SCAN_ID",
    "PRIVATE_RESULT_PERSON", "PRIVATE_RESULT_TOKEN", "PRIVATE_RESULT_EVIDENCE"]) {
    expect(rendered).not.toContain(secret);
  }
  expect(info.mock.calls).toContainEqual([expect.stringMatching(/^\[Callback scan \d+\]$/), "entity_identified",
    expect.objectContaining({ serverElapsedMs: 420, ms: 310, attempts: 2 })]);
  expect(info.mock.calls).toContainEqual([expect.stringMatching(/^\[Callback scan \d+\]$/), "vision_api",
    { requestBytes: 600, serializationMs: 12 }]);
  expect(table.mock.calls).toContainEqual([[expect.objectContaining({ attempt: 1, responseHeadersMs: 60,
    responseBodyMs: 70, parseMs: 8, totalMs: 138, status: 503 })]]);
  expect(table.mock.calls).toContainEqual(expect.arrayContaining([expect.arrayContaining([
    expect.objectContaining({ phase: "visionMs", ms: 310 }),
  ])]));
});

it("finishes a cancelled scan once and keeps independent scan labels", () => {
  const { info } = captureConsole();
  const first = createScanLogger({ mode: "hover", captureSource: "phone_camera", imageBytes: 100 });
  const second = createScanLogger({ mode: "manual", captureSource: "quest", imageBytes: 200 });
  first.event({ type: "memory_checked", elapsedMs: 10 });
  first.finish("cancelled");
  first.finish("error");
  first.event({ type: "error", message: "PRIVATE_LATE_ERROR" });
  second.event({ type: "context_loaded", elapsedMs: 22 });
  second.finish("result");

  const starts = info.mock.calls.filter(([, stage]) => stage === "capture_started");
  expect(starts).toHaveLength(2);
  expect(starts[0][0]).toMatch(/^\[Callback scan \d+\]$/);
  expect(starts[1][0]).toMatch(/^\[Callback scan \d+\]$/);
  expect(starts[0][0]).not.toBe(starts[1][0]);
  expect(info.mock.calls.filter(([, stage]) => stage === "finished")).toEqual([
    [starts[0][0], "finished", expect.objectContaining({ outcome: "cancelled", lastServerElapsedMs: 10 })],
    [starts[1][0], "finished", expect.objectContaining({ outcome: "result", lastServerElapsedMs: 22 })],
  ]);
  expect(JSON.stringify(info.mock.calls)).not.toContain("PRIVATE_LATE_ERROR");
});

it("logs memory preparation counts and flags without raw source or error data", () => {
  const { info } = captureConsole();
  logMemoryPreparation({ ready: true, reused: false, sourceCount: 4, relationCount: 3, modelCalls: 1,
    buildMs: 250, error: "PRIVATE_ERROR", sources: [{ text: "PRIVATE_SOURCE" }],
    credentials: "PRIVATE_CREDENTIALS" }, 300, 200);

  expect(info).toHaveBeenCalledWith("[Callback memory]", expect.objectContaining({
    browserMs: 300, httpStatus: 200, ready: true, reused: false, sourceCount: 4,
    relationCount: 3, modelCalls: 1, buildMs: 250,
  }));
  const rendered = JSON.stringify(info.mock.calls);
  for (const secret of ["PRIVATE_ERROR", "PRIVATE_SOURCE", "PRIVATE_CREDENTIALS"]) expect(rendered).not.toContain(secret);
});
