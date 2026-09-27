// Live acceptance check with the real model, database, and policies, against a running app:
//   npm run live:check -- --hero war-and-peace.jpg --hero-source "where the image came from" \
//     --person maya --relation inspired --update-text "Update: I stopped writing the War and Peace novel." \
//     --expect-update closed [--nomatch stapler.jpg --nomatch-source "manufacturer product page"] \
//     [--runs 5] [--app https://…]
// --expect-update: "preserved" (e.g. owning a game keeps a plan to play it together) or "closed" (e.g. buying the
// exact camera ends a request to find one). Every assertion in a run must pass for the run to count; the report
// gives total complete runs and the longest consecutive streak separately. Replies are SCRIPTED transport checks,
// not human replies; API polling times are not browser Realtime or physical-phone measurements.
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RELATIONS } from "../src/lib/decision";
import { MIME, flags, messagesOf, need, photo, post, reachable, recorder, runSummary, session, waitFor, type Session } from "./lib/live";

type ModelUsage = { inputTokens: number; outputTokens: number; totalTokens?: number };
type ScanOut = { ms: number; stages: string[]; result: { scanId: string; status: string; person?: string; relation?: string; recipientId?: string; evidence?: { id: string; shareableQuote?: boolean }[]; model?: { provider: string; model: string }; usage?: { vision?: ModelUsage; relations?: ModelUsage } } | null; error: string | null; http: number };
type Preparation = { phase: "initial" | "after_update" | "after_reset"; ms: number; http: number; ready: boolean;
  revision?: string; sourceCount?: number; relationCount?: number; reused?: boolean; modelCalls?: number;
  inputTokens?: number | null; outputTokens?: number | null; buildMs?: number; error?: string };

async function scan(user: Session, image: File): Promise<ScanOut> {
  const form = new FormData(); form.set("image", image); form.set("captureSource", "phone_upload");
  const started = Date.now();
  const response = await user.call("/api/scans", { method: "POST", body: form });
  const text = await response.text();
  let lines: { type: string; message?: string; result?: ScanOut["result"] }[] = [];
  try { lines = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return { ms: Date.now() - started, stages: [], result: null, error: "garbled scan stream", http: response.status }; }
  const terminal = lines.at(-1);
  return { ms: Date.now() - started, http: response.status, stages: lines.filter((line) => !["result", "error"].includes(line.type)).map((line) => line.message ?? ""), result: terminal?.type === "result" ? terminal.result ?? null : null, error: terminal?.type === "error" ? terminal.message ?? "error" : terminal ? null : "stream ended without a terminal event" };
}
const demo = async (user: Session, method: "POST" | "DELETE", body?: object) => { const response = await user.call("/api/demo/context", { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); return { status: response.status, body: await response.json().catch(() => ({})) }; };

async function prepare(user: Session, phase: Preparation["phase"]): Promise<Preparation> {
  const started = Date.now();
  try {
    const response = await user.call("/api/context/prepare", { method: "POST" });
    const data = await response.json().catch(() => ({})) as Partial<Preparation>;
    return { phase, ms: Date.now() - started, http: response.status, ready: response.ok && data.ready === true,
      revision: data.revision, sourceCount: data.sourceCount, relationCount: data.relationCount,
      reused: data.reused, modelCalls: data.modelCalls, inputTokens: data.inputTokens,
      outputTokens: data.outputTokens, buildMs: data.buildMs, error: data.error };
  } catch (cause) {
    return { phase, ms: Date.now() - started, http: 0, ready: false,
      error: cause instanceof Error ? cause.message : "Preparation request failed." };
  }
}

async function main() {
  const { read } = flags(process.argv.slice(2));
  const app = (read("app") ?? process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const heroPath = read("hero"), nomatchPath = read("nomatch");
  const heroSource = read("hero-source") ?? "source not recorded", nomatchSource = read("nomatch-source") ?? "source not recorded";
  const person = read("person") ?? "maya", relation = read("relation") ?? "planned_together";
  const updateText = read("update-text"), updatePerson = read("update-person") ?? person, expectUpdate = read("expect-update");
  const runs = Number(read("runs") ?? "5");

  // Preflight: everything that can be checked before a paid call.
  const problems: string[] = [];
  if (!heroPath) problems.push("--hero <photo> is required");
  for (const path of [heroPath, nomatchPath].filter(Boolean) as string[]) {
    if (!MIME[path.slice(path.lastIndexOf(".")).toLowerCase()]) problems.push(`${path}: use .jpg, .png, or .webp`);
    else if (await access(path).then(() => false, () => true)) problems.push(`${path}: file not found`);
  }
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) problems.push("--runs must be an integer from 1 to 20");
  if (!(RELATIONS as readonly string[]).includes(relation)) problems.push(`--relation must be one of ${RELATIONS.join(", ")}`);
  if (updateText && !["preserved", "closed"].includes(expectUpdate ?? "")) problems.push("--update-text needs --expect-update preserved|closed");
  if (!updateText && expectUpdate) problems.push("--expect-update needs --update-text");
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DEMO_SCANNER_EMAIL", "DEMO_SCANNER_PASSWORD", "DEMO_RECIPIENT_EMAIL", "DEMO_RECIPIENT_PASSWORD"]) if (!process.env[name]) problems.push(`${name} missing from .env.local`);
  if (!problems.length && !(await reachable(app))) problems.push(`app not reachable at ${app}`);
  let scanner: Session | null = null, recipient: Session | null = null;
  if (!problems.length) {
    try { scanner = await session(app, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD")); recipient = await session(app, need("DEMO_RECIPIENT_EMAIL"), need("DEMO_RECIPIENT_PASSWORD")); }
    catch (error) { problems.push(error instanceof Error ? error.message : String(error)); }
  }
  if (!problems.length && updateText && (await demo(scanner!, "DELETE")).status !== 200) problems.push("demo reset refused: run the app with DEMO_MODE=true and DEMO_OWNER_ID set to the scanner");
  if (problems.length) throw new Error(`Preflight failed; no model calls were made:\n  - ${problems.join("\n  - ")}`);

  const hero = await photo(heroPath!);
  const { checks, check } = recorder();
  const preparations: Preparation[] = [];
  const prepareCurrent = async (phase: Preparation["phase"]) => {
    const outcome = await prepare(scanner!, phase);
    preparations.push(outcome);
    console.log(`Memory ${phase}: ${outcome.ready ? "ready" : "not ready"} in ${(outcome.ms / 1000).toFixed(1)}s; ${outcome.modelCalls ?? "?"} preparation model calls${outcome.error ? `; ${outcome.error}` : ""}.`);
    return outcome;
  };
  const results: { run: number; ok: boolean; failures: string[]; scanMs?: number; deliveryMs?: number; replyVisibleMs?: number }[] = [];
  const scanResults: NonNullable<ScanOut["result"]>[] = [];
  const trackedScan = async (image: File) => { const outcome = await scan(scanner!, image); if (outcome.result) scanResults.push(outcome.result); return outcome; };
  let firstScan: ScanOut["result"] = null;
  console.log(`App ${app} · scenario: ${person} / ${relation}${updateText ? ` · context update → ${expectUpdate}` : ""}`);
  console.log(`Images: hero ${resolve(heroPath!)} (${heroSource})${nomatchPath ? `; no-match ${resolve(nomatchPath)} (${nomatchSource})` : ""}. API upload, scripted replies.`);
  const initialMemory = await prepareCurrent("initial");
  check("prepared memory ready before first scan", initialMemory.ready, initialMemory.error ?? `HTTP ${initialMemory.http}; ${initialMemory.sourceCount ?? "?"} sources`);
  let currentMemoryReady = initialMemory.ready;

  for (let run = 1; initialMemory.ready && run <= runs; run++) {
    console.log(`Run ${run}/${runs}`);
    const failures: string[] = [];
    const must = (name: string, ok: boolean, detail = "") => { if (!check(name, ok, detail)) failures.push(name); return ok; };
    const record: (typeof results)[number] = { run, ok: false, failures };
    try {
      const scanned = await trackedScan(hero);
      record.scanMs = scanned.ms;
      const heroMatched = must("hero scan matched the expected person and relation", scanned.result?.status === "matched" && scanned.result.person === person && scanned.result.relation === relation, scanned.error ?? `HTTP ${scanned.http}; ${scanned.result?.status} ${scanned.result?.person ?? ""}/${scanned.result?.relation ?? ""} in ${(scanned.ms / 1000).toFixed(1)}s`);
      if (heroMatched) {
        firstScan ??= scanned.result;
        const quote = scanned.result!.evidence?.find((item) => item.shareableQuote);
        must("matched result has shareable cited evidence", Boolean(quote));
        const payload = { kind: "scan", scanId: scanned.result!.scanId, recipientId: scanned.result!.recipientId, body: `[scripted transport check ${run}] saw this and thought of you`, clientRequestId: crypto.randomUUID(), ...(quote ? { quotedSourceId: quote.id } : {}) };
        const sent = await post(scanner!, payload);
        if (must("send accepted", sent.status === 201, `HTTP ${sent.status} ${sent.body.error ?? ""}`)) {
          const delivered = await waitFor("message at recipient", async () => (await messagesOf(recipient!)).find((message) => message.id === sent.body.id)).catch(() => null);
          record.deliveryMs = delivered?.ms;
          must("recipient received it", Boolean(delivered), delivered ? `${delivered.ms} ms via API polling` : "not received");
          must("recipient sees the opted-in quote", Boolean(delivered?.value.quoted_text));
          const image = delivered?.value.imageUrl ? await fetch(delivered.value.imageUrl).catch(() => null) : null;
          must("recipient can open the shared photo", image?.ok === true, image ? `HTTP ${image.status}` : "no signed URL");
          must("identical retry returns the same message", (await post(scanner!, payload)).body.id === sent.body.id);
          must("same key with edited text is refused", (await post(scanner!, { ...payload, body: `${payload.body} (edited)` })).status === 409);
          const replied = await post(recipient!, { kind: "reply", replyTo: sent.body.id, body: `[scripted transport check ${run}] reply`, clientRequestId: crypto.randomUUID() });
          const back = replied.status === 201 ? await waitFor("reply at scanner", async () => (await messagesOf(scanner!)).find((message) => message.id === replied.body.id)).catch(() => null) : null;
          record.replyVisibleMs = back?.ms;
          must("scanner sees the reply", Boolean(back), back ? `${back.ms} ms via API polling` : `HTTP ${replied.status}`);
        }
      }
    } catch (error) { must(`run ${run} completed without errors`, false, error instanceof Error ? error.message : String(error)); }
    record.ok = failures.length === 0;
    results.push(record);
    if (run === 1 && !firstScan) { console.log("First hero scan failed; stopping before further model calls."); break; }
  }

  console.log("Context changes");
  if (updateText && firstScan) {
    let added = false;
    let cleared: Awaited<ReturnType<typeof demo>> | null = null;
    try {
      const response = await demo(scanner!, "POST", { speakerId: updatePerson, text: updateText });
      added = response.status === 201;
      check("synthetic update added", added, `HTTP ${response.status}`);
      if (added) {
        currentMemoryReady = false;
        const stale = await post(scanner!, { kind: "scan", scanId: firstScan.scanId, recipientId: firstScan.recipientId, body: "stale", clientRequestId: crypto.randomUUID() });
        check("a scan from before the update cannot be shared", stale.status === 409, stale.body.error ?? `HTTP ${stale.status}`);
        const updatedMemory = await prepareCurrent("after_update");
        currentMemoryReady = updatedMemory.ready;
        check("prepared memory includes the context update", updatedMemory.ready, updatedMemory.error ?? `HTTP ${updatedMemory.http}`);
        if (updatedMemory.ready) {
          const updated = await trackedScan(hero);
          const stillThere = updated.result?.status === "matched" && updated.result.person === person && updated.result.relation === relation;
          check(`after the update the connection is ${expectUpdate}`, updated.result !== null && (expectUpdate === "preserved" ? stillThere : !stillThere), updated.error ?? `${updated.result?.status} ${updated.result?.person ?? ""}/${updated.result?.relation ?? ""}; ${updated.stages.filter((stage) => stage.startsWith("Ruled out")).join(" ")}`);
        }
      }
    } catch (error) { check("context-change checks completed", false, error instanceof Error ? error.message : String(error)); }
    finally {
      cleared = await demo(scanner!, "DELETE").catch(() => null);
      currentMemoryReady = false;
      check("synthetic update cleared", cleared?.status === 200, cleared ? `HTTP ${cleared.status}` : "reset request failed");
    }
    if (cleared?.status === 200) {
      const restoredMemory = await prepareCurrent("after_reset");
      currentMemoryReady = restoredMemory.ready;
      check("prepared memory restored after reset", restoredMemory.ready, restoredMemory.error ?? `HTTP ${restoredMemory.http}`);
      if (added && restoredMemory.ready) {
        const restored = await trackedScan(hero);
        check("after reset the original connection returns", restored.result?.person === person && restored.result.relation === relation, `reset removed ${cleared.body.removed ?? "?"}; ${restored.result?.status} ${restored.result?.person ?? ""}`);
      }
    }
  } else if (updateText) check("context-change checks", false, "skipped: no successful hero scan");
  if (nomatchPath && firstScan && currentMemoryReady) {
    const none = await trackedScan(await photo(nomatchPath));
    check("unrelated object returns no match", none.result?.status === "no_match", none.error ?? `${none.result?.status} ${none.result?.person ?? ""}`);
  } else if (nomatchPath && firstScan) check("unrelated object returns no match", false, "skipped: prepared memory is not ready");

  const { complete, longest } = runSummary(results);
  const passed = checks.filter((item) => item.ok).length;
  const scanTimes = results.map((run) => run.scanMs).filter((ms): ms is number => typeof ms === "number").sort((a, b) => a - b);
  const pct = (p: number) => (scanTimes.length ? `${(scanTimes[Math.min(scanTimes.length - 1, Math.ceil((p / 100) * scanTimes.length) - 1)] / 1000).toFixed(1)}s` : "n/a");
  console.log(`\n${passed}/${checks.length} checks passed.`);
  console.log(`Complete runs: ${complete}/${runs} planned (${results.length} attempted). Longest consecutive streak: ${longest}. Scan time p50 ${pct(50)}, p95 ${pct(95)} (n=${scanTimes.length}).`);
  console.log("Replies here are scripted. A physical two-phone run with a typed reply is a separate check.");
  const observedModels = [...new Map(scanResults.flatMap((result) => result.model ? [[`${result.model.provider}/${result.model.model}`, result.model] as const] : [])).values()];
  const usage = scanResults.flatMap((result) => [result.usage?.vision, result.usage?.relations].filter((item): item is ModelUsage => Boolean(item)));
  const usageTotal = usage.length ? usage.reduce<{ inputTokens: number; outputTokens: number; totalTokens: number }>((total, item) => ({ inputTokens: total.inputTokens + item.inputTokens, outputTokens: total.outputTokens + item.outputTokens, totalTokens: total.totalTokens + (item.totalTokens ?? item.inputTokens + item.outputTokens) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 }) : null;
  const preparationModelCalls = preparations.reduce((sum, item) => sum + (item.modelCalls ?? 0), 0);
  const preparationMs = preparations.reduce((sum, item) => sum + item.ms, 0);
  console.log(`Model observed in scan results: ${observedModels.map((item) => `${item.provider}/${item.model}`).join(", ") || "unavailable"}.`);
  console.log(`Memory preparation: ${preparations.length} requests, ${(preparationMs / 1000).toFixed(1)}s total, ${preparationModelCalls} reported model calls. Scan times above exclude preparation.`);
  console.log(`Reported scan token usage: ${usageTotal ? `${usageTotal.inputTokens} input, ${usageTotal.outputTokens} output, ${usageTotal.totalTokens} total across ${usage.length} calls` : "unavailable"}; provider charges unavailable.`);
  const out = resolve("data/private/live", `live-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await mkdir(resolve("data/private/live"), { recursive: true });
  await writeFile(out, JSON.stringify({
    app, at: new Date().toISOString(),
    model: { observedModels, usage: usageTotal, usageCallCount: usage.length, scansWithUsage: scanResults.filter((result) => result.usage).length, totalCompletedScans: scanResults.length, cost: null, note: "Scan usage is separate from memory preparation. Provider charges are not reported; failed calls may incur unreported usage." },
    preparations: { attempts: preparations, totalMs: preparationMs, reportedModelCalls: preparationModelCalls },
    scans: scanResults.map((result) => ({ scanId: result.scanId, status: result.status, person: result.person, relation: result.relation, model: result.model, usage: result.usage })),
    provenance: { method: "API phone_upload; scripted message and reply transport", physicalPhoneVerified: false, hero: { path: resolve(heroPath!), source: heroSource }, ...(nomatchPath ? { noMatch: { path: resolve(nomatchPath), source: nomatchSource } } : {}) },
    scenario: { person, relation, contextUpdateApplied: Boolean(updateText), expectUpdate }, checks, runs: results, attemptedRuns: results.length, plannedRuns: runs, complete, longestStreak: longest,
  }, null, 2));
  console.log(`Saved ${out}`);
  process.exitCode = passed === checks.length ? 0 : 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
