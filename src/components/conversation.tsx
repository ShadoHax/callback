"use client";

import Link from "next/link";
import { useState } from "react";
import { conversationMessages } from "@/lib/conversation";
import type { Message } from "@/lib/use-inbox";
import { useSend } from "@/lib/use-send";

export function Conversation({ rootId, messages, userId, name, purpose = "connection", initialBody, refresh }: {
  rootId: string; messages: Message[]; userId: string; name: string; purpose?: "connection" | "advice";
  initialBody?: string; refresh: () => Promise<void>;
}) {
  const thread = conversationMessages(messages, rootId);
  const root = thread.find((message) => message.id === rootId);
  const replies = thread.filter((message) => message.id !== rootId);
  const incoming = replies.filter((message) => message.recipient_id === userId);
  const target = incoming.at(-1);
  const sender = useSend();
  const sentId = sender.state.phase === "sent" ? sender.state.id : null;
  const [body, setBody] = useState("");
  const pending = sender.state.phase === "sending" || sender.state.phase === "uncertain" ? sender.state.payload : null;

  async function send(retry = false) {
    if (!target) return;
    const id = await (retry ? sender.retry() : sender.send({ kind: "reply", replyTo: target.id, body: body.trim() }));
    if (id) { setBody(""); await refresh(); }
  }

  return <section className="sent" aria-label={`Conversation with ${name}`}>
    <p className="sent-label">{purpose === "advice" ? "Asked" : "Sent to"} {name} ✓</p>
    {(root?.body || initialBody) && <p className="conversation-original">{root?.body || initialBody}</p>}
    <div aria-live="polite">
      {replies.map((reply) => <div key={reply.id} className={`reply-bubble${reply.sender_id === userId ? " mine" : ""}`}>
        <span>{reply.sender_id === userId ? "You" : reply.sender_name || name}</span><p>{reply.body}</p>
      </div>)}
      {!incoming.length && <p className="waiting"><span className="pulse" aria-hidden />{purpose === "advice" ? "Advice pending. You can keep shopping without it." : `Waiting for ${name}’s reply…`}</p>}
    </div>
    {target && <div className="reply-box">
      <label className="field-label" htmlFor={`reply-${rootId}`}>Keep the conversation going</label>
      <textarea id={`reply-${rootId}`} value={pending?.body ?? body} maxLength={2000} readOnly={sender.locked}
        onChange={(event) => setBody(event.target.value)} placeholder={`Reply to ${name}…`} />
      {sender.state.phase === "uncertain" ? <>
        <p className="send-status" role="status">Delivery is unconfirmed. Retry the same reply without sending it twice.</p>
        <button className="send" onClick={() => void send(true)}>Retry reply</button>
      </> : <button className="send" disabled={!body.trim() || sender.busy} onClick={() => void send()}>{sender.busy ? "Sending…" : "Reply"}<span aria-hidden>↗</span></button>}
      {sender.state.phase === "failed" && <p className="error" role="alert">{sender.state.message}</p>}
      {sentId && !replies.some((message) => message.id === sentId) && <p role="status" className="fine-print">Reply sent. Refreshing the conversation…</p>}
    </div>}
    <Link className="text-button" href="/inbox">Open inbox</Link>
  </section>;
}
