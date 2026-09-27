"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type Order = { id: string; scanId: string; status: string; statusDetail: string | null; title: string; variant: string; merchant: string; subtotalCents: number; shippingCents: number; taxCents: number; totalCents: number; provider: string | null; paidAt: string | null; checkoutSessionId: string | null; purpose: { kind: string; personId?: string } };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const terminal = new Set(["paid_test", "failed", "expired"]);

// The return page never trusts its own URL: status comes from the server, which asks Stripe directly.
export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [checks, setChecks] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let stop = false;
    let count = 0;
    async function poll() {
      try {
        const response = await fetch(`/api/shop/orders/${id}`, { cache: "no-store" });
        const payload = await response.json();
        if (stop) return;
        if (!response.ok) { setError(payload.error ?? "Couldn't load this order."); return; }
        setOrder(payload.order); setChecks(++count);
        if (!terminal.has(payload.order.status) && count < 40) setTimeout(poll, count < 10 ? 1500 : 4000);
      } catch { if (!stop) { setError("Couldn't reach the server. Refresh to check again."); } }
    }
    void poll();
    return () => { stop = true; };
  }, [id]);

  async function cancel() {
    setCancelling(true);
    try {
      const response = await fetch(`/api/shop/orders/${id}/cancel`, { method: "POST" });
      const payload = await response.json();
      if (payload.order) setOrder(payload.order); else setError(payload.error ?? "Couldn't cancel.");
    } catch { setError("Couldn't cancel. Refresh to check the status first."); }
    finally { setCancelling(false); }
  }

  return <main className="app">
    <header className="appbar"><Link href="/" className="brand">↗ callback<span>.</span></Link><nav><Link href="/inbox">Inbox</Link></nav></header>
    <h1 className="order-title">{order?.status === "paid_test" ? "Test payment confirmed" : order?.status === "checkout_pending" ? "Checking payment…" : order ? "Order status" : error ? "Order unavailable" : "Loading order…"}</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {order && <article className={`option-card review${order.status === "paid_test" ? " receipt" : ""}`}>
      <header><strong>{order.status === "paid_test" ? "TEST receipt" : order.title}</strong><span className="chip">TEST</span></header>
      <dl className="totals"><dt>{order.title}, {order.variant}</dt><dd>{money(order.subtotalCents)}</dd><dt>Shipping (demo)</dt><dd>{money(order.shippingCents)}</dd><dt>Tax (demo 7%)</dt><dd>{money(order.taxCents)}</dd><dt><strong>Total</strong></dt><dd><strong>{money(order.totalCents)}</strong></dd></dl>
      <p className="fine-print">Merchant: {order.merchant} (demo). Provider: {order.provider === "stripe_test" ? "Stripe, test mode" : "not started"}. No real money moved.</p>
      {order.status === "paid_test" && <p className="fine-print">Verified with Stripe {order.paidAt ? `at ${new Date(order.paidAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}, session {order.checkoutSessionId}. {order.purpose.kind === "gift" ? "Buying it as a gift doesn't mean they have it yet." : ""}</p>}
      {order.status === "checkout_pending" && <><p className="waiting"><span className="pulse" aria-hidden />Waiting for Stripe to confirm (check {checks}). Returning here alone doesn&apos;t count as payment.</p><button className="secondary" disabled={cancelling} onClick={cancel}>{cancelling ? "Cancelling…" : "Cancel checkout"}</button></>}
      {["failed", "expired"].includes(order.status) && <p className="notice">{order.statusDetail ?? "This order didn't complete. Nothing was charged."}</p>}
      {order.status === "quoted" && <p className="notice">Not approved yet. Go back to review it.</p>}
    </article>}
    {order && <Link className="text-button" href={`/?scan=${order.scanId}`}>Back to the scan</Link>}
  </main>;
}
