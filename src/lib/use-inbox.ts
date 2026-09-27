"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserSupabase } from "./browser-supabase";

export type Message = {
  id: string; sender_id: string; sender_name?: string | null; recipient_id: string; body: string; created_at: string;
  scan_id?: string | null; reply_to?: string | null; purpose?: string | null; about_person_id?: string | null; quoted_text?: string | null; quoted_at?: string | null; imageUrl?: string | null;
};

// Realtime pushes new rows the moment they are inserted; polling covers a dropped socket on venue Wi-Fi.
export function useInbox(onIncoming?: (message: Message) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [userId, setUserId] = useState("");
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const latestLoad = useRef(0);
  const inFlight = useRef<Promise<void> | null>(null);
  const active = useRef(true);
  const requestAbort = useRef<AbortController | null>(null);
  const consecutiveFailures = useRef(0);
  const seen = useRef<Set<string> | null>(null);
  const incoming = useRef(onIncoming);
  useEffect(() => { incoming.current = onIncoming; });

  const load = useCallback(async () => {
    // Realtime callbacks, the fallback timer, and manual refresh can all land together.
    // Share one request instead of stacking polls and discarding every slower response.
    if (inFlight.current) return inFlight.current;
    const request = ++latestLoad.current;
    const controller = new AbortController();
    requestAbort.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    const task = (async () => {
      try {
        const response = await fetch("/api/messages", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (request !== latestLoad.current) return;
        if (!response.ok) throw new Error(data.error ?? "Could not load messages.");
        const list: Message[] = data.messages ?? [];
        if (seen.current) for (const message of list) if (!seen.current.has(message.id) && message.recipient_id === data.userId) incoming.current?.(message);
        seen.current = new Set(list.map((message) => message.id));
        consecutiveFailures.current = 0;
        setMessages(list); setUserId(data.userId ?? ""); setError("");
      } catch (cause) {
        if (request !== latestLoad.current || controller.signal.aborted && requestAbort.current !== controller) return;
        consecutiveFailures.current++;
        // A single missed poll is normal on mobile/venue networks. Realtime or the next
        // scheduled poll can recover without flashing an error or stopping the loop.
        if (consecutiveFailures.current >= 3) setError(cause instanceof Error && cause.message && cause.name !== "AbortError" ? cause.message : "Live updates are reconnecting. Messages will keep retrying.");
      } finally {
        window.clearTimeout(timeout);
        if (requestAbort.current === controller) requestAbort.current = null;
        if (request === latestLoad.current) setLoading(false);
        inFlight.current = null;
      }
    })();
    inFlight.current = task;
    return task;
  }, []);

  // A push or explicit refresh may arrive while an older GET is still producing a stale snapshot.
  // Let it finish, then coalesce all such requests into one new GET. Fallback polls still share the pending GET.
  const refresh = useCallback(async () => {
    const pending = inFlight.current;
    if (pending) await pending;
    if (!active.current) return;
    await load();
  }, [load]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await load();
      if (!stopped) timer = setTimeout(poll, live ? 15000 : 4000);
    };
    timer = setTimeout(poll, 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [load, live]);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; requestAbort.current?.abort(); requestAbort.current = null; };
  }, []);

  useEffect(() => {
    const client = browserSupabase();
    if (!client || !userId) return;
    let channel: RealtimeChannel | undefined;
    let cancelled = false;
    client.auth.getSession().then(async ({ data }) => {
      if (cancelled || !data.session) return;
      await client.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      // A joined socket can precede the database subscription. Keep polling until changes are actually ready.
      channel = client.channel(`inbox-${userId}`, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `recipient_id=eq.${userId}` }, () => { void refresh(); })
        .subscribe((status) => setLive(status === "SUBSCRIBED"));
    }).catch(() => { if (!cancelled) setLive(false); });
    return () => { cancelled = true; setLive(false); if (channel) void client.removeChannel(channel); };
  }, [userId, refresh]);

  return { messages, userId, error, live, loading, refresh };
}
