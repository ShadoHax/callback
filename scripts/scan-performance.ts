// Read-only scan latency probe for one local photo. Preparation may build the owner's derived memory;
// scans use unsaved hover mode and never open previews, persist photos, edit context, or send messages.
// npm run scan:performance -- --image data/private/phone-photos/soda.jpg [--runs 1..5] [--app https://...]
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, join, resolve } from "node:path";
import type { ModelTimings, ModelUsage } from "../src/lib/model";
import type { ScanResult } from "../src/lib/scan-types";
import { MIME, flags, need, reachable, session, type Session } from "./lib/live";

const DEFAULT_APP = "https://callback-khaki-phi.vercel.app";
type Preparation = { http: number; totalMs: number; ready: boolean; reused?: boolean; revision?: string;
  sourceCount?: number; relationCount?: number; modelCalls?: number; buildMs?: number;
  inputTokens?: number | null; outputTokens?: number | null; error?: string };
type WireEvent = { type: string; elapsedMs?: number; ms?: number; code?: string; reason?: string; result?: ScanResult;
  attempts?: number; image?: ImageMetrics; providerTimings?: ModelTimings; corpusRevision?: string;
  memoryMs?: number; sourcesMs?: number; readiness?: string; sourceCount?: number; relationCount?: number; promptVersion?: string };
type ImageMetrics = { originalBytes: number; sentBytes: number; width: number; height: number; maxEdge: number; preparationMs: number };
type Candidate = { personId: string; status: "matched" | "ruled_out"; reason: string };
type ScanMeasurement = { run: number; http: number; status: string; scanId?: string; errorCode?: string; errorReason?: string;
  persisted?: boolean;
  candidates: Candidate[]; sourceRevision?: string; promptVersion?: string; memoryReady?: boolean;
  timings: { totalMs: number; responseHeadersMs: number; responseBodyMs: number; serverElapsedMs?: number;
    transportOverheadMs?: number; sourcesMs?: number; memoryMs?: number; visionMs?: number; imagePreparationMs?: number;
    retrievalMs?: number; relationsMs?: number; decisionMs?: number; contactsMs?: number };
  image: { originalBytes: number; sentBytes?: number; width?: number; height?: number; maxEdge?: number; preparationMs?: number };
  model?: { provider: string; memoryModel: string; visionModel?: string };
  vision: { attempts?: number; usage?: ModelUsage; providerTimings?: ModelTimings };
  relationModelCallObserved: boolean };

async function prepare(user: Session): Promise<Preparation> {
  const started = Date.now();
  try {
    const response = await user.call("/api/context/prepare", { method: "POST" });
    const body = await response.json().catch(() => ({})) as Partial<Preparation>;
    return { http: response.status, totalMs: Date.now() - started, ready: response.ok && body.ready === true,
      reused: body.reused, revision: body.revision, sourceCount: body.sourceCount,
      relationCount: body.relationCount, modelCalls: body.modelCalls, buildMs: body.buildMs,
      inputTokens: body.inputTokens, outputTokens: body.outputTokens, error: body.error };
  } catch {
    return { http: 0, totalMs: Date.now() - started, ready: false, error: "Preparation request failed." };
  }
}

function candidates(result: ScanResult): Candidate[] {
  const found = result.people?.length
    ? result.people.map((person) => ({ personId: person.personId, status: "matched" as const, reason: person.relation }))
    : result.status === "matched" && result.person
      ? [{ personId: result.person, status: "matched" as const, reason: result.relation ?? "" }]
      : [];
  return [...found, ...(result.ruledOut ?? []).map((person) => ({ personId: person.personId,
    status: "ruled_out" as const, reason: person.code }))];
}

async function scan(user: Session, image: File, run: number): Promise<ScanMeasurement> {
  const form = new FormData();
  form.set("image", image); form.set("captureSource", "phone_upload"); form.set("mode", "hover");
  const started = Date.now();
  const response = await user.call("/api/scans", { method: "POST", body: form });
  const responseHeadersMs = Date.now() - started;
  const raw = await response.text();
  const totalMs = Date.now() - started;
  const responseBodyMs = totalMs - responseHeadersMs;
  let events: WireEvent[];
  try { events = raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as WireEvent); }
  catch { events = []; }
  const last = events.at(-1);
  const result = last?.type === "result" ? last.result : undefined;
  const identified = events.find((event) => event.type === "entity_identified");
  const memory = events.find((event) => event.type === "memory_checked");
  const imageMetrics = identified?.image ?? result?.visionDiagnostics?.image;
  const providerTimings = identified?.providerTimings ?? result?.visionDiagnostics?.provider ?? last?.providerTimings;
  const serverElapsedMs = last?.elapsedMs;
  return {
    run, http: response.status, status: result?.status ?? (last?.type === "error" ? "error" : "incomplete"),
    ...(result?.scanId ? { scanId: result.scanId } : {}),
    ...(result ? { persisted: result.persisted } : {}),
    ...(last?.type === "error" ? { errorCode: last.code ?? "scan_error", errorReason: last.reason ?? "unspecified" } : {}),
    candidates: result ? candidates(result) : [],
    sourceRevision: memory?.corpusRevision,
    promptVersion: memory?.promptVersion ?? result?.memory?.promptVersion,
    memoryReady: memory?.readiness === "ready" ? true : memory?.readiness === "required" ? false : undefined,
    timings: { totalMs, responseHeadersMs, responseBodyMs, serverElapsedMs,
      transportOverheadMs: serverElapsedMs === undefined ? undefined : Math.max(0, totalMs - serverElapsedMs),
      sourcesMs: result?.timings?.sourcesMs ?? memory?.sourcesMs,
      memoryMs: result?.timings?.memoryMs ?? memory?.memoryMs,
      visionMs: result?.timings?.visionMs ?? identified?.ms,
      imagePreparationMs: result?.timings?.imagePreparationMs ?? imageMetrics?.preparationMs,
      retrievalMs: result?.timings?.retrievalMs, relationsMs: result?.timings?.relationsMs,
      decisionMs: result?.timings?.decisionMs, contactsMs: result?.timings?.contactsMs },
    image: { originalBytes: image.size, sentBytes: imageMetrics?.sentBytes, width: imageMetrics?.width,
      height: imageMetrics?.height, maxEdge: imageMetrics?.maxEdge, preparationMs: imageMetrics?.preparationMs },
    model: result?.model ? { provider: result.model.provider, memoryModel: result.model.model,
      visionModel: result.model.visionModel } : undefined,
    vision: { attempts: identified?.attempts ?? providerTimings?.attempts.length,
      usage: result?.usage?.vision, providerTimings },
    relationModelCallObserved: Boolean(result?.usage?.relations) || (result?.timings?.relationsMs ?? 0) > 0,
  };
}

async function main() {
  const { read, has } = flags(process.argv.slice(2));
  if (has("help")) {
    console.log("Usage: npm run scan:performance -- --image <jpg|png|webp> [--runs 1..5] [--app https://host]");
    return;
  }
  const imagePath = read("image");
  const runs = Number(read("runs") ?? "1");
  const app = (read("app") ?? DEFAULT_APP).replace(/\/$/, "");
  const problems: string[] = [];
  if (!imagePath) problems.push("--image <photo> is required");
  else {
    if (!MIME[extname(imagePath).toLowerCase()]) problems.push("--image must be a JPG, PNG, or WebP file");
    if (await access(imagePath).then(() => false, () => true)) problems.push("--image file was not found");
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) problems.push("--runs must be an integer from 1 to 5");
  try { const url = new URL(app); if (!/^https?:$/.test(url.protocol)) problems.push("--app must be an HTTP(S) URL"); }
  catch { problems.push("--app must be an HTTP(S) URL"); }
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DEMO_SCANNER_EMAIL", "DEMO_SCANNER_PASSWORD"])
    if (!process.env[name]) problems.push(`${name} missing from .env.local`);
  if (problems.length) throw new Error(`Preflight failed before any model calls:\n  - ${problems.join("\n  - ")}`);
  const image = new File([await readFile(imagePath!)], basename(imagePath!), { type: MIME[extname(imagePath!).toLowerCase()] });
  if (image.size === 0 || image.size > 8 * 1024 * 1024) throw new Error("Photo must be nonempty and at most 8 MB; no model calls were made.");
  if (!(await reachable(app))) throw new Error(`App not reachable at ${app}; no model calls were made.`);

  const user = await session(app, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD")).catch(() => { throw new Error("Demo scanner sign-in failed."); });
  const modelResponse = await user.call("/api/model/config").catch(() => null);
  const activeModel = modelResponse?.ok
    ? await modelResponse.json().catch(() => null) as { provider?: string; model?: string; visionModel?: string } | null
    : null;
  const preparation = await prepare(user);
  console.log(`Prepared memory: ${preparation.ready ? "ready" : "not ready"}, ${(preparation.totalMs / 1000).toFixed(2)}s, ${preparation.modelCalls ?? "?"} model calls, ${preparation.sourceCount ?? "?"} sources, ${preparation.inputTokens ?? "?"}/${preparation.outputTokens ?? "?"} input/output tokens.`);
  const measurements: ScanMeasurement[] = [];
  if (preparation.ready) for (let run = 1; run <= runs; run++) {
    const measurement = await scan(user, image, run);
    measurements.push(measurement);
    const time = measurement.timings;
    const model = measurement.model ?? (activeModel?.provider && activeModel.model
      ? { provider: activeModel.provider, memoryModel: activeModel.model, visionModel: activeModel.visionModel } : undefined);
    console.log(`Run ${run}: ${measurement.status}${measurement.errorCode ? ` (${measurement.errorCode}/${measurement.errorReason})` : ""}; total ${time.totalMs}ms, server ${time.serverElapsedMs ?? "?"}ms, transport ${time.transportOverheadMs ?? "?"}ms (headers ${time.responseHeadersMs}ms, body ${time.responseBodyMs}ms); vision ${time.visionMs ?? "?"}ms, memory ${time.memoryMs ?? "?"}ms, relations ${time.relationsMs ?? "?"}ms.`);
    console.log(`  Image ${measurement.image.originalBytes}/${measurement.image.sentBytes ?? "?"} original/sent bytes; model ${model ? `${model.provider}/${model.visionModel ?? model.memoryModel}` : "?"}; vision attempts ${measurement.vision.attempts ?? "?"}, tokens ${measurement.vision.usage?.inputTokens ?? "?"}/${measurement.vision.usage?.outputTokens ?? "?"} input/output; relation model call ${measurement.relationModelCallObserved ? "observed" : "none"}.`);
    console.log(`  Candidates (IDs/status/reason codes): ${JSON.stringify(measurement.candidates)}`);
    if (measurement.status === "error" || measurement.status === "incomplete" || measurement.relationModelCallObserved) break;
  }
  const completed = measurements.filter((item) => ["matched", "no_match", "needs_clarification"].includes(item.status));
  const report = { at: new Date().toISOString(), app, image: { filename: basename(imagePath!), bytes: image.size,
    sha256: createHash("sha256").update(Buffer.from(await image.arrayBuffer())).digest("hex") },
    requestedRuns: runs, completedRuns: completed.length,
    activeModel: activeModel && activeModel.provider && activeModel.model
      ? { provider: activeModel.provider, memoryModel: activeModel.model, visionModel: activeModel.visionModel } : null,
    preparation, scans: measurements,
    checks: { memoryReady: preparation.ready, allScansUnsaved: completed.every((item) => item.persisted === false),
      noRelationModelCall: measurements.every((item) => !item.relationModelCallObserved) },
    note: "Unsaved hover previews only. Preparation is separate from scan latency. No message contents, preview tokens, or credentials are recorded." };
  const directory = resolve("data/private/live");
  await mkdir(directory, { recursive: true });
  const out = join(directory, `scan-performance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(`Saved sanitized report: ${out}`);
  if (!preparation.ready || completed.length !== runs || completed.some((item) => item.persisted !== false) || measurements.some((item) => item.relationModelCallObserved)) process.exitCode = 1;
}

main().catch((cause) => { console.error(cause instanceof Error ? cause.message : "Performance check failed."); process.exitCode = 1; });
