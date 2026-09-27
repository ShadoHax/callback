"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EvidenceSheet } from "@/components/connection";
import type { AdviceItem, ScanResult } from "@/lib/scan-types";
import type { Message } from "@/lib/use-inbox";
import { useSend } from "@/lib/use-send";
import { findScanConversation } from "@/lib/conversation";
import { Conversation } from "./conversation";
import type { LiveSearchResult } from "@/lib/commerce/live-search";

type Purpose = { kind: "self" } | { kind: "gift"; personId: string } | { kind: "together"; personId: string };
type Totals = { subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; currency: string };
type Option = { productId: string; title: string; variant: string; merchant: string; match: string; totals: Totals; stock: number; reasons: string[]; tradeoffs: string[] };
// A taste-matched gift ("prefers") suggests related products; an ambition ("inspired") is a conversation, not a sale.
const tasteGift = (result: ScanResult) => result.status === "matched" && result.relation === "prefers";
type OrderView = { id: string; status: string; statusDetail: string | null; title: string; variant: string; merchant: string; subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; quoteExpiresAt: string; purpose: Purpose };
type Config = { enabled: boolean; checkout: string | null; merchant: { name: string; label: string } };
type ConversationProps = { messages: Message[]; userId: string; messagesReady: boolean; refresh: () => Promise<void> };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
function askDraft(item: AdviceItem) {
  const mention = item.mention.trim() || "this";
  switch (item.basis) {
    case "owns": return `I came across ${mention} and remembered you have one. How has yours held up?`;
    case "recommended": return `I came across ${mention}, which you recommended. Would you still suggest it?`;
    case "tried": return `I came across ${mention} and remembered you tried it. What did you think?`;
    case "dislikes": return `I came across ${mention} and remembered it didn't work for you. What should I watch out for?`;
  }
}

// The shopping continuation. It reuses the scan's identified item and evidence, keeps the reconnect moment first,
// and never generates a friend's advice: a pending ask stays pending until a real reply arrives.
export function Shopping({ result, previewSearch, ...conversation }: { result: ScanResult; previewSearch?: LiveSearchResult } & ConversationProps) {
  const [config, setConfig] = useState<Config | null>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (previewSearch) return;
    fetch("/api/shop/config").then((response) => response.json()).then(setConfig).catch(() => setConfig(null));
  }, [previewSearch]);
  if (result.relation === "inspired") return null;
  const advisors = result.advice?.map((item) => item.personName).join(" and ");
  return <details className="shop" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
    <summary><span>{tasteGift(result) ? `A gift ${result.personName} would actually like?` : "Shopping for this?"}</span> {advisors ? `Ask ${advisors} or see current search results` : "See product information and current search results"} {config?.enabled && <span className="chip">{config.merchant.label} merchant</span>}</summary>
    <AskSomeone result={result} preview={Boolean(previewSearch)} {...conversation} />
    {opened && <LiveResults scanId={result.scanId} preview={previewSearch} />}
    {opened && config?.enabled && <DemoOptions result={result} config={config} />}
  </details>;
}

function LiveResults({ scanId, preview }: { scanId: string; preview?: LiveSearchResult }) {
  const [fetched, setFetched] = useState<LiveSearchResult | null>(null);
  const [error, setError] = useState("");
  const data = preview ?? fetched;
  useEffect(() => {
    if (preview) return;
    let current = true;
    fetch("/api/shop/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scanId }) })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Could not search for this item."); return payload as LiveSearchResult; })
      .then((payload) => { if (current) setFetched({
        ...payload,
        searchUrl: payload.searchUrl || "https://www.ebay.com/",
        shoppingUrl: payload.shoppingUrl || "https://www.google.com/search?tbm=shop",
      }); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Could not search for this item."); });
    return () => { current = false; };
  }, [scanId, preview]);
  if (error) return <section className="shop-section"><h3>Product information and live searches</h3><p className="error" role="alert">{error}</p></section>;
  if (!data) return <section className="shop-section"><h3>Product information and live searches</h3><p className="fine-print">Preparing search links…</p></section>;
  return <section className="shop-section live-results">
    <h3>Product information and live searches</h3>
    {data.software && <article className="option-card">
      <header><strong>{data.software.title}</strong><span>{data.software.price}</span></header>
      <p>{data.software.description}</p>
      <ul>{data.software.compatibility.map((line) => <li key={line}>{line}</li>)}</ul>
      <p><a href={data.software.downloadUrl} target="_blank" rel="noreferrer">Download from Sony ↗</a> · <a href={data.software.supportUrl} target="_blank" rel="noreferrer">Sony setup and compatibility details ↗</a></p>
      <p className="fine-print">Product facts and links: Sony support.</p>
    </article>}
    {data.message && <p className="fine-print">{data.message}</p>}
    <div className="live-search-links"><strong>{data.software ? "Related camera hardware searches" : "Live retailer searches"}</strong><div>
      <a className="live-search-link" href={data.shoppingUrl} target="_blank" rel="noreferrer">{data.software ? "Search Google Shopping for Sony cameras ↗" : "See Google Shopping results ↗"}</a>
      <a className="live-search-link" href={data.searchUrl} target="_blank" rel="noreferrer">{data.software ? "Search eBay for Sony cameras ↗" : "See eBay results ↗"}</a>
    </div></div>
    <p className="fine-print">The buttons open live search results on Google Shopping and eBay. Prices and listings appear on those retailer sites.</p>
    {data.software && <p className="fine-print">Sony provides Imaging Edge Webcam free. These camera hardware searches do not confirm compatibility; check Sony&apos;s supported camera and computer requirements.</p>}
  </section>;
}

function AskSomeone({ result, preview, ...conversation }: { result: ScanResult; preview: boolean } & ConversationProps) {
  const advice = result.advice ?? [];
  return <section className="shop-section">
    <h3>Ask someone who knows it</h3>
    {advice.length === 0 ? <p className="fine-print">I couldn&apos;t find supported experience with this item in the context you&apos;ve shared.</p>
      : advice.map((item) => <AskRow key={item.personId} item={item} scanId={result.scanId} preview={preview} {...conversation} />)}
  </section>;
}

function AskRow({ item, scanId, preview, messages, userId, messagesReady, refresh }: { item: AdviceItem; scanId: string; preview: boolean } & ConversationProps) {
  const [open, setOpen] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [body, setBody] = useState(() => askDraft(item));
  const [includeQuote, setIncludeQuote] = useState(false);
  const sender = useSend();
  const { state } = sender;
  const quote = item.evidence.find((source) => source.shareableQuote);
  const existing = findScanConversation(messages, { scanId, userId, purpose: "advice", personId: item.personId });
  const rootId = state.phase === "sent" ? state.id : !sender.locked ? existing?.id : null;
  const shownBody = state.phase === "sending" || state.phase === "uncertain" ? state.payload.body : body;

  async function send(retry = false) {
    const id = await (retry ? sender.retry() : sender.send({ kind: "advice", scanId, personId: item.personId, body: body.trim(), ...(includeQuote && quote ? { quotedSourceId: quote.id } : {}) }));
    if (id) await refresh();
  }

  return <div className={`ask-row${item.caution ? " caution" : ""}`}>
    <p><strong>{item.personName}</strong> · {item.message} {item.evidence.length > 0 && <button className="text-button" onClick={() => setShowSource(true)}>Read their words</button>}</p>
    {showSource && <EvidenceSheet evidence={item.evidence} title={`What ${item.personName} said`} onClose={() => setShowSource(false)} />}
    {preview ? !open ? <button className="secondary" onClick={() => setOpen(true)}>Draft a question for {item.personName}</button>
      : <div className="composer-card">
        <label className="field-label" htmlFor={`advice-${item.personId}`}>Your question to {item.personName}</label>
        <textarea id={`advice-${item.personId}`} value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} />
        <p className="fine-print">Local draft only. Nothing is sent.</p>
      </div>
      : !item.recipientId ? <p className="fine-print">{item.personName} isn&apos;t linked to a demo account, so you can&apos;t ask from here.</p>
      : rootId ? <Conversation key={rootId} rootId={rootId} messages={messages} userId={userId} name={item.personName} purpose="advice"
        initialBody={state.phase === "sent" ? state.payload.body : existing?.body} refresh={refresh} />
      : !messagesReady && !sender.locked ? <p className="fine-print">Checking previous advice requests…</p>
      : !open ? <button className="secondary" onClick={() => setOpen(true)}>Ask {item.personName} about {item.mention}</button>
      : <div className="composer-card">
        <label className="field-label" htmlFor={`advice-${item.personId}`}>Your question to {item.personName}</label>
        <textarea id={`advice-${item.personId}`} value={shownBody} maxLength={2000} readOnly={sender.locked} onChange={(event) => setBody(event.target.value)} />
        {quote && <label className="toggle"><input type="checkbox" checked={includeQuote} disabled={sender.locked} onChange={(event) => setIncludeQuote(event.target.checked)} /><span>Also include {item.personName}&apos;s own words</span></label>}
        {includeQuote && quote && <blockquote className="quote-preview">{quote.text}</blockquote>}
        <p className="fine-print">{item.personName} gets this photo and your question{includeQuote && quote ? ", plus the words above" : ""}. Nothing else from your messages is shared.</p>
        {state.phase === "uncertain" ? <><p className="send-status">Couldn&apos;t confirm delivery. Retrying sends this exact message once.</p><button className="send" onClick={() => void send(true)}>Retry sending<span aria-hidden>↻</span></button></>
          : <button className="send" disabled={!body.trim() || sender.busy} onClick={() => void send()}>{sender.busy ? "Sending…" : `Send to ${item.personName}`}<span aria-hidden>↗</span></button>}
        {state.phase === "failed" && <p className="error" role="alert">{state.message}</p>}
      </div>}
  </div>;
}

function DemoOptions({ result, config }: { result: ScanResult; config: Config }) {
  const router = useRouter();
  const purposes = useMemo<{ label: string; value: Purpose }[]>(() => {
    const list: { label: string; value: Purpose }[] = [{ label: "For me", value: { kind: "self" } }];
    if (result.status === "matched" && result.person && ["wanted", "asked_to_find"].includes(result.relation ?? "")) list.push({ label: `A gift for ${result.personName} (their request)`, value: { kind: "gift", personId: result.person } });
    if (tasteGift(result) && result.person) list.push({ label: `A gift for ${result.personName} (matched to their taste)`, value: { kind: "gift", personId: result.person } });
    if (result.status === "matched" && result.person && result.relation === "planned_together") list.push({ label: `For your plan with ${result.personName}`, value: { kind: "together", personId: result.person } });
    return list;
  }, [result]);
  const [purposeIndex, setPurposeIndex] = useState(purposes.length - 1);
  const [budget, setBudget] = useState(tasteGift(result) ? "25" : "80");
  const [preference, setPreference] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<{ options: Option[]; excluded: { title: string; why: string }[]; personalization: string[]; selection: { budgetCents: number; purpose: Purpose; preference?: string } } | null>(null);
  const [requestIds, setRequestIds] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<OrderView | null>(null);
  const [approving, setApproving] = useState(false);
  const [notice, setNotice] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const generation = useRef(0);
  const initiallyLoaded = useRef(false);
  const budgetCents = Math.round(Number(budget) * 100);

  function changeSelection(update: () => void) {
    generation.current++;
    update(); setData(null); setOrder(null); setNotice(""); setError(""); setLoading(false); setReviewing(false);
  }

  const load = useCallback(async () => {
    const run = ++generation.current;
    const selection = { budgetCents, purpose: purposes[purposeIndex].value, ...(preference ? { preference } : {}) };
    setLoading(true); setError(""); setData(null); setOrder(null); setNotice("");
    try {
      const response = await fetch("/api/shop/options", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scanId: result.scanId, ...selection }) });
      const payload = await response.json();
      if (run !== generation.current) return;
      if (!response.ok) { setError(payload.error ?? "Couldn't load options."); setData(null); }
      else { setData({ ...payload, selection }); setRequestIds(Object.fromEntries(payload.options.map((option: Option) => [option.productId, crypto.randomUUID()]))); }
    } catch { if (run === generation.current) setError("Couldn't load options. Check the connection."); }
    finally { if (run === generation.current) setLoading(false); }
  }, [budgetCents, preference, purposeIndex, purposes, result.scanId]);
  useEffect(() => {
    if (initiallyLoaded.current) return;
    initiallyLoaded.current = true;
    void load();
  }, [load]);
  async function review(option: Option) {
    if (!data || reviewing) return;
    const run = generation.current;
    setReviewing(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/shop/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scanId: result.scanId, productId: option.productId, ...data.selection, clientRequestId: requestIds[option.productId] }) });
      const payload = await response.json();
      if (run !== generation.current) return;
      if (!response.ok) setError(payload.error ?? "Couldn't create a quote."); else setOrder(payload.order);
    } catch { if (run === generation.current) setError("Couldn't create a quote. Try again; it won't duplicate."); }
    finally { if (run === generation.current) setReviewing(false); }
  }
  async function approve() {
    if (!order) return;
    setApproving(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/shop/orders/${order.id}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedTotalCents: order.totalCents }) });
      const payload = await response.json();
      if (payload.kind === "redirect" && payload.url) { window.location.assign(payload.url); return; }
      if (payload.order) setOrder(payload.order);
      if (payload.kind === "changed") setNotice(`Your quote changed. Review the item and ${money(payload.order.totalCents)} total, then approve again.`);
      else if (payload.kind === "expired" || payload.kind === "unavailable") setNotice(payload.order?.statusDetail ?? "This quote is no longer valid. Load options again.");
      else if (payload.kind === "done") router.push(`/shop/orders/${order.id}`);
      else setError(payload.error ?? "Couldn't approve.");
    } catch { setError("Couldn't reach the server. Check the order status before trying again."); }
    finally { setApproving(false); }
  }

  return <section className="shop-section">
    <h3>Demo catalog at {config.merchant.name}</h3>
    <div className="shop-form">
      <label>For<select disabled={approving} value={purposeIndex} onChange={(event) => changeSelection(() => setPurposeIndex(Number(event.target.value)))}>{purposes.map((purpose, index) => <option key={index} value={index}>{purpose.label}</option>)}</select></label>
      <label>Budget ($, incl. shipping and tax)<input disabled={approving} inputMode="decimal" value={budget} onChange={(event) => changeSelection(() => setBudget(event.target.value.replace(/[^0-9.]/g, "")))} /></label>
      {!tasteGift(result) && <label>Must be<select disabled={approving} value={preference} onChange={(event) => changeSelection(() => setPreference(event.target.value))}><option value="">Any version</option><option value="base">Base game</option><option value="standalone">Standalone</option><option value="expansion">Expansion</option><option value="accessory">Accessory</option><option value="camera">Camera</option></select></label>}
      <button className="send" disabled={loading || approving || !(budgetCents >= 100 && budgetCents <= 1_000_000)} onClick={() => void load()}>{loading ? "Checking…" : data ? "Refresh options" : "Show options"}<span aria-hidden>↗</span></button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {data && !order && <>
      {data.personalization.map((line, index) => <p key={index} className="fine-print personalization">{line}</p>)}
      {data.options.length === 0 && <p className="notice">Nothing at the demo merchant fits this budget and preference.</p>}
      {data.options.map((option, index) => <article key={option.productId} className="option-card">
        {tasteGift(result) && index === 0 && <span className="chip">Best fit</span>}
        <header><strong>{option.title}</strong><span>{money(option.totals.totalCents)}</span></header>
        <p className="fine-print">{option.variant} · {option.merchant} · {option.stock} in demo stock · {money(option.totals.subtotalCents)} + {money(option.totals.shippingCents)} shipping + {money(option.totals.taxCents)} tax</p>
        <ul>{option.reasons.map((line, index) => <li key={index}>{line}</li>)}{option.tradeoffs.map((line, index) => <li key={`t${index}`} className="tradeoff">{line}</li>)}</ul>
        <button className="secondary" disabled={reviewing} onClick={() => void review(option)}>{reviewing ? "Preparing quote…" : "Review test total"}</button>
      </article>)}
      {data.excluded.length > 0 && <p className="fine-print">Not shown: {data.excluded.map((item) => `${item.title} (${item.why})`).join("; ")}.</p>}
    </>}
    {order && <article className="option-card review">
      <header><strong>Review your test order</strong><span className="chip">TEST</span></header>
      <p className="fine-print">{order.merchant} · demo merchant, demo prices. Payment runs in {config.checkout === "stripe_test" ? "Stripe test mode" : "test mode (not configured yet)"}; no real money moves.</p>
      <dl className="totals"><dt>{order.title}, {order.variant}</dt><dd>{money(order.subtotalCents)}</dd><dt>Shipping (demo)</dt><dd>{money(order.shippingCents)}</dd><dt>Tax (demo 7%)</dt><dd>{money(order.taxCents)}</dd><dt><strong>Total</strong></dt><dd><strong>{money(order.totalCents)}</strong></dd></dl>
      <p className="fine-print">Quote valid until {new Date(order.quoteExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.{order.purpose.kind === "gift" ? " Buying a gift doesn't mean they have it until they do." : ""}</p>
      {notice && <p className="send-status" role="status">{notice}</p>}
      {order.status === "quoted" && <button className="send" disabled={approving} onClick={approve}>{approving ? "Starting test checkout…" : `Approve ${money(order.totalCents)} and pay (test)`}<span aria-hidden>↗</span></button>}
      <button className="text-button" disabled={approving} onClick={() => { setOrder(null); setNotice(""); }}>Back to options</button>
    </article>}
  </section>;
}
