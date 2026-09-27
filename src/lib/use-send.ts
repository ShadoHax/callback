"use client";

import { useState } from "react";

export type SendPayload = { kind: "scan"; scanId: string; recipientId: string; body: string; quotedSourceId?: string } | { kind: "advice"; scanId: string; personId: string; body: string; quotedSourceId?: string } | { kind: "reply"; replyTo: string; body: string };
export type SendState =
  | { phase: "idle" }
  | { phase: "sending"; key: string; payload: SendPayload }
  | { phase: "uncertain"; key: string; payload: SendPayload }
  | { phase: "sent"; id: string; payload: SendPayload }
  | { phase: "failed"; message: string };

// One tap on Send creates one immutable payload and one key. If the response is lost, the only way forward is
// retrying that exact operation (the server answers with the original message); a changed message needs a new send.
export function useSend() {
  const [state, setState] = useState<SendState>({ phase: "idle" });

  async function attempt(key: string, payload: SendPayload) {
    setState({ phase: "sending", key, payload });
    try {
      const response = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, clientRequestId: key }) });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.id === "string") { setState({ phase: "sent", id: data.id, payload }); return data.id as string; }
      // Server errors and rate limits may or may not have stored the message: keep the same key for a safe retry.
      if (response.status >= 500 || response.status === 429) { setState({ phase: "uncertain", key, payload }); return null; }
      setState({ phase: "failed", message: data.error ?? "Could not send." });
    } catch {
      setState({ phase: "uncertain", key, payload });
    }
    return null;
  }

  return {
    state,
    busy: state.phase === "sending",
    locked: state.phase === "sending" || state.phase === "uncertain",
    send: (payload: SendPayload) => (state.phase === "sending" || state.phase === "uncertain" ? Promise.resolve(null) : attempt(crypto.randomUUID(), payload)),
    retry: () => (state.phase === "uncertain" ? attempt(state.key, state.payload) : Promise.resolve(null)),
    reset: () => setState({ phase: "idle" }),
  };
}
