// Real Chromium upload + CDP Network timing check against the deployed scanner.
// Requires DEMO_SCANNER_EMAIL and DEMO_SCANNER_PASSWORD in the process environment.
// Writes only sanitized timing/results to data/private/live; never records credentials, cookies, or quoted messages.
import { spawn } from "node:child_process";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createServerClient } from "@supabase/ssr";

const argument = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1]; };
const app = (argument("app", "https://callback-khaki-phi.vercel.app") ?? "").replace(/\/$/, "");
const folder = resolve(argument("dir", "fixtures/generated-live-photos"));
const manifest = resolve(argument("cases", join(folder, "cases.json")));
const chrome = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function publicConfig() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
  }
  // Both values are already public in the deployed client bundle. This avoids writing them to a local env file.
  const html = await (await fetch(`${app}/login`)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)/g)].map((match) => match[1]);
  for (const src of scripts) {
    const content = await (await fetch(new URL(src, app))).text();
    const url = content.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0];
    const key = content.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
    if (url && key) return { url, key };
  }
  throw new Error("Could not find public Supabase settings in the deployed client; set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
}

async function authCookies() {
  const email = process.env.DEMO_SCANNER_EMAIL, password = process.env.DEMO_SCANNER_PASSWORD;
  if (!email || !password) throw new Error("Set DEMO_SCANNER_EMAIL and DEMO_SCANNER_PASSWORD in the process environment.");
  const { url, key } = await publicConfig();
  const jar = new Map();
  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (items) => items.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Demo sign-in failed: ${error?.message ?? "no session"}`);
  return [...jar].map(([name, value]) => ({ name, value, url: app, secure: true }));
}

class CDP {
  constructor(socket) {
    this.socket = socket; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    socket.addEventListener("close", (event) => {
      for (const call of this.pending.values()) { clearTimeout(call.timer); call.reject(new Error(`Chrome DevTools closed during ${call.method} (${event.code}).`)); }
      this.pending.clear();
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const call = this.pending.get(message.id); this.pending.delete(message.id);
        if (call) clearTimeout(call.timer);
        if (message.error) call?.reject(new Error(`${call.method}: ${message.error.message}`));
        else call?.resolve(message.result ?? {});
      } else if (message.method) for (const fn of this.handlers.get(message.method) ?? []) fn(message.params);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chrome DevTools timed out on ${method}.`)); }, 15000);
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, fn) { const group = this.handlers.get(method) ?? new Set(); group.add(fn); this.handlers.set(method, group); return () => group.delete(fn); }
  async evaluate(expression) {
    const value = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.text);
    return value.result?.value;
  }
}

async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function launch() {
  if (!existsSync(chrome)) throw new Error(`Chrome executable missing: ${chrome}`);
  const parent = resolve("data/private"); await mkdir(parent, { recursive: true });
  const profile = await mkdtemp(join(parent, "chrome-perf-"));
  const child = spawn(chrome, ["--headless=new", "--disable-gpu", "--disable-software-rasterizer", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "about:blank"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let chromeError = "", exited = false;
  child.stderr.on("data", (chunk) => { chromeError = (chromeError + chunk.toString()).slice(-1000); });
  child.on("exit", () => { exited = true; });
  try {
    const port = await waitUntil(async () => {
      if (exited) throw new Error(`Chrome exited before DevTools started. ${chromeError}`);
      try { return Number((await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]); } catch { return 0; }
    }, 15000, "Chrome DevTools port");
    const target = await waitUntil(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`).catch(() => null);
      if (!response?.ok) return null;
      return (await response.json()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
    }, 10000, "Chrome page target");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await Promise.race([
      new Promise((resolveOpen, reject) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", reject, { once: true }); }),
      sleep(10000).then(() => { throw new Error(`Chrome DevTools WebSocket did not open. ${chromeError}`); }),
    ]);
    return { cdp: new CDP(socket), child, profile, socket };
  } catch (error) { child.kill(); throw error; }
}

function networkRecorder(cdp) {
  const records = new Map();
  cdp.on("Network.requestWillBeSent", (event) => {
    records.set(event.requestId, { id: event.requestId, url: event.request.url, method: event.request.method, start: event.timestamp, startWall: Date.now() });
    if (event.request.method === "POST" && new URL(event.request.url).pathname === "/api/scans") console.log(`  POST /api/scans started (${event.requestId}).`);
  });
  cdp.on("Network.responseReceived", (event) => { const row = records.get(event.requestId); if (row) { Object.assign(row, { status: event.response.status, headersAt: event.timestamp, timing: event.response.timing }); if (row.method === "POST" && new URL(row.url).pathname === "/api/scans") console.log(`  POST /api/scans headers: HTTP ${row.status}.`); } });
  cdp.on("Network.loadingFinished", (event) => { const row = records.get(event.requestId); if (row) { row.end = event.timestamp; if (row.method === "POST" && new URL(row.url).pathname === "/api/scans") console.log("  POST /api/scans complete."); } });
  cdp.on("Network.loadingFailed", (event) => { const row = records.get(event.requestId); if (row) { row.error = event.errorText; row.canceled = event.canceled; row.end = event.timestamp; if (row.method === "POST" && new URL(row.url).pathname === "/api/scans") console.log(`  POST /api/scans closed: ${event.errorText}, canceled=${event.canceled}.`); } });
  return records;
}

async function openScanner(cdp) {
  const loaded = new Promise((resolveLoad) => { const off = cdp.on("Page.loadEventFired", () => { off(); resolveLoad(); }); });
  await cdp.send("Page.navigate", { url: app });
  await Promise.race([loaded, sleep(20000).then(() => { throw new Error("Timed out waiting for page load."); })]);
  console.log("Live scanner page loaded; waiting for prepared memory.");
  await waitUntil(async () => (await cdp.evaluate("document.body.innerText")).includes("Memory ready"), 60000, "prepared relationship memory");
}

async function scanInBrowser(cdp, records, file, cookieHeader) {
  const document = await cdp.send("DOM.getDocument", { depth: 1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: document.root.nodeId, selector: 'input[type="file"]' });
  if (!nodeIds.length) throw new Error("No photo input was found in the live scanner.");
  const previousScanId = await cdp.evaluate('localStorage.getItem("callback-last-scan")');
  const selectedAt = Date.now();
  const done = new Promise((resolveDone, reject) => {
    let scanId;
    const offStart = cdp.on("Network.requestWillBeSent", (event) => {
      if (event.request.method === "POST" && new URL(event.request.url).pathname === "/api/scans") scanId = event.requestId;
    });
    const offEnd = cdp.on("Network.loadingFinished", (event) => {
      if (event.requestId !== scanId) return;
      offStart(); offEnd(); offFail(); resolveDone(records.get(scanId));
    });
    const offFail = cdp.on("Network.loadingFailed", (event) => {
      if (event.requestId !== scanId) return;
      offStart(); offEnd(); offFail();
      const row = records.get(scanId);
      if (row?.status === 200 && event.canceled) resolveDone(row); // The app cancels its reader after a terminal event.
      else reject(new Error(`Scan request failed: ${event.errorText}`));
    });
    setTimeout(() => { offStart(); offEnd(); offFail(); reject(new Error("Timed out waiting for browser scan request.")); }, 90000).unref();
  });
  await cdp.send("DOM.setFileInputFiles", { nodeId: nodeIds.at(-1), files: [file] });
  const request = await done;
  const content = await cdp.send("Network.getResponseBody", { requestId: request.id }).catch(() => null);
  const body = content ? content.base64Encoded ? Buffer.from(content.body, "base64").toString("utf8") : content.body : "";
  let events = body.trim().split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { type: "invalid" }; } });
  let terminal = events.at(-1);
  let result = terminal?.type === "result" ? terminal.result : null;
  if (!result && request.status === 200 && request.canceled) {
    const scanId = await waitUntil(async () => {
      const id = await cdp.evaluate('localStorage.getItem("callback-last-scan")');
      return id && id !== previousScanId ? id : null;
    }, 15000, "browser scan result");
    const saved = await fetch(`${app}/api/scans/${scanId}`, { headers: { cookie: cookieHeader } });
    if (!saved.ok) throw new Error(`Browser finished a scan, but restore returned HTTP ${saved.status}.`);
    const scan = (await saved.json()).scan;
    result = scan.result; events = scan.trace ?? [];
    terminal = events.findLast((event) => event.type === "result");
  }
  const ui = await waitUntil(async () => {
    const state = await cdp.evaluate("({ cardVisible: Boolean(document.querySelector('.card-match, .card-quiet')), relatedCaveatVisible: document.body.innerText.includes('Related taste, not a confirmed product match.') })");
    return state.cardVisible ? state : null;
  }, 5000, "rendered scan result card");
  const timing = request.timing ?? {};
  return {
    http: request.status, error: terminal?.type === "error" ? terminal.message : request.canceled && request.status === 200 ? null : request.error ?? null,
    observed: result?.observedEntity ?? null, status: result?.status ?? null, person: result?.person ?? null, relation: result?.relation ?? null, preferenceMatch: result?.preferenceMatch ?? null,
    model: result?.model ?? null, bytes: (await readFile(file)).length,
    browser: {
      beforeRequestMs: request.startWall - selectedAt,
      requestToHeadersMs: Math.round((request.headersAt - request.start) * 1000),
      uploadMs: timing.sendEnd >= timing.sendStart ? Math.round(timing.sendEnd - timing.sendStart) : null,
      responseStreamMs: Math.round((request.end - request.headersAt) * 1000),
      requestTotalMs: Math.round((request.end - request.start) * 1000),
    },
    ui,
    server: { ...(result?.timings ?? {}), elapsedMs: terminal?.elapsedMs ?? null },
    stages: events.filter((event) => event.elapsedMs !== undefined && event.type !== "result").map((event) => ({ type: event.type, elapsedMs: event.elapsedMs })),
  };
}

async function main() {
  const chosen = argument("case", "");
  const cases = JSON.parse(await readFile(manifest, "utf8")).cases.filter((item) => !chosen || item.file === chosen);
  if (!Array.isArray(cases) || !cases.length) throw new Error("No labeled photo cases found.");
  const grades = (item, outcome) => outcome.http === 200 && (!outcome.ui || outcome.ui.cardVisible && (item.preferenceMatch !== "related" || outcome.ui.relatedCaveatVisible)) &&
    (item.status === "observe" ? ["matched", "no_match"].includes(outcome.status)
      : outcome.status === item.status && (item.status !== "matched" || outcome.person === item.person && outcome.relation === item.relation && (!item.preferenceMatch || outcome.preferenceMatch === item.preferenceMatch)));
  if (process.argv.includes("--regrade")) {
    const previous = JSON.parse(await readFile(resolve(argument("regrade", "")), "utf8"));
    const cookies = await authCookies();
    const response = await fetch(`${app}/api/scans`, { headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") } });
    if (!response.ok) throw new Error(`Recent scans returned HTTP ${response.status}.`);
    const saved = (await response.json()).scans ?? [];
    const rows = previous.rows.map((row) => {
      const expected = cases.find((item) => item.file === row.file);
      const matching = saved.find((scan) => scan.result?.observedEntity === row.observed && scan.result?.status === row.status && scan.result?.person === row.person);
      const updated = { ...row, error: row.http === 200 && row.error === "net::ERR_ABORTED" ? null : row.error, preferenceMatch: matching?.result?.preferenceMatch ?? row.preferenceMatch ?? null };
      return { ...updated, expected: expected ?? row.expected, pass: expected ? grades(expected, updated) : row.pass };
    });
    const regraded = { ...previous, regradedAt: new Date().toISOString(), regradeNote: "Expected labels were reviewed after visually inspecting the real photos and checking the app's explicit related-taste policy; no new model scans were made.", rows };
    const output = resolve("data/private/live", `browser-perf-regraded-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(output, JSON.stringify(regraded, null, 2));
    console.log(`Regraded ${rows.length} saved scans without new model calls: ${rows.filter((row) => row.pass).length} pass, ${rows.filter((row) => !row.pass).length} fail. ${output}`);
    if (rows.some((row) => !row.pass)) process.exitCode = 1;
    return;
  }
  for (const item of cases) if (!existsSync(join(folder, item.file))) throw new Error(`Missing image: ${item.file}`);
  const cookies = await authCookies();
  const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  if (process.argv.includes("--recent")) {
    const response = await fetch(`${app}/api/scans`, { headers: { cookie: cookieHeader } });
    if (!response.ok) throw new Error(`Recent scans returned HTTP ${response.status}.`);
    const scans = (await response.json()).scans ?? [];
    console.log(JSON.stringify(scans.slice(0, Number(argument("limit", "10"))).map(({ result }) => ({ observed: result?.observedEntity, identification: result?.identification, memory: result?.memory, status: result?.status, person: result?.person, relation: result?.relation, preferenceMatch: result?.preferenceMatch, mention: result?.mention, reason: result?.reason, ruledOut: result?.ruledOut?.map((item) => ({ person: item.personId, code: item.code })) })), null, 2));
    return;
  }
  console.log("Demo authentication succeeded; starting instrumented Chrome.");
  const browser = await launch();
  try {
    const { cdp } = browser;
    await cdp.send("Page.enable"); await cdp.send("Runtime.enable"); await cdp.send("Network.enable");
    await cdp.send("Network.setCookies", { cookies });
    console.log("Chrome DevTools Network recording started.");
    const records = networkRecorder(cdp);
    const rows = [];
    for (const item of cases) {
      console.log(`Starting ${item.file}…`);
      await openScanner(cdp);
      let outcome;
      try { outcome = await scanInBrowser(cdp, records, join(folder, item.file), cookieHeader); }
      catch (error) {
        const state = await cdp.evaluate("({login: document.body.innerText.includes('Welcome back.'), memoryReady: document.body.innerText.includes('Memory ready'), scanError: document.body.innerText.includes('could not be completed'), reachError: document.body.innerText.includes(\"Couldn't reach\")})").catch(() => null);
        console.error(`  Page state after failure: ${JSON.stringify(state)}`);
        throw error;
      }
      const pass = grades(item, outcome);
      rows.push({ file: item.file, expected: item, pass, ...outcome });
      console.log(`${pass ? "PASS" : "FAIL"} ${item.file}: HTTP ${outcome.http}, ${outcome.status ?? outcome.error}, ${outcome.person ?? ""}/${outcome.relation ?? ""}; browser ${outcome.browser.requestTotalMs} ms, vision ${outcome.server.visionMs ?? "?"} ms`);
    }
    const appRequests = [...records.values()].filter((row) => row.url.startsWith(app) && row.end !== undefined)
      .map((row) => ({ path: new URL(row.url).pathname, method: row.method, status: row.status, ms: Math.round((row.end - row.start) * 1000) }))
      .sort((a, b) => b.ms - a.ms).slice(0, 15);
    const report = { at: new Date().toISOString(), app, provenance: argument("provenance", "Labeled local photos; actual Chrome uploads to the hosted site"), rows, slowestRequests: appRequests };
    const reportDir = resolve("data/private/live"); await mkdir(reportDir, { recursive: true });
    const reportPath = join(reportDir, `browser-perf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report: ${reportPath}`);
    if (rows.some((row) => !row.pass)) process.exitCode = 1;
  } finally {
    await browser.cdp.send("Browser.close").catch(() => browser.child.kill());
    browser.socket.close();
    if (browser.child.exitCode === null) await Promise.race([new Promise((done) => browser.child.once("exit", done)), sleep(5000)]);
    if (browser.child.exitCode === null) browser.child.kill();
    browser.child.stderr.destroy();
    browser.child.unref();
    if (dirname(resolve(browser.profile)) !== resolve("data/private")) throw new Error("Refusing to remove an unexpected Chrome profile path.");
    for (let attempt = 0; attempt < 20; attempt++) {
      try { await rm(browser.profile, { recursive: true, force: true }); break; }
      catch (error) { if (attempt === 19) console.error(`Could not remove temporary Chrome profile: ${error.message}`); else await sleep(500); }
    }
  }
}

await main().catch((error) => { console.error(error.message); process.exitCode = 1; });
