"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { alertIncoming, unlockAlerts } from "@/lib/alert";
import { useInbox, type Message } from "@/lib/use-inbox";
import { formatDate } from "@/lib/scan-types";
import { useSend } from "@/lib/use-send";

type Thread = { root: Message; items: Message[] };

function threads(messages: Message[]): Thread[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const rootOf = (message: Message): Message => { let current = message; for (let depth = 0; current.reply_to && byId.has(current.reply_to) && depth < 20; depth++) current = byId.get(current.reply_to)!; return current; };
  const grouped = new Map<string, Thread>();
  for (const message of [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const root = rootOf(message);
    const thread = grouped.get(root.id) ?? { root, items: [] };
    if (message.id !== root.id) thread.items.push(message);
    grouped.set(root.id, thread);
  }
  return [...grouped.values()].sort((a, b) => (b.items.at(-1) ?? b.root).created_at.localeCompare((a.items.at(-1) ?? a.root).created_at));
}

export default function Inbox() {
  const [alertsOn, setAlertsOn] = useState(false);
  const [fresh, setFresh] = useState("");
  const { messages, userId, error, live, refresh } = useInbox((message) => { alertIncoming(); setFresh(message.reply_to ?? message.id); });
  const grouped = useMemo(() => threads(messages), [messages]);

  return <main className="app">
    <header className="appbar"><Link href="/" className="brand">↗ callback<span>.</span></Link><nav><Link href="/">Scan</Link><Link href="/login">Account</Link></nav></header>
    <div className="inbox-head">
      <h1>Inbox</h1>
      <span className={`live-dot${live ? " on" : ""}`}>{live ? "Live" : "Checking every few seconds"}</span>
    </div>
    {!alertsOn && <button className="alerts-banner" onClick={() => { setAlertsOn(unlockAlerts()); navigator.vibrate?.(30); }}>Tap to turn on sound and vibration for new messages</button>}
    {error && <p className="error" role="alert">{error}</p>}
    {grouped.length === 0 && !error && <p className="notice">Nothing yet. When someone sees something that reminds them of you, it shows up here.</p>}
    {grouped.map((thread) => <ThreadCard key={thread.root.id} thread={thread} userId={userId} highlight={fresh !== "" && (fresh === thread.root.id || thread.items.some((item) => item.id === fresh || item.reply_to === fresh))} onSent={refresh} />)}
  </main>;
}

const sender_name = (message: Message) => message.sender_name || "Someone";

function ThreadCard({ thread, userId, highlight, onSent }: { thread: Thread; userId: string; highlight: boolean; onSent: () => Promise<void> }) {
  const { root, items } = thread;
  const received = root.recipient_id === userId;
  const from = received ? sender_name(root) : "You";
  const replyTarget = [...items].reverse().find((item) => item.recipient_id === userId) ?? (received ? root : null);
  const [body, setBody] = useState("");
  const sender = useSend();
  const { state } = sender;

  async function reply() {
    if (!replyTarget || !body.trim()) return;
    const id = await sender.send({ kind: "reply", replyTo: replyTarget.id, body: body.trim() });
    if (id) { setBody(""); sender.reset(); await onSent(); }
  }
  async function retry() {
    const id = await sender.retry();
    if (id) { setBody(""); sender.reset(); await onSent(); }
  }
  // While a reply is in flight or unconfirmed, show exactly what was sent; editing it would be a different message.
  const shownBody = state.phase === "sending" || state.phase === "uncertain" ? state.payload.body : body;

  return <article className={`thread${highlight ? " fresh" : ""}`}>
    <p className="thread-from"><span>{received ? <><strong>{from}</strong> {root.purpose === "advice" ? "is asking for your take on this" : "saw this and thought of you"}</> : "You shared this"}</span><time>{new Date(root.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></p>
    {root.imageUrl && <div className="thread-photo"><Image src={root.imageUrl} alt="The photo that was shared" fill unoptimized /></div>}
    <p className="thread-body">{root.body}</p>
    {root.quoted_text && <blockquote className="quote-preview"><span className="quote-label">{received ? "Your words" : "Their words"}, {formatDate(root.quoted_at)}</span>{root.quoted_text}</blockquote>}
    {items.map((item) => <div key={item.id} className={`bubble${item.sender_id === userId ? " mine" : ""}`}><span>{item.sender_id === userId ? "You" : item.sender_name || "Reply"}</span><p>{item.body}</p></div>)}
    {replyTarget && <div className="reply-box">
      <textarea value={shownBody} maxLength={2000} readOnly={sender.locked} onChange={(event) => setBody(event.target.value)} placeholder={`Reply to ${received ? sender_name(root) : "them"}…`} />
      {state.phase === "uncertain" ? <>
        <p className="send-status" role="status">Couldn&apos;t confirm delivery. Retrying sends this exact reply once; it won&apos;t arrive twice.</p>
        <button className="send" onClick={() => void retry()}>Retry reply<span aria-hidden>↻</span></button>
      </> : <button className="send" onClick={() => void reply()} disabled={!body.trim() || sender.busy}>{sender.busy ? "Sending…" : "Reply"}<span aria-hidden>↗</span></button>}
      {state.phase === "failed" && <p className="error" role="alert">{state.message}</p>}
    </div>}
  </article>;
}
