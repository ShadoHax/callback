"use client";

import { useEffect, useState, type CSSProperties } from "react";

type Notice =
  | { kind: "checking" }
  | { kind: "paid"; merchant: string; subtotalCents: number }
  | { kind: "unconfirmed" }
  | { kind: "error" }
  | { kind: "cancelled" };

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const noticeStyle: CSSProperties = {
  position: "fixed", zIndex: 30, top: "calc(12px + env(safe-area-inset-top))",
  left: "50%", transform: "translateX(-50%)", boxSizing: "border-box",
  width: "min(440px, calc(100vw - 24px))", padding: "14px 48px 14px 16px",
  border: "1px solid #cbdcc8", borderRadius: 14, background: "#f5faf2",
  color: "#203d2b", boxShadow: "0 12px 32px #0005", lineHeight: 1.4,
};

export function GrocerReceipt() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const state = url.searchParams.get("grocer_checkout");
    if (state === "cancelled") {
      queueMicrotask(() => { if (active) setNotice({ kind: "cancelled" }); });
      return () => { active = false; };
    }
    if (state !== "success") return;
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId || sessionId.length > 255 || !/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) {
      queueMicrotask(() => { if (active) setNotice({ kind: "error" }); });
      return () => { active = false; };
    }
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setNotice({ kind: "checking" }); });
    void fetch(`/api/ar/activity/checkout?sessionId=${encodeURIComponent(sessionId)}`, {
      method: "GET", cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Verification failed");
      const payload: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!payload || typeof payload !== "object" || !("paid" in payload) || typeof payload.paid !== "boolean")
        throw new Error("Invalid verification result");
      if (!payload.paid) { setNotice({ kind: "unconfirmed" }); return; }
      if (!("merchant" in payload) || typeof payload.merchant !== "string" || !payload.merchant.trim() ||
          !("subtotalCents" in payload) || typeof payload.subtotalCents !== "number" ||
          !Number.isSafeInteger(payload.subtotalCents) || payload.subtotalCents <= 0)
        throw new Error("Invalid verification result");
      setNotice({ kind: "paid", merchant: payload.merchant, subtotalCents: payload.subtotalCents });
    }).catch(() => { if (!controller.signal.aborted) setNotice({ kind: "error" }); });
    return () => { active = false; controller.abort(); };
  }, []);

  function dismiss() {
    const url = new URL(window.location.href);
    url.searchParams.delete("grocer_checkout");
    url.searchParams.delete("session_id");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setNotice(null);
  }

  if (!notice) return null;
  const title = notice.kind === "paid" ? "Test payment complete"
    : notice.kind === "cancelled" ? "Test checkout cancelled"
    : notice.kind === "checking" ? "Checking test payment…"
    : notice.kind === "unconfirmed" ? "Test payment not confirmed"
    : "Could not verify test payment";
  return <aside role="status" aria-live="polite" style={noticeStyle}>
    <strong style={{ display: "block", fontSize: 16 }}>{title}</strong>
    {notice.kind === "paid" && <span style={{ display: "block", marginTop: 4, fontSize: 14 }}>{notice.merchant} · {money.format(notice.subtotalCents / 100)}</span>}
    {notice.kind !== "checking" && <span style={{ display: "block", marginTop: 4, fontSize: 14 }}>No groceries ordered or charged.</span>}
    <button type="button" aria-label="Dismiss checkout notice" onClick={dismiss} style={{ position: "absolute", top: 7, right: 8, width: 36, height: 36, border: 0, borderRadius: 8, background: "transparent", color: "#203d2b", fontSize: 24, cursor: "pointer" }}>×</button>
  </aside>;
}
