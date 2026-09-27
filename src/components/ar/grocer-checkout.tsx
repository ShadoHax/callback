"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { GrocerCart } from "@/lib/ar-grocer-cart";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const panel: CSSProperties = {
  border: "1px solid #d9e4d5", borderRadius: 16,
  padding: "14px", background: "#f0f5ec", color: "#26392a",
};
const muted: CSSProperties = { margin: "6px 0 0", fontSize: 14, lineHeight: 1.45, color: "#536951" };

function savedPrice(item: GrocerCart["items"][number]): boolean {
  return "priceSource" in item && item.priceSource === "cached";
}

function checkedDate(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(date);
}

function stripeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" &&
      !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function listingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function errorMessage(payload: unknown): string {
  if (payload && typeof payload === "object" && "error" in payload &&
      typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return "Could not start test checkout. Please try again.";
}

export function GrocerCheckout({ carts }: { carts: GrocerCart[] }) {
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [error, setError] = useState<{ token: string; message: string } | null>(null);
  const inFlight = useRef(false);

  async function startCheckout(cart: GrocerCart) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPendingToken(cart.checkoutToken);
    setError(null);
    try {
      const response = await fetch("/api/ar/activity/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ checkoutToken: cart.checkoutToken, expectedTotalCents: cart.subtotalCents }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(payload));
      const checkoutUrl = payload && typeof payload === "object" && "checkoutUrl" in payload
        ? stripeCheckoutUrl(payload.checkoutUrl) : null;
      if (!checkoutUrl) throw new Error("The checkout link was invalid. Please try again.");
      window.location.assign(checkoutUrl);
    } catch (cause) {
      setError({ token: cart.checkoutToken, message: cause instanceof Error ? cause.message : "Could not start test checkout. Please try again." });
    } finally {
      inFlight.current = false;
      setPendingToken(null);
    }
  }

  if (carts.length === 0) return (
    <section style={panel} aria-label="Grocery checkout">
      <strong>No complete single grocer cart yet</strong>
      <p style={muted}>These listings cannot be combined into one checkout. Review the individual offers for each ingredient below.</p>
    </section>
  );

  return (
    <section aria-label="Grocery checkout" style={{ display: "grid", gap: 12 }}>
      {carts.map((cart) => {
        const busy = pendingToken === cart.checkoutToken;
        const cachedItems = cart.items.filter(savedPrice);
        const allCached = cachedItems.length === cart.items.length;
        const oldestCachedAt = cachedItems.reduce<string | null>((oldest, item) =>
          !oldest || item.observedAt < oldest ? item.observedAt : oldest, null);
        const savedDate = oldestCachedAt ? checkedDate(oldestCachedAt) : null;
        return <article key={cart.checkoutToken} style={panel}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15 }}>{cart.merchant}</strong>
            <strong style={{ fontSize: 16 }}>{money.format(cart.subtotalCents / 100)}</strong>
          </div>
          <p style={muted}>{allCached ? `Saved listing prices${savedDate ? ` · checked ${savedDate}` : ""}` : cachedItems.length ? "Includes saved listing prices" : "Listed subtotal"} · {cart.items.length} {cart.items.length === 1 ? "item" : "items"} at this grocer</p>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 650, padding: "5px 0" }}>Review all groceries</summary>
            <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 8 }}>
              {cart.items.map((item, index) => <li key={`${item.merchantUrl}-${index}`} style={{ borderTop: "1px solid #d8e3d4", paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 12, fontSize: 16 }}>
                <span style={{ minWidth: 0 }}><strong>{item.title}</strong><br /><span style={{ color: "#536951", fontSize: 14 }}>{item.query} · {item.quantity} × {money.format(item.unitPriceCents / 100)}</span>
                  {savedPrice(item) && <><br /><span style={{ color: "#536951", fontSize: 14 }}>Saved listing price{checkedDate(item.observedAt) ? ` · checked ${checkedDate(item.observedAt)}` : ""}</span></>}
                  {listingUrl(item.merchantUrl) && <><br /><a href={listingUrl(item.merchantUrl)!} target="_blank" rel="noopener noreferrer" style={{ color: "#276042", fontSize: 14, fontWeight: 700, display: "inline-flex", minHeight: 40, alignItems: "center", textDecoration: "underline", textUnderlineOffset: 2 }}>View listing ↗</a></>}
                </span>
                <strong style={{ whiteSpace: "nowrap" }}>{money.format(item.lineTotalCents / 100)}</strong>
              </li>)}
            </ul>
          </details>
          <p style={{ ...muted, margin: "10px 0" }}>Test payment — no groceries ordered. Listed subtotal; delivery and tax not included.</p>
          <button type="button" disabled={pendingToken !== null} onClick={() => void startCheckout(cart)}
            style={{ width: "100%", minHeight: 48, border: 0, borderRadius: 11, padding: "10px 14px", background: "#254d35", color: "#fff", fontWeight: 750, fontSize: 16, cursor: pendingToken ? "wait" : "pointer", opacity: pendingToken && !busy ? .65 : 1 }}>
            {busy ? "Opening Stripe test checkout…" : "Buy all · Stripe test checkout"}
          </button>
          {error?.token === cart.checkoutToken && <p role="alert" style={{ margin: "9px 0 0", color: "#833d30", fontSize: 14 }}>{error.message} Tap the button to retry.</p>}
        </article>;
      })}
    </section>
  );
}
