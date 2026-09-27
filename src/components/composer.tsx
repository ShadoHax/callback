"use client";

import { useState } from "react";
import { displayName } from "@/lib/decision";
import { formatDate, type ScanResult } from "@/lib/scan-types";
import type { Message } from "@/lib/use-inbox";
import { useSend } from "@/lib/use-send";
import { findScanConversation } from "@/lib/conversation";
import { isIosDevice, personalSmsHref, sharePersonalMessage } from "@/lib/personal-share";
import { Conversation } from "./conversation";

// An editable starting point built from the relation and the friend's own words for the item. It never claims a
// plan, agreement, or date that isn't in the evidence; the sender changes it however they like.
export function draftFor(result: Pick<ScanResult, "relation" | "mention" | "proximity" | "activity" | "preferenceMatch" | "category" | "observedEntity">) {
  if (result.proximity?.status === "same_place") return "Looks like we may be in the same place—want to say hi?";
  const item = result.mention?.trim() || "this";
  switch (result.relation) {
    case "planned_together": return `I just came across ${item} and remembered our plan. Still want to do it together? When works for you?`;
    case "asked_to_find": return `I came across ${item} and remembered you asked me to look out for one. Want me to send you the details?`;
    case "wanted": return `I saw ${item} and thought of you. Is this the one you were looking for?`;
    case "recommended": return `I just came across ${item}, the one you recommended. What did you like about it?`;
    case "inspired": return result.activity
      ? `Saw ${item} and remembered it inspired you to ${result.activity.replace(/^to\s+/i, "")}. How's it going? No pressure, just curious.`
      : `Saw ${item} and thought of you and that idea it gave you. How's it going?`;
    case "prefers": return result.preferenceMatch === "observed"
      ? `I spotted ${item} and thought of you. Still a favorite?`
      : `I came across ${result.category || result.observedEntity || "this"} and thought of you. How have you been?`;
    case "owns": return `I came across ${item} and remembered you have it and like it. What has your experience been?`;
    default: return "Saw this and thought of you!";
  }
}

// Sending is always an explicit tap. Only the photo, these words, and (if the sender opts in) the recipient's own
// quoted words are shared; the server re-checks that the quote is theirs and part of this scan's evidence.
export function Composer({ result, messages, userId, messagesReady, refresh }: { result: ScanResult; messages: Message[]; userId: string; messagesReady: boolean; refresh: () => Promise<void> }) {
  const name = result.personName || displayName(result.person ?? "");
  const quote = result.evidence?.find((item) => item.shareableQuote);
  const [body, setBody] = useState(() => draftFor(result));
  const [includeQuote, setIncludeQuote] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [smsStatus, setSmsStatus] = useState<"idle" | "opening" | "failed">("idle");
  const [smsMessage, setSmsMessage] = useState("");
  const [smsHref, setSmsHref] = useState<string | null>(null);
  const sender = useSend();
  const { state } = sender;
  const existing = findScanConversation(messages, { scanId: result.scanId, userId, purpose: "connection" });

  async function send(retry = false) {
    if (!result.recipientId) return;
    const id = await (retry ? sender.retry() : sender.send({ kind: "scan", scanId: result.scanId, recipientId: result.recipientId, body: body.trim(), ...(includeQuote && quote ? { quotedSourceId: quote.id } : {}) }));
    if (id) await refresh();
  }

  async function sharePersonally() {
    setShareStatus("");
    try {
      const outcome = await sharePersonalMessage(body);
      if (outcome === "copied") setShareStatus("Message copied. Paste it into your personal messaging app.");
      if (outcome === "shared") setShareStatus("Sharing opened. Finish sending in your chosen app; replies stay there.");
      if (outcome === "cancelled") setShareStatus("Sharing cancelled. No delivery was confirmed.");
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : "Could not open your sharing apps.");
    }
  }

  async function textPersonally() {
    if (!result.recipientId || !body.trim()) return;
    setSmsStatus("opening"); setSmsMessage(""); setSmsHref(null);
    const ios = isIosDevice();
    // Clipboard access starts on the original tap. Its failure must not block opening Messages.
    const copied = ios && navigator.clipboard?.writeText
      ? navigator.clipboard.writeText(body.trim()).then(() => true, () => false)
      : Promise.resolve(false);
    try {
      const response = await fetch("/api/messages/sms/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scanId: result.scanId, recipientId: result.recipientId }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setSmsStatus("failed"); setSmsMessage(data.error ?? "Could not prepare the text."); return; }
      const didCopy = await copied;
      setSmsHref(personalSmsHref(data.phone, body));
      setSmsMessage(ios ? didCopy ? "Draft copied. Open Messages, paste it, and tap Send." : "Copy the draft above manually, then open Messages and paste it." : "Open Messages, review the draft, and tap Send.");
      setSmsStatus("idle");
    } catch { setSmsStatus("failed"); setSmsMessage("Could not prepare Messages. You can still choose a personal app."); }
  }

  if (state.phase === "sent" || (existing && !sender.locked)) return <div id="connection-composer"><Conversation
    key={state.phase === "sent" ? state.id : existing!.id} rootId={state.phase === "sent" ? state.id : existing!.id} messages={messages} userId={userId} name={name}
    initialBody={state.phase === "sent" ? state.payload.body : existing?.body} refresh={refresh} /></div>;
  // While a send is in flight or unconfirmed, show exactly what was sent; editing would make it a different message.
  const shown = state.phase === "sending" || state.phase === "uncertain" ? state.payload : null;
  const shownBody = shown ? shown.body : body;
  const shownQuote = shown ? shown.kind !== "reply" && Boolean(shown.quotedSourceId) : includeQuote;

  return <section id="connection-composer" className="composer-card">
    <label className="field-label" htmlFor="message">Your message to {name}</label>
    <textarea id="message" value={shownBody} maxLength={2000} readOnly={sender.locked || smsStatus === "opening"} onChange={(event) => { setBody(event.target.value); setSmsHref(null); setSmsMessage(""); }} />
    {quote && <label className="toggle">
      <input type="checkbox" checked={shownQuote} disabled={sender.locked} onChange={(event) => setIncludeQuote(event.target.checked)} />
      <span>Also include {name}&apos;s own words from {formatDate(quote.date)} in Callback’s inbox</span>
    </label>}
    {shownQuote && quote && <blockquote className="quote-preview">{quote.text}</blockquote>}
    <p className="fine-print">Personal sharing includes only the edited message, without the photo or quoted history. Choose the recipient in your messaging app; replies stay there. Callback&apos;s inbox sends the photo and your message{shownQuote && quote ? ", plus the words above" : ""}.</p>
    <button className="secondary personal-share" disabled={!body.trim() || sender.locked || smsStatus === "opening"} onClick={() => void sharePersonally()}>
      Choose a personal app<span aria-hidden>↗</span>
    </button>
    {shareStatus && <p className="send-status" role="status">{shareStatus}</p>}
    {result.recipientId && <button className="secondary personal-share" disabled={!body.trim() || sender.locked || smsStatus === "opening"} onClick={() => void textPersonally()}>
      {smsStatus === "opening" ? "Preparing text…" : `Text ${name} from my number`}<span aria-hidden>↗</span>
    </button>}
    {smsHref && !sender.locked && <a className="secondary personal-share" href={smsHref} rel="noreferrer">Open Messages for {name}<span aria-hidden>↗</span></a>}
    {smsMessage && <p className={smsStatus === "failed" ? "error" : "send-status"} role="status">{smsMessage}</p>}
    {!result.recipientId && <p className="notice">{name} isn&apos;t linked to a Callback account. Use the personal-app button above.</p>}
    {result.recipientId && !messagesReady && !sender.locked && <p className="notice">Checking your conversation before sending… <button className="text-button" onClick={() => void refresh()}>Refresh</button></p>}
    {state.phase === "uncertain" ? <>
      <p className="send-status" role="status">Couldn&apos;t confirm delivery. Retrying sends this exact message once; it won&apos;t arrive twice.</p>
      <button className="send" onClick={() => void send(true)}>Retry sending<span aria-hidden>↻</span></button>
    </> : result.recipientId && messagesReady ? <button className="send" disabled={!body.trim() || sender.busy || smsStatus === "opening"} onClick={() => void send()}>
      {sender.busy ? "Sending…" : `Send to ${name}`}<span aria-hidden>↗</span>
    </button> : null}
    {state.phase === "failed" && <p className="error" role="alert">{state.message}</p>}
  </section>;
}
