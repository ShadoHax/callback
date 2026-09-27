// Live acceptance for prepared memory and unsaved hover previews. This uses real inference and
// sends one scripted message/reply. Run only after explicitly approving the target and photo:
// npm run hover:check -- --hero war-and-peace.png --hero-source "where the image came from" [--person maya --relation inspired] [--app http://localhost:3000] [--nomatch bottle.png --nomatch-source "…"] [--shop]
// For the coffee (V3) scan: --hero coffee.png --relation prefers --shop
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MIME, flags, messagesOf, need, photo, post, reachable, recorder, service, session, waitFor, type Session } from "./lib/live";

import type { ScanResult } from "../src/lib/scan-types";

type Usage = { inputTokens: number; outputTokens: number; totalTokens?: number };
type Preview = { scanId: string; status: string; person?: string; relation?: string; recipientId?: string | null; persisted?: boolean; previewToken?: string; relationsMs?: number; timings?: ScanResult["timings"]; usage?: { vision?: Usage; relations?: Usage }; evidence?: { id: string; shareableQuote?: boolean }[]; model?: { provider: string; model: string } };
type ScanOut = { http: number; ms: number; serverElapsedMs?: number; result: Preview | null; error: string | null };
type Prepare = { ready?: boolean; reused?: boolean; modelCalls?: number; revision?: string; sourceCount?: number; relationCount?: number; inputTokens?: number; outputTokens?: number; error?: string };

async function prepare(user: Session) {
  const response = await user.call("/api/context/prepare", { method: "POST" });
  return { status: response.status, data: await response.json().catch(() => ({})) as Prepare };
}
async function hover(user: Session, image: File): Promise<ScanOut> {
  const form = new FormData(); form.set("image", image); form.set("captureSource", "phone_camera"); form.set("mode", "hover");
  const started = Date.now();
  const response = await user.call("/api/scans", { method: "POST", body: form });
  try {
    const lines = (await response.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { type: string; message?: string; result?: Preview; elapsedMs?: number });
    const last = lines.at(-1);
    return { http: response.status, ms: Date.now() - started, serverElapsedMs: last?.elapsedMs, result: last?.type === "result" ? last.result ?? null : null, error: last?.type === "error" ? last.message ?? "scan error" : last?.type === "result" ? null : "missing terminal result" };
  } catch { return { http: response.status, ms: Date.now() - started, result: null, error: "invalid scan stream" }; }
}
async function saved(user: Session, scanId: string) {
  const response = await user.call(`/api/scans/${scanId}`);
  return { status: response.status, data: response.ok ? await response.json() as { scan?: { result?: Preview } } : null };
}
async function storageCount(ownerId: string, scanId: string): Promise<number | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data, error } = await service().storage.from("scan-images").list(ownerId, { limit: 100, search: scanId });
  if (error) return null;
  return (data ?? []).filter((item) => item.name.startsWith(scanId)).length;
}
const toForm = (image: File, previewToken: string) => { const body = new FormData(); body.set("image", image); body.set("previewToken", previewToken); return body; };
const usageTotals = (items: Usage[]) => items.reduce<{ inputTokens: number; outputTokens: number; totalTokens: number }>((sum, item) => ({ inputTokens: sum.inputTokens + item.inputTokens, outputTokens: sum.outputTokens + item.outputTokens, totalTokens: sum.totalTokens + (item.totalTokens ?? item.inputTokens + item.outputTokens) }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });

async function main() {
  const { read, has } = flags(process.argv.slice(2));
  const app = (read("app") ?? "http://localhost:3000").replace(/\/$/, "");
  const heroPath = read("hero"), heroSource = read("hero-source"), noMatchPath = read("nomatch"), noMatchSource = read("nomatch-source");
  // Expected result for the hero photo (default: the M1 demo, a book that recalls Maya's writing ambition).
  const person = read("person") ?? "maya", relation = read("relation") ?? "inspired";
  const problems: string[] = [];
  if (!heroPath) problems.push("--hero must point to the hero photo (e.g. the War and Peace cover)");
  if (!heroSource?.trim()) problems.push("--hero-source provenance is required");
  if (noMatchPath && !noMatchSource?.trim()) problems.push("--nomatch-source is required when --nomatch is set");
  for (const path of [heroPath, noMatchPath].filter(Boolean) as string[]) {
    if (!MIME[path.slice(path.lastIndexOf(".")).toLowerCase()]) problems.push(`${path}: use .jpg, .png, or .webp`);
    if (await access(path).then(() => false, () => true)) problems.push(`${path}: file not found`);
  }
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "DEMO_SCANNER_EMAIL", "DEMO_SCANNER_PASSWORD", "DEMO_RECIPIENT_EMAIL", "DEMO_RECIPIENT_PASSWORD"]) if (!process.env[name]) problems.push(`${name} missing from .env.local`);
  if (!problems.length && !(await reachable(app))) problems.push(`app not reachable at ${app}`);
  if (problems.length) throw new Error(`Preflight failed before any model calls:\n  - ${problems.join("\n  - ")}`);
  const image = await photo(heroPath!);
  const noMatchImage = noMatchPath ? await photo(noMatchPath) : null;
  if ([image, noMatchImage].filter(Boolean).some((item) => !item || item.size === 0 || item.size > 8 * 1024 * 1024)) throw new Error("Preflight failed: photos must be nonempty and under 8 MB. No model calls were made.");

  // A hero scan plus the optional no-match are the only vision calls this script can make (maximum two).
  const scanner = await session(app, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD")).catch(() => { throw new Error("Scanner sign-in failed."); });
  const recipient = await session(app, need("DEMO_RECIPIENT_EMAIL"), need("DEMO_RECIPIENT_PASSWORD")).catch(() => { throw new Error("Recipient sign-in failed."); });
  const { checks, check } = recorder();
  const observed: { status: string; person?: string; relation?: string; ms: number; serverElapsedMs?: number; timings?: Preview["timings"]; model?: Preview["model"]; usage?: Preview["usage"] }[] = [];
  const first = await prepare(scanner);
  check("memory prepared", first.status === 200 && first.data.ready === true, `HTTP ${first.status}; ${first.data.error ?? `${first.data.sourceCount ?? 0} sources, ${first.data.relationCount ?? 0} relations, ${first.data.modelCalls ?? "?"} model calls`}`);
  if (first.status !== 200 || !first.data.ready) throw new Error("Memory was not ready; no vision calls were made.");
  const second = await prepare(scanner);
  const reused = second.status === 200 && second.data.reused === true && second.data.modelCalls === 0 && second.data.revision === first.data.revision;
  check("second preparation reused memory with zero model calls", reused, `HTTP ${second.status}; reused=${second.data.reused}; calls=${second.data.modelCalls}`);
  if (!reused) throw new Error("Memory reuse failed; no vision calls were made.");
  const otherIndex = await recipient.direct.from("context_indexes").select("owner_id").eq("owner_id", scanner.id).limit(1);
  const privateIndex = !otherIndex.error && (otherIndex.data ?? []).length === 0;
  check("recipient cannot read scanner's prepared memory", privateIndex);
  if (!privateIndex) throw new Error("Prepared memory access check failed; no vision calls were made.");

  const hero = await hover(scanner, image);
  if (hero.result) observed.push({ status: hero.result.status, person: hero.result.person, relation: hero.result.relation, ms: hero.ms, serverElapsedMs: hero.serverElapsedMs, timings: hero.result.timings, model: hero.result.model, usage: hero.result.usage });
  const preview = hero.result;
  const heroMatches = hero.http === 200 && preview?.status === "matched" && preview.person === person && preview.relation === relation;
  check(`hover recognized ${person} (${relation})`, heroMatches, `HTTP ${hero.http}; ${preview?.status ?? hero.error ?? "no result"} ${preview?.person ?? ""}/${preview?.relation ?? ""}; ${hero.ms} ms`);
  check("hover used prepared relations", preview?.timings?.relationsMs === 0 && !preview.usage?.relations, `relationsMs=${preview?.timings?.relationsMs ?? "?"}; relation usage=${Boolean(preview?.usage?.relations)}`);
  check("preview is unsaved and has a signed receipt", preview?.persisted === false && Boolean(preview.previewToken));
  if (!heroMatches || !preview?.previewToken) {
    const out = resolve("data/private/live", `hover-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await mkdir(resolve("data/private/live"), { recursive: true });
    await writeFile(out, JSON.stringify({ app, at: new Date().toISOString(), stoppedBeforeSave: true,
      provenance: { hero: { path: resolve(heroPath!), source: heroSource } },
      preparation: { first: { modelCalls: first.data.modelCalls, sourceCount: first.data.sourceCount, relationCount: first.data.relationCount, inputTokens: first.data.inputTokens, outputTokens: first.data.outputTokens }, second: { reused: second.data.reused, modelCalls: second.data.modelCalls, inputTokens: second.data.inputTokens, outputTokens: second.data.outputTokens } },
      scans: observed, checks, usage: { preparation: { inputTokens: (first.data.inputTokens ?? 0) + (second.data.inputTokens ?? 0), outputTokens: (first.data.outputTokens ?? 0) + (second.data.outputTokens ?? 0) }, vision: usageTotals(observed.flatMap((item) => item.usage?.vision ? [item.usage.vision] : [])), providerCharges: null } }, null, 2));
    console.log(`Sanitized partial report: ${out}`);
    throw new Error("Expected preview was not available; save and messaging checks stopped.");
  }
  check("preview has no saved scan", (await saved(scanner, preview.scanId)).status === 404);
  const beforeObjects = await storageCount(scanner.id, preview.scanId);
  if (beforeObjects !== null) check("preview has no stored photo", beforeObjects === 0, `${beforeObjects} objects`);
  else console.log("  · Photo-prefix check unavailable without service-role storage access.");

  const [a, b] = await Promise.all([scanner.call("/api/scans/save", { method: "POST", body: toForm(image, preview.previewToken) }), scanner.call("/api/scans/save", { method: "POST", body: toForm(image, preview.previewToken) })]);
  const [savedA, savedB] = await Promise.all([a.json().catch(() => ({})) as Promise<{ result?: Preview }>, b.json().catch(() => ({})) as Promise<{ result?: Preview }>]);
  check("concurrent opens save one scan", [a.status, b.status].every((status) => status === 200 || status === 201) && savedA.result?.scanId === preview.scanId && savedB.result?.scanId === preview.scanId, `HTTP ${a.status}/${b.status}`);
  const restored = await saved(scanner, preview.scanId);
  check("saved scan can be reopened", restored.status === 200 && restored.data?.scan?.result?.scanId === preview.scanId && restored.data.scan.result.persisted === true, `HTTP ${restored.status}`);
  const afterObjects = await storageCount(scanner.id, preview.scanId);
  if (afterObjects !== null) check("one photo remains after concurrent save", afterObjects === 1, `${afterObjects} objects`);

  if (restored.status === 200 && preview.recipientId === recipient.id) {
    const quote = preview.evidence?.find((item) => item.shareableQuote);
    const sent = await post(scanner, { kind: "scan", scanId: preview.scanId, recipientId: preview.recipientId, body: "[scripted hover check] Saw this and thought of you. How's it going?", clientRequestId: crypto.randomUUID(), ...(quote ? { quotedSourceId: quote.id } : {}) });
    check("scripted invitation sent", sent.status === 201, `HTTP ${sent.status}`);
    if (sent.status === 201) {
      const incoming = await waitFor("recipient message", async () => (await messagesOf(recipient)).find((item) => item.id === sent.body.id)).catch(() => null);
      check("recipient received invitation", Boolean(incoming), incoming ? `${incoming.ms} ms via API polling` : "not received");
      const reply = await post(recipient, { kind: "reply", replyTo: sent.body.id, body: "[scripted hover check] Yes, let's pick a day.", clientRequestId: crypto.randomUUID() });
      const back = reply.status === 201 ? await waitFor("scanner reply", async () => (await messagesOf(scanner)).find((item) => item.id === reply.body.id)).catch(() => null) : null;
      check("scanner received scripted reply", Boolean(back), `HTTP ${reply.status}${back ? `; ${back.ms} ms via API polling` : ""}`);
    }
  } else check("linked recipient available for scripted exchange", false);

  if (has("shop")) {
    const response = await scanner.call("/api/shop/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scanId: preview.scanId, budgetCents: 2500, purpose: { kind: relation === "planned_together" ? "together" : "gift", personId: person } }) });
    const options = response.ok ? await response.json() as { options?: object[] } : null;
    check("shopping options returned without a quote", response.status === 200 && Array.isArray(options?.options), `HTTP ${response.status}; ${options?.options?.length ?? 0} options`);
  }
  if (noMatchPath) {
    const none = await hover(scanner, noMatchImage!);
    if (none.result) observed.push({ status: none.result.status, person: none.result.person, relation: none.result.relation, ms: none.ms, serverElapsedMs: none.serverElapsedMs, timings: none.result.timings, model: none.result.model, usage: none.result.usage });
    check("unrelated item has no supported match", none.http === 200 && none.result?.status === "no_match", `HTTP ${none.http}; ${none.result?.status ?? none.error ?? "no result"}`);
  }

  const passed = checks.filter((item) => item.ok).length;
  const visionUsage = usageTotals(observed.flatMap((item) => item.usage?.vision ? [item.usage.vision] : []));
  const preparationUsage = { inputTokens: (first.data.inputTokens ?? 0) + (second.data.inputTokens ?? 0), outputTokens: (first.data.outputTokens ?? 0) + (second.data.outputTokens ?? 0) };
  console.log(`\n${passed}/${checks.length} checks passed. ${observed.length} vision calls completed (maximum 2). Preparation: ${first.data.modelCalls ?? 0} model calls, ${preparationUsage.inputTokens} input/${preparationUsage.outputTokens} output tokens. Vision: ${visionUsage.inputTokens} input/${visionUsage.outputTokens} output tokens. Replies are scripted; no physical-phone timing was measured.`);
  const out = resolve("data/private/live", `hover-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await mkdir(resolve("data/private/live"), { recursive: true });
  await writeFile(out, JSON.stringify({ app, at: new Date().toISOString(), provenance: { hero: { path: resolve(heroPath!), source: heroSource }, ...(noMatchPath ? { noMatch: { path: resolve(noMatchPath), source: noMatchSource } } : {}) }, preparation: { first: { ready: first.data.ready, reused: first.data.reused, modelCalls: first.data.modelCalls, sourceCount: first.data.sourceCount, relationCount: first.data.relationCount, inputTokens: first.data.inputTokens, outputTokens: first.data.outputTokens }, second: { reused: second.data.reused, modelCalls: second.data.modelCalls, inputTokens: second.data.inputTokens, outputTokens: second.data.outputTokens } }, scans: observed, usage: { preparation: preparationUsage, vision: visionUsage, providerCharges: null }, checks, scriptedReply: true, shoppingChecked: has("shop") }, null, 2));
  console.log(`Sanitized report: ${out}`);
  process.exitCode = passed === checks.length ? 0 : 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Hover check failed."); process.exitCode = 1; });
