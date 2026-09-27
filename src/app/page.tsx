"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, type CaptureSource } from "@/components/camera";
import { Stages } from "@/components/stages";
import { Confidence, ConnectionCard, RuledOutList } from "@/components/connection";
import { Composer } from "@/components/composer";
import { Shopping } from "@/components/shopping";
import { GroupComposer } from "@/components/group-composer";
import { alertIncoming, unlockAlerts } from "@/lib/alert";
import { useInbox } from "@/lib/use-inbox";
import { readScanStream } from "@/lib/scan-client";
import { createScanLogger, logMemoryPreparation } from "@/lib/scan-logging";
import type { ScanResult, StageEvent } from "@/lib/scan-types";
import { captureLocation } from "@/lib/client-location";
import type { LocationProof } from "@/lib/location-proof";

type RecentScan = { id: string; created_at: string; capture_source: string; result: { observedEntity?: string; personName?: string; status?: string } };
const nearbyEnabled = process.env.NEXT_PUBLIC_ENABLE_PROXIMITY === "true";

// "vision muse-spark-1.1 · memory muse-spark-1.3" when the fast glance model differs from the memory model.
const modelLabel = (model: NonNullable<ScanResult["model"]>) => model.visionModel && model.visionModel !== model.model ? `vision ${model.visionModel} · memory ${model.model}` : model.model;

export default function Scanner() {
  const [memoryState, setMemoryState] = useState<"idle" | "preparing" | "ready" | "error">("idle");
  const [memoryNotice, setMemoryNotice] = useState("");
  const memoryRequired = useRef(false);
  const preparing = useRef(false);
  const prepareGeneration = useRef(0);
  const autoPrepareUser = useRef("");
  const memoryRevisionRef = useRef("");
  const [memoryRevision, setMemoryRevision] = useState("");
  const hoverCache = useRef(new Map<number, { result: ScanResult; file: File; source: CaptureSource; elapsedMs?: number; at: number }>());
  const requestAbort = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [captureMode, setCaptureMode] = useState<"manual" | "hover">("manual");
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [frozenUrl, setFrozenUrl] = useState("");
  const [runId, setRunId] = useState(0);
  const [completedMs, setCompletedMs] = useState<number | undefined>(undefined);
  // Only the newest scan or restore may update the screen; older in-flight work is ignored when it lands.
  const latestRun = useRef(0);
  const sceneGeneration = useRef(0);
  const [last, setLast] = useState<{ file: File; source: CaptureSource } | null>(null);
  const [retryCapture, setRetryCapture] = useState<{ file: File; source: CaptureSource } | null>(null);
  const [lastScanId, setLastScanId] = useState("");
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoSpeaker, setDemoSpeaker] = useState("maya");
  const [demoText, setDemoText] = useState("");
  const [demoNotice, setDemoNotice] = useState("");
  const [activeModel, setActiveModel] = useState<ScanResult["model"]>();
  const latestLocation = useRef<LocationProof | null>(null);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationNotice, setLocationNotice] = useState("");
  const inbox = useInbox(() => alertIncoming());
  const { messages, userId, refresh } = inbox;
  const messagesReady = !inbox.loading && !inbox.error;
  const restoreRef = useRef<(scanId: string) => Promise<void>>(async () => {});
  useEffect(() => { restoreRef.current = restore; });
  // Returning from checkout (/?scan=<id>) reopens the same scan, so the item and its evidence survive the redirect.
  useEffect(() => {
    const scanId = new URLSearchParams(window.location.search).get("scan");
    if (!scanId || !/^[0-9a-f-]{36}$/i.test(scanId)) return;
    const timer = setTimeout(() => { void restoreRef.current(scanId); }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!sharingLocation) return;
    let stopped = false;
    let refreshing = false;
    async function refreshPresence() {
      if (refreshing) return;
      refreshing = true;
      try {
        const proof = await captureLocation();
        if (stopped) return;
        const response = await fetch("/api/presence", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) });
        if (!stopped && response.ok) latestLocation.current = proof;
        if (stopped) void fetch("/api/presence", { method: "DELETE", keepalive: true }).catch(() => {});
      } catch { if (!stopped) latestLocation.current = null; }
      finally { refreshing = false; }
    }
    const timer = setInterval(refreshPresence, 60_000);
    return () => { stopped = true; clearInterval(timer); latestLocation.current = null; void fetch("/api/presence", { method: "DELETE", keepalive: true }).catch(() => {}); };
  }, [sharingLocation]);

  async function startLocationSharing() {
    setLocationBusy(true); setLocationNotice("");
    try {
      const proof = await captureLocation();
      const response = await fetch("/api/presence", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(proof) });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Could not start nearby sharing.");
      latestLocation.current = proof; setSharingLocation(true);
      setLocationNotice("Sharing while this page is open. Turn it off at any time.");
    } catch (cause) { setLocationNotice(cause instanceof Error ? cause.message : "Could not start nearby sharing."); }
    finally { setLocationBusy(false); }
  }

  function stopLocationSharing() {
    setSharingLocation(false); latestLocation.current = null;
    setLocationNotice("Nearby sharing stopped.");
  }

  useEffect(() => { if (!frozenUrl.startsWith("blob:")) return; return () => URL.revokeObjectURL(frozenUrl); }, [frozenUrl]);
  useEffect(() => {
    const timer = setTimeout(() => { try { setLastScanId(localStorage.getItem("callback-last-scan") ?? ""); } catch { /* storage unavailable */ } }, 0);
    fetch("/api/demo/context").then((response) => response.json()).then((data) => setDemoEnabled(Boolean(data.enabled))).catch(() => {});
    fetch("/api/model/config").then((response) => response.ok ? response.json() : null).then((data) => { if (data?.provider && data?.model) setActiveModel(data); }).catch(() => {});
    return () => clearTimeout(timer);
  }, []);

  const prepareMemory = useCallback(async (refresh = false) => {
    if (refresh) prepareGeneration.current++;
    const generation = prepareGeneration.current;
    // A context edit during an in-flight build invalidates its response and queues one fresh build.
    // Hover start and inbox polling do not start another paid preparation.
    if (preparing.current) return;
    preparing.current = true; setMemoryState("preparing"); setMemoryNotice("Preparing your shared plans and preferences…");
    const preparationStarted = performance.now();
    let preparationLogged = false;
    try {
      const response = await fetch("/api/context/prepare", { method: "POST" });
      const data = await response.json();
      logMemoryPreparation(data, performance.now() - preparationStarted, response.status);
      preparationLogged = true;
      if (generation !== prepareGeneration.current) return;
      if (!response.ok || !data.ready) throw new Error(data.error ?? "Import some approved context before scanning.");
      if (data.revision !== memoryRevisionRef.current) hoverCache.current.clear();
      memoryRevisionRef.current = data.revision;
      setMemoryRevision(data.revision); setMemoryState("ready");
      const retryReady = memoryRequired.current;
      memoryRequired.current = false;
      if (retryReady) setError("");
      setMemoryNotice(retryReady
        ? "Memory refreshed. Tap Scan this photo when you're ready, or point at something new."
        : `Memory ready${data.rejectedCount ? " (some context needed a verification retry)" : ""}. Scan or hold an item in view to find a connection.`);
    } catch (cause) {
      if (!preparationLogged) logMemoryPreparation(null, performance.now() - preparationStarted, 0);
      if (generation === prepareGeneration.current) { setMemoryState("error"); setMemoryNotice(cause instanceof Error ? cause.message : "Could not prepare memory."); }
    } finally {
      preparing.current = false;
      if (generation !== prepareGeneration.current) void prepareMemory();
    }
  }, []);

  useEffect(() => {
    if (!userId || inbox.loading || inbox.error || autoPrepareUser.current === userId) return;
    autoPrepareUser.current = userId;
    memoryRevisionRef.current = "";
    hoverCache.current.clear();
    setMemoryRevision("");
    void prepareMemory(true);
  }, [userId, inbox.loading, inbox.error, prepareMemory]);

  useEffect(() => () => requestAbort.current?.abort(), []);

  async function scan(file: File, source: CaptureSource, mode: "manual" | "hover" = "manual", viewId?: number) {
    const timingLog = createScanLogger({ mode, captureSource: source, imageBytes: file.size });
    unlockAlerts();
    requestAbort.current?.abort();
    const abort = new AbortController(); requestAbort.current = abort;
    setCaptureMode(mode);
    const scene = sceneGeneration.current;
    const run = ++latestRun.current;
    const current = () => run === latestRun.current;
    // A transient model/network failure must not erase the last usable connection and its
    // conversation. Snapshot it before showing the new capture and restore it on failure.
    const previous = { result, events, frozenUrl, completedMs, last, captureMode };
    const restorePrevious = (message: string) => {
      if (!current()) return;
      setError(previous.result ? `${message} Your previous connection is still open.` : message);
      if (!previous.result) return;
      setResult(previous.result); setEvents(previous.events); setCompletedMs(previous.completedMs);
      setLast(previous.last); setCaptureMode(previous.captureMode);
      setFrozenUrl(previous.frozenUrl.startsWith("blob:") && previous.last ? URL.createObjectURL(previous.last.file) : previous.frozenUrl);
    };
    setRetryCapture(null);
    setLast({ file, source });
    setFrozenUrl(URL.createObjectURL(file));
    setBusy(true); setEvents([]); setResult(null); setError(""); setCompletedMs(undefined); setRunId((id) => id + 1);
    const body = new FormData(); body.set("image", file); body.set("captureSource", source); body.set("mode", mode);
    try {
      if (sharingLocation) {
        let location = latestLocation.current;
        if (!location || Date.now() - Date.parse(location.capturedAt) > 60_000) try { location = await captureLocation(); latestLocation.current = location; } catch { location = null; }
        if (location) body.set("location", JSON.stringify(location));
      }
      timingLog.request();
      const response = await fetch("/api/scans", { method: "POST", body, signal: abort.signal });
      timingLog.response(response.status);
      // Paid inference is never retried automatically; an interrupted scan is reported and the user decides.
      const outcome = await readScanStream(response, (event) => { if (current()) setEvents((old) => [...old, event]); }, abort.signal, timingLog.event);
      timingLog.finish(outcome.kind);
      if (!current()) return false;
      if (outcome.kind === "result") {
        if (mode === "hover" && viewId !== undefined) {
          hoverCache.current.set(viewId, { result: outcome.result, file, source, elapsedMs: outcome.elapsedMs, at: Date.now() });
          while (hoverCache.current.size > 24) hoverCache.current.delete(hoverCache.current.keys().next().value!);
        }
        if (mode !== "hover" || scene === sceneGeneration.current) {
          setResult(outcome.result); setCompletedMs(outcome.elapsedMs);
        }
        if (outcome.result.persisted !== false) {
          try { localStorage.setItem("callback-last-scan", outcome.result.scanId); } catch { /* storage unavailable */ }
          setLastScanId(outcome.result.scanId);
        }
        return true;
      } else if (outcome.kind === "error") {
        restorePrevious(outcome.message);
        if (outcome.code === "memory_required") {
          // The server checked the current source revision. A client-side ready label may now be stale.
          memoryRequired.current = true;
          if (mode === "manual") setRetryCapture({ file, source });
          memoryRevisionRef.current = "";
          setMemoryRevision(""); hoverCache.current.clear(); setMemoryState("idle");
          void prepareMemory(true);
        }
      }
      return false;
    } catch { timingLog.finish(abort.signal.aborted ? "cancelled" : "error"); restorePrevious("Couldn't reach the server. Check the connection, then try again."); return false; }
    finally { if (current()) setBusy(false); }
  }

  function reset() { requestAbort.current?.abort(); latestRun.current++; setBusy(false); setFrozenUrl(""); setEvents([]); setResult(null); setError(""); setCompletedMs(undefined); setRetryCapture(null); }
  function clearHoverPreview() {
    if (captureMode === "hover" && !saving && (!result || result.persisted === false)) {
      sceneGeneration.current++;
      setResult(null); setEvents([]); setFrozenUrl(""); setCompletedMs(undefined);
    }
  }
  function revisit(viewId: number) {
    const cached = hoverCache.current.get(viewId);
    if (!cached || busy || saving || (result && result.persisted !== false)) return;
    if (Date.now() - cached.at > 9 * 60_000) {
      setMemoryNotice("That preview expired. Use Scan this for a fresh look."); return;
    }
    latestRun.current++;
    setCaptureMode("hover"); setResult(cached.result); setLast({ file: cached.file, source: cached.source });
    setFrozenUrl(URL.createObjectURL(cached.file)); setCompletedMs(cached.elapsedMs); setEvents([]); setError(""); setRunId((id) => id + 1);
  }
  async function openPreview() {
    if (!result?.previewToken || !last || saving) return;
    setSaving(true); setError("");
    const run = latestRun.current;
    try {
      const body = new FormData(); body.set("image", last.file); body.set("previewToken", result.previewToken);
      const response = await fetch("/api/scans/save", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not open this connection.");
      if (run !== latestRun.current) return;
      setResult(data.result); setLastScanId(data.result.scanId);
      try { localStorage.setItem("callback-last-scan", data.result.scanId); } catch { /* storage unavailable */ }
    } catch (cause) { if (run === latestRun.current) setError(cause instanceof Error ? cause.message : "Could not open this connection."); }
    finally { setSaving(false); }
  }
  function rescan() { if (last) void scan(last.file, last.source); }

  async function restore(scanId = lastScanId) {
    if (busy || saving) return;
    setCaptureMode("manual");
    const run = ++latestRun.current;
    try {
      const response = await fetch(`/api/scans/${scanId}`);
      const data = await response.json();
      if (run !== latestRun.current) return;
      if (!response.ok) {
        if (response.status === 409 || response.status === 404) { try { localStorage.removeItem("callback-last-scan"); } catch { /* storage unavailable */ } setLastScanId(""); }
        setError(data.error ?? "Could not restore scan."); return;
      }
      setLast(null);
      setResult(data.scan.result); setCompletedMs(data.scan.trace?.find((event: StageEvent) => event.type === "result")?.elapsedMs); setEvents((data.scan.trace ?? []).filter((event: StageEvent) => event.type !== "result")); setFrozenUrl(data.scan.imageUrl ?? ""); setError(""); setRunId((id) => id + 1); setLastScanId(scanId);
      try { localStorage.setItem("callback-last-scan", scanId); } catch { /* storage unavailable */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { if (run === latestRun.current) setError("Could not restore the scan."); }
  }
  async function loadRecentScans() {
    try {
      const response = await fetch("/api/scans");
      if (response.ok) setRecentScans((await response.json()).scans ?? []);
      else setError((await response.json()).error ?? "Could not load recent scans.");
    } catch { setError("Could not load recent scans."); }
  }
  async function resetDemo() {
    setDemoNotice("");
    try {
      const response = await fetch("/api/demo/context", { method: "DELETE" });
      const data = await response.json();
      if (response.ok) { reset(); void prepareMemory(true); }
      setDemoNotice(response.ok ? `Removed ${data.removed} demo update${data.removed === 1 ? "" : "s"}. Rescan to see the original context.` : data.error ?? "Could not reset.");
    } catch { setDemoNotice("Could not reset demo updates. Please retry."); }
  }
  async function addDemoContext() {
    setDemoNotice("");
    try {
      const response = await fetch("/api/demo/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ speakerId: demoSpeaker, text: demoText }) });
      const data = await response.json();
      if (!response.ok) setDemoNotice(data.error ?? "Could not add context.");
      else { reset(); void prepareMemory(true); setDemoNotice(last ? "Added. Rescan the same photo to see the change." : "Added. Scan again to use it."); setDemoText(""); }
    } catch { setDemoNotice("Could not add demo context. Please retry."); }
  }

  const preview = result?.persisted === false;
  const selectedResult = result && !preview ? result : null;
  const idle = !busy && !result && !error && !events.length;
  return <main className="app">
    <header className="appbar"><Link href="/" className="brand">↗ callback<span>.</span></Link><nav><Link href="/ar">AR camera</Link><Link href="/inbox">Inbox</Link><Link href="/login">Account</Link></nav></header>
    {(result?.model ?? activeModel) && <p className="fine-print" aria-label="AI provider">{(result?.model ?? activeModel)!.provider === "openai" ? "Testing with OpenAI" : "Powered by Meta"} · {modelLabel((result?.model ?? activeModel)!)}</p>}
    {(idle || (captureMode === "hover" && !selectedResult)) && <p className="prompt">Point at something—or somewhere.<br /><em>Remember who you wanted to share it with.</em></p>}
    <Camera frozenUrl={frozenUrl} busy={busy || saving} onCapture={scan} onError={setError}
      hoverRevision={memoryRevision} onRevisit={revisit} hoverReady={memoryState === "ready"} hoverBlocked={Boolean(selectedResult) || saving || Boolean(error)}
      onHoverStart={() => { if (memoryState === "idle") void prepareMemory(); }} onSceneChange={clearHoverPreview}>
      {preview && result && <div className="hover-result" role="status">
        <span className="eyebrow">{result.observedEntity}</span>
        {result.status === "matched" ? <button onClick={() => void openPreview()} disabled={saving} className="hover-connection">
          <strong>↗ {result.personName}</strong><span>{result.reason}</span><small>{saving ? "Opening…" : "Tap to open this connection"}</small>
        </button> : result.status === "needs_clarification" ? <p>Get closer to the title or model label.</p> : <button className="hover-connection" disabled={saving} onClick={() => void openPreview()}>
          <strong>{result.advice?.length ? `Ask ${result.advice[0].personName}` : "No remembered connection"}</strong><small>Tap to explore the item</small>
        </button>}
        <small>Unsaved preview · tap saves the photo · nothing sends automatically</small>
      </div>}
    </Camera>
    {memoryNotice && <p className="fine-print" role="status">{memoryNotice}{memoryState !== "preparing" && <button className="text-button" onClick={() => void prepareMemory(true)}>{memoryState === "error" ? "Retry preparing" : "Refresh memory"}</button>}</p>}
    <Stages events={events} busy={busy} collapsed={Boolean(result)} completedMs={completedMs} />
    {error && <p className="error" role="alert">{error}</p>}
    {selectedResult && <ConnectionCard key={`card-${runId}`} result={selectedResult} />}
    {selectedResult && selectedResult.persisted !== false && selectedResult.entityKind !== "place" && <p className="actions">
      <Link className="text-button" href={`/glasses?scan=${encodeURIComponent(selectedResult.scanId)}`}>View this scan in AR</Link>
    </p>}
    {inbox.error && result && <p className="error" role="alert">{inbox.error} <button className="text-button" onClick={() => void refresh()}>Refresh conversation</button></p>}
    {selectedResult?.status === "matched" && (selectedResult.people?.length ?? 0) > 1 ? <GroupComposer key={`group-${runId}`} result={selectedResult} refresh={refresh} /> : selectedResult?.status === "matched" && <Composer key={`composer-${runId}`} result={selectedResult} messages={messages} userId={userId} messagesReady={messagesReady} refresh={refresh} />}
    {selectedResult && <Confidence key={`confidence-${runId}`} result={selectedResult} />}
    {selectedResult && <RuledOutList key={`ruled-${runId}`} result={selectedResult} />}
    {selectedResult && selectedResult.entityKind !== "place" && selectedResult.status !== "needs_clarification" && <Shopping key={`shop-${runId}`} result={selectedResult} messages={messages} userId={userId} messagesReady={messagesReady} refresh={refresh} />}
    {!busy && !saving && (result || error || frozenUrl || retryCapture) && <div className="actions">
      <button className="secondary" onClick={reset}>Scan something else</button>
      {retryCapture && memoryState === "ready" && <button className="secondary" onClick={() => void scan(retryCapture.file, retryCapture.source)}>Scan this photo</button>}
      {last && !retryCapture && <button className="secondary" onClick={rescan}>{preview ? "Scan and save this photo" : "Rescan this photo"}</button>}
    </div>}
    <footer className="app-footer">
      {nearbyEnabled && <div className="footer-links">
        <button className="text-button" disabled={locationBusy} onClick={() => sharingLocation ? stopLocationSharing() : void startLocationSharing()}>{locationBusy ? "Starting nearby sharing…" : sharingLocation ? "Stop sharing my location" : "Share my location for nearby callbacks"}</button>
        <p className="fine-print">Off by default. If you choose to share, matched contacts who also share may see a nearby signal. Nearby visibility expires after ten minutes and is refreshed only while this page stays open.</p>
        {locationNotice && <p role="status" className="fine-print">{locationNotice}</p>}
      </div>}
      <div className="footer-links">
        {lastScanId && <button className="text-button" disabled={busy || saving} onClick={() => restore()}>Restore last scan</button>}
        <button className="text-button" disabled={busy || saving} onClick={loadRecentScans}>Recent scans</button>
        <Link href="/devices" className="text-button">Devices</Link>
      </div>
      {recentScans.length > 0 && <div className="recent-scans">{recentScans.map((item) => <button key={item.id} className="text-button" disabled={busy || saving} onClick={() => restore(item.id)}>{item.capture_source === "quest" ? "Quest" : item.capture_source === "glasses" ? "Glasses" : "Phone"} · {item.result?.observedEntity || "Scan"}{item.result?.personName ? ` → ${item.result.personName}` : ""} · {new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</button>)}</div>}
      {demoEnabled && <details className="demo-panel">
        <summary>Demo controls</summary>
        <p className="fine-print">Adds a new, clearly labeled synthetic message from the chosen person. It never edits an old message.</p>
        <label>Person ID<input value={demoSpeaker} onChange={(event) => setDemoSpeaker(event.target.value)} /></label>
        <label>New message<textarea value={demoText} onChange={(event) => setDemoText(event.target.value)} placeholder="I bought the X100V last week." /></label>
        <button className="send" disabled={!demoSpeaker.trim() || !demoText.trim()} onClick={addDemoContext}>Add synthetic message</button>
        <button className="secondary demo-reset" onClick={resetDemo}>Reset demo updates</button>
        {demoNotice && <p role="status" className="fine-print">{demoNotice}</p>}
      </details>}
      <p className="fine-print">Your messages stay private. Nothing is sent unless you tap Send.</p>
    </footer>
  </main>;
}
