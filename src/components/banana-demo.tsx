"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { GrocerReceipt } from "@/components/ar/grocer-receipt";
import { GrocerCheckout } from "@/components/ar/grocer-checkout";
import type { GrocerCart } from "@/lib/ar-grocer-cart";
import { TargetAR } from "@/components/ar/target-ar";
import styles from "./banana-demo.module.css";

type ActionKind = "recipe" | "shop" | "nearby" | "plan";
type SuggestedAction = { kind: ActionKind; label: string };
type Memory = { personName: string; quote: string; shortLabel?: string; suggestedActions?: SuggestedAction[]; sourceAt: string | null; synthetic: boolean; connection: string };
type Scan = { detected: true; identification: { item: string; confidence: number; visibleText?: string[]; boundingBox?: { x: number; y: number; width: number; height: number } | null }; memory?: Memory; memoryStatus?: string; connectionToken?: string };
type Offer = { id: string; title: string; merchant: string; merchantUrl: string; price: { amountCents: number; currency: string; observedAt: string }; caveats?: string[] };
type Ingredient = { kind?: "ingredient" | "equipment"; query: string; quantity: number; reason: string; offers: Offer[]; fallbackSearchUrl: string; status: string; provider: string | null };
type Shopping = { carts?: GrocerCart[]; ingredients: Ingredient[]; allIngredientsHaveOffers: boolean };
type NearbyPlace = { name: string; address?: string; url: string; summary?: string };
type Nearby = { query: string; url: string; locationLabel: string; usedFallback: boolean; places: NearbyPlace[]; summary?: string };
type Activity = { supported: boolean; action: ActionKind; reason?: string; shoppingNote?: string; plan?: { title: string; summary: string; steps: string[]; invitation: string }; nearby?: Nearby; shopping?: Shopping };
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
function dateLabel(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
function mapsSearchUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "www.google.com" || url.hostname === "google.com") && url.pathname.startsWith("/maps/search/") ? url.href : null;
  } catch { return null; }
}
function sourceUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function nearbyLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    let settled = false;
    const finish = (location: { latitude: number; longitude: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(location);
    };
    const timer = setTimeout(() => finish(null), 8000);
    try {
      navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        finish(Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
          ? { latitude, longitude } : null);
      }, () => finish(null), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 });
    } catch { finish(null); }
  });
}
async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (${response.status}).`);
  return data;
}

export function ARDemo() {
  const [preparing, setPreparing] = useState(true);
  const [scan, setScan] = useState<Scan | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionKind | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionKind | null>(null);
  const [resolvingLocation, setResolvingLocation] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [error, setError] = useState("");
  const preparationDone = useRef(false);
  const scanBusy = useRef(false);
  const pendingFrame = useRef<File | null>(null);
  const latestFrame = useRef<File | null>(null);
  const confirmedView = useRef(false);
  const drawerOpenRef = useRef(false);
  const lostWhileOpen = useRef(false);
  const epoch = useRef(0);
  const requestSeq = useRef(0);
  const activitySeq = useRef(0);
  const scanAbort = useRef<AbortController | null>(null);
  const activityAbort = useRef<AbortController | null>(null);

  const invalidate = useCallback(() => {
    epoch.current++; requestSeq.current++; activitySeq.current++;
    scanAbort.current?.abort(); activityAbort.current?.abort();
    scanAbort.current = null; activityAbort.current = null;
    scanBusy.current = false; confirmedView.current = false; lostWhileOpen.current = false;
    setScanning(false); setPendingAction(null); setResolvingLocation(false); setSelectedAction(null); setActivityError(""); setScan(null); setActivity(null); setError("");
  }, []);

  const scanFrame = useCallback(async (frame: File, frameEpoch: number) => {
    latestFrame.current = frame; setHasFrame(true);
    if (scanBusy.current || confirmedView.current) return;
    if (!preparationDone.current) { pendingFrame.current = frame; return; }
    scanBusy.current = true;
    const requestId = ++requestSeq.current;
    const controller = new AbortController(); scanAbort.current = controller;
    setScanning(true); setError("");
    const started = performance.now();
    console.info("[Callback AR] scan start", JSON.stringify({ requestId, imageBytes: frame.size }));
    try {
      const form = new FormData(); form.set("image", frame);
      const result = await responseJson(await fetch("/api/demo/ar/scan", { method: "POST", body: form, signal: controller.signal }));
      if (frameEpoch !== epoch.current || controller.signal.aborted) return;
      console.info("[Callback AR] vision", JSON.stringify({ requestId, roundTripMs: Math.round(performance.now() - started), serverMs: result.timingMs, verificationMs: result.verificationMs, matched: result.matched, diagnostics: result.visionDiagnostics }));
      if (result.detected === true && typeof result.identification?.item === "string") {
        confirmedView.current = true; setScan(result as Scan); return true;
      }
      return false;
    } catch (cause) {
      if (frameEpoch === epoch.current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not check this frame. Try another view.");
    } finally {
      console.info("[Callback AR] scan end", JSON.stringify({ requestId, aborted: controller.signal.aborted, ms: Math.round(performance.now() - started) }));
      if (requestSeq.current === requestId) { scanBusy.current = false; scanAbort.current = null; if (frameEpoch === epoch.current) setScanning(false); }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const started = performance.now();
      try {
        const response = await fetch("/api/context/prepare", { method: "POST", signal: controller.signal });
        const data = await response.json();
        if (!controller.signal.aborted) console.info("[Callback AR] saved memory", { ready: Boolean(response.ok && data.ready), ms: Math.round(performance.now() - started) });
      } catch { /* Recognition remains available when no prepared private context exists. */ }
      if (controller.signal.aborted) return;
      preparationDone.current = true; setPreparing(false);
      if (pendingFrame.current) { const frame = pendingFrame.current; pendingFrame.current = null; void scanFrame(frame, epoch.current); }
    })();
    return () => { controller.abort(); scanAbort.current?.abort(); activityAbort.current?.abort(); };
  }, [scanFrame]);

  const onDetectedFrame = useCallback(async (blob: Blob) => {
    if (drawerOpenRef.current || scanBusy.current || confirmedView.current) return;
    return await scanFrame(new File([blob], "camera-frame.jpg", { type: "image/jpeg" }), epoch.current);
  }, [scanFrame]);
  const onTargetLost = useCallback(() => {
    if (drawerOpenRef.current) lostWhileOpen.current = true;
    else { pendingFrame.current = null; latestFrame.current = null; setHasFrame(false); invalidate(); }
  }, [invalidate]);
  const onPhotoSelected = useCallback((file: File) => {
    invalidate(); drawerOpenRef.current = false; setDrawerOpen(false); pendingFrame.current = null;
    void scanFrame(file, epoch.current);
  }, [invalidate, scanFrame]);
  const retryVision = useCallback(() => { if (latestFrame.current && !scanBusy.current) void scanFrame(latestFrame.current, epoch.current); }, [scanFrame]);

  const prepareActivity = useCallback(async (action: ActionKind) => {
    if (!scan?.connectionToken || activityAbort.current) return;
    const generation = epoch.current, requestId = ++activitySeq.current;
    const controller = new AbortController(); activityAbort.current = controller;
    setSelectedAction(action); setPendingAction(action); setResolvingLocation(action === "nearby"); setActivity(null); setActivityError(""); setError("");
    const started = performance.now();
    console.info("[Callback AR] action start", JSON.stringify({ action, requestId }));
    try {
      const location = action === "nearby" ? await nearbyLocation() : null;
      if (generation !== epoch.current || requestId !== activitySeq.current || controller.signal.aborted) return;
      setResolvingLocation(false);
      const result = await responseJson(await fetch("/api/ar/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionToken: scan.connectionToken, action, ...(location ? { location } : {}) }), signal: controller.signal })) as Activity;
      if (generation === epoch.current && requestId === activitySeq.current && !controller.signal.aborted) {
        if (result.action !== action) throw new Error("The prepared action did not match your choice.");
        console.info("[Callback AR] action result", JSON.stringify({ action, requestId, ms: Math.round(performance.now() - started), supported: result.supported }));
        setActivity(result);
      }
    } catch (cause) {
      if (generation === epoch.current && requestId === activitySeq.current && !controller.signal.aborted) setActivityError(cause instanceof Error ? cause.message : `Could not prepare ${action}.`);
    } finally { if (generation === epoch.current && requestId === activitySeq.current) { activityAbort.current = null; setPendingAction(null); setResolvingLocation(false); } }
  }, [scan]);
  const openDrawer = useCallback(() => {
    if (!scan) return;
    drawerOpenRef.current = true; setDrawerOpen(true);
  }, [scan]);
  const closeDrawer = useCallback(() => {
    drawerOpenRef.current = false; setDrawerOpen(false);
    if (lostWhileOpen.current) invalidate();
  }, [invalidate]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeDrawer(); };
    document.addEventListener("keydown", onKey); return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen, closeDrawer]);

  const memory = scan?.memory;
  const item = scan?.identification.item ?? "Object";
  const actions = memory && scan?.connectionToken
    ? memory.suggestedActions?.filter(action => ["recipe", "shop", "nearby", "plan"].includes(action.kind) && action.label.trim()) ?? [{ kind: "plan" as const, label: "Make a plan" }]
    : [];
  const selectedLabel = actions.find(action => action.kind === selectedAction)?.label ?? selectedAction ?? "action";
  const pendingLabel = actions.find(action => action.kind === pendingAction)?.label ?? pendingAction;
  const shopping = selectedAction === "shop" && activity?.supported ? activity.shopping : undefined;
  const nearbyUrl = selectedAction === "nearby" ? mapsSearchUrl(activity?.nearby?.url) : null;
  const invitation = activity?.plan?.invitation?.trim() || (memory ? `Hey ${memory.personName}, seeing ${item} reminded me of what you said: “${memory.quote}”` : "");
  return <><GrocerReceipt /><TargetAR target="" generalScan recognitionPaused={drawerOpen || !!scan} remoteBox={scan?.identification.boundingBox} onDetectedFrame={onDetectedFrame} onTargetLost={onTargetLost} onPhotoSelected={onPhotoSelected}
    compactOverlay={scan && !drawerOpen ? { label: item, personName: memory?.personName, memory: memory?.shortLabel || "Tap for details", onOpen: openDrawer } : undefined}>
    <div className={styles.top}><Link href="/" className={styles.brand}>callback<span>.</span></Link><span className={styles.mode}>AR CAMERA</span></div>
    {!scan && !drawerOpen && <div className={styles.prompt} aria-live="polite"><span className={styles.promptDot} /><span>{scanning ? "Finding the connection…" : preparing ? "Preparing your saved memories…" : "Look around. Remember someone."}</span></div>}
    {drawerOpen && scan && <div className={styles.scrim} onClick={closeDrawer}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={`${item} details`} onClick={event => event.stopPropagation()}>
        <div className={styles.handle} />
        <div className={styles.sheetHead}><div><p className={styles.eyebrow}>{memory ? "Reminded you of" : "In view"}</p><h2>{memory?.personName ?? item}</h2></div><button className={styles.close} type="button" aria-label="Close details" onClick={closeDrawer}>×</button></div>
        <div className={styles.sheetScroll}>
          {memory ? <div className={styles.sourceEvidence}><p className={styles.sourceHeading}>SOURCE MESSAGE</p><blockquote>“{memory.quote}”</blockquote><p className={styles.connection}>{memory.connection}</p><div className={styles.sourceLine}>{dateLabel(memory.sourceAt)} · {memory.synthetic ? "Synthetic rehearsal message" : "Saved message"}</div><a className={styles.invite} href={`sms:?body=${encodeURIComponent(invitation)}`}>Message {memory.personName} ↗</a></div>
            : <><p className={styles.connection}>{scan.memoryStatus === "not_signed_in" ? "Sign in to connect this to your saved conversations." : scan.memoryStatus === "memory_unavailable" ? "Prepare your memories to find a connection." : "No connection found in your prepared memories."}</p><Link className={styles.invite} href={scan.memoryStatus === "not_signed_in" ? "/login" : "/"}>{scan.memoryStatus === "not_signed_in" ? "Sign in" : "Manage your memories"} ↗</Link></>}
          {actions.length > 0 && <div className={styles.actions}><p className={styles.actionsHeading}>WHAT WOULD YOU LIKE TO DO?</p><div className={styles.actionChoices}>
            {actions.map(action => <button key={action.kind} type="button" className={`${styles.actionChoice} ${selectedAction === action.kind ? styles.selectedChoice : ""}`} disabled={!!pendingAction} onClick={() => void prepareActivity(action.kind)}>{action.label}</button>)}
          </div></div>}
          {pendingAction && <p className={styles.actionProgress} role="status">{resolvingLocation ? "Finding your location…" : pendingAction === "nearby" ? "Searching nearby places…" : `Preparing ${pendingLabel}…`}</p>}
          {activityError && <div className={styles.actionError} role="alert">{activityError}<button type="button" onClick={() => selectedAction && void prepareActivity(selectedAction)}>Retry {selectedLabel}</button></div>}
          {activity?.supported === false && <p className={styles.actionNotice}>{activity.reason || "This action is unavailable for this memory."}</p>}
          {activity?.supported && activity.plan && <div className={styles.activityResult}><div className={styles.sectionHead}><h3>{activity.plan.title}</h3></div><p className={styles.activitySummary}>{activity.plan.summary}</p>
            {activity.plan.steps?.length > 0 && <ol className={styles.steps}>{activity.plan.steps.map((step,i)=><li key={i}>{step}</li>)}</ol>}
          </div>}
          {activity?.supported && selectedAction === "nearby" && activity.nearby && <div className={styles.nearbyResult}>
            <p className={styles.nearbyHeading}>Nearby places · {activity.nearby.locationLabel}</p>
            {activity.nearby.usedFallback && <p className={styles.nearbyFallback}>Location unavailable. Showing places near Klaus CS building, Georgia Tech, Atlanta.</p>}
            {activity.nearby.summary && <p>{activity.nearby.summary}</p>}
            {activity.nearby.places?.length ? <ul className={styles.nearbyPlaces}>{activity.nearby.places.map((place, index) => <li key={`${place.url}-${index}`}>
              <strong>{place.name}</strong>{place.address && <span>{place.address}</span>}{place.summary && <p>{place.summary}</p>}
              {sourceUrl(place.url) && <a href={sourceUrl(place.url)!} target="_blank" rel="noopener noreferrer">View source ↗</a>}
            </li>)}</ul> : <p>No verified places found for this search.</p>}
            {nearbyUrl && <a href={nearbyUrl} target="_blank" rel="noopener noreferrer">Open Maps search ↗</a>}
          </div>}
          {activity?.shoppingNote && <p className={styles.actionNotice}>{activity.shoppingNote}</p>}
          {shopping && <div className={styles.shoppingResult}><GrocerCheckout carts={shopping.carts ?? []} /><div className={styles.sectionHead}><h3>Ingredients to find</h3></div>
            <p className={styles.activitySummary}>Find the ingredients for this plan. Check each listing’s package size, needed quantity, price, and availability before buying.</p>
            <ul className={styles.ingredientList}>{shopping.ingredients.map((ingredient, index) => <li key={`${ingredient.query}-${index}`}>
              <div className={styles.ingredientHead}><strong>{ingredient.query}{ingredient.kind === "equipment" ? " · equipment (separate)" : ""}</strong><span>Qty {ingredient.quantity}</span></div>
              <p>{ingredient.reason}</p>{ingredient.provider === "searchapi-cache" && <p>Saved listing · checked {dateLabel(ingredient.offers[0]?.price.observedAt ?? null)}</p>}
              {ingredient.offers.length ? <ul className={styles.offerList}>{ingredient.offers.map(offer => <li key={offer.id}>
                <div><strong>{offer.title}</strong><span>{offer.merchant}</span></div>
                <div className={styles.offerSide}><strong>{ingredient.provider === "searchapi-cache" ? "Saved price" : "Listed"} {offer.price.currency === "USD" ? money(offer.price.amountCents) : `${offer.price.amountCents / 100} ${offer.price.currency}`}</strong>
                  {sourceUrl(offer.merchantUrl) && <a href={sourceUrl(offer.merchantUrl)!} target="_blank" rel="noopener noreferrer">View offer ↗</a>}</div>
              </li>)}</ul> : <p className={styles.offerUnavailable}>{ingredient.status === "provider_unavailable" ? "Shopping search is temporarily unavailable." : "No verified offer found."} {sourceUrl(ingredient.fallbackSearchUrl) && <a href={sourceUrl(ingredient.fallbackSearchUrl)!} target="_blank" rel="noopener noreferrer">Search this ingredient ↗</a>}</p>}
            </li>)}</ul>
          </div>}
          <details className={styles.details}><summary>What the camera saw <span>⌄</span></summary><p>{item}</p>{scan.identification.visibleText?.length ? <p>{scan.identification.visibleText.join(" · ")}</p> : null}</details>
        </div>
        {error && <div className={styles.sheetError} role="alert">{error}</div>}
      </section>
    </div>}
    {error && !drawerOpen && <div className={styles.error} role="alert">{error}{!preparing && hasFrame && !scan && !scanning && <button type="button" onClick={retryVision}>Retry scan</button>}</div>}
  </TargetAR></>;
}

export const BananaDemo = ARDemo;
