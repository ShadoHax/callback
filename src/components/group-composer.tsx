"use client";

import { useRef, useState } from "react";
import type { ScanResult } from "@/lib/scan-types";

type Delivery = { status: "sent" | "failed" | "uncertain"; error?: string };
type Attempt = { key: string; body: string };

export function GroupComposer({ result, refresh }: { result: ScanResult; refresh: () => Promise<void> }) {
  const people = (result.people ?? []).filter((person) => person.recipientId);
  const names = people.map((person) => person.personName).join(", ");
  const samePlace = people.filter((person) => person.proximity?.status === "same_place");
  const [body, setBody] = useState(() => samePlace.length ? `${samePlace.map((person) => person.personName).join(" and ")} may be here too—should we say hi?` : `This made me think of all of us${result.observedEntity ? ` — ${result.observedEntity}` : ""}. We should catch up!`);
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<Record<string, Delivery>>({});
  const attempts = useRef(new Map<string, Attempt>());
  const pending = people.filter((person) => delivery[person.personId]?.status !== "sent");
  const delivered = people.filter((person) => delivery[person.personId]?.status === "sent");
  const uncertain = pending.filter((person) => delivery[person.personId]?.status === "uncertain");
  const failed = pending.filter((person) => delivery[person.personId]?.status === "failed");

  async function send() {
    if (sending || !pending.length || !body.trim()) return;
    setSending(true);
    const message = body.trim();
    const outcomes = await Promise.all(pending.map(async (person) => {
      // A send with unknown status must replay its original payload. An edited definite failure needs a new key.
      let attempt = attempts.current.get(person.personId);
      if (!attempt || (attempt.body !== message && delivery[person.personId]?.status !== "uncertain")) {
        attempt = { key: crypto.randomUUID(), body: message };
        attempts.current.set(person.personId, attempt);
      }
      try {
        const response = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "scan", scanId: result.scanId, recipientId: person.recipientId, body: attempt.body, clientRequestId: attempt.key }) });
        if (response.ok) return { personId: person.personId, delivery: { status: "sent" } as Delivery };
        if (response.status >= 500 || response.status === 429) return { personId: person.personId, delivery: { status: "uncertain" } as Delivery };
        const data = await response.json().catch(() => ({}));
        return { personId: person.personId, delivery: { status: "failed", error: data.error ?? "Could not send the callback." } as Delivery };
      } catch {
        return { personId: person.personId, delivery: { status: "uncertain" } as Delivery };
      }
    }));
    const next = { ...delivery };
    for (const outcome of outcomes) next[outcome.personId] = outcome.delivery;
    setDelivery(next);
    setSending(false);
    if (people.every((person) => next[person.personId]?.status === "sent")) await refresh().catch(() => {});
  }

  if ((result.people?.length ?? 0) < 2) return null;
  if (!people.length) return <p className="notice">This group is not linked to demo accounts yet.</p>;
  if (!pending.length) return <section className="composer-card"><p role="status">Sent the callback to {names}.</p></section>;
  return <section className="composer-card">
    <label className="field-label" htmlFor="group-message">Your callback to {pending.map((person) => person.personName).join(", ")}</label>
    <textarea id="group-message" value={body} maxLength={2000} readOnly={sending || uncertain.length > 0} onChange={(event) => setBody(event.target.value)} />
    <p className="fine-print">Each linked friend receives the photo and your message. Nothing else from your private context is shared.</p>
    {delivered.length > 0 && <p className="send-status" role="status">Delivered to {delivered.map((person) => person.personName).join(", ")}.</p>}
    {uncertain.length > 0 && <p className="send-status" role="status">Delivery to {uncertain.map((person) => person.personName).join(", ")} could not be confirmed. Retry uses the same message and send ID.</p>}
    {failed.length > 0 && <p className="error" role="alert">Could not send to {failed.map((person) => `${person.personName}: ${delivery[person.personId].error}`).join("; ")}</p>}
    <button className="send" disabled={!body.trim() || sending} onClick={() => void send()}>{sending ? "Sending…" : delivered.length || failed.length || uncertain.length ? `Retry for ${pending.length} ${pending.length === 1 ? "friend" : "friends"}` : `Send to ${people.length} friends`}<span aria-hidden>↗</span></button>
  </section>;
}
