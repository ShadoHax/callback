import type { SupabaseClient } from "@supabase/supabase-js";
import type { Order, OrderStatus, OrderStore } from "./orders";

// Orders are written only by the server (service role); owners can read their own through row-level policy.
export function supabaseOrderStore(admin: SupabaseClient): OrderStore {
  const one = async (query: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await query;
    if (error) throw new Error(`Order storage failed: ${error.message}`);
    return (data as Order | null) ?? null;
  };
  return {
    get: (id, ownerId) => { let query = admin.from("orders").select("*").eq("id", id); if (ownerId) query = query.eq("owner_id", ownerId); return one(query.maybeSingle()); },
    getBySession: (sessionId) => one(admin.from("orders").select("*").eq("checkout_session_id", sessionId).maybeSingle()),
    getByRequest: (ownerId, key) => one(admin.from("orders").select("*").eq("owner_id", ownerId).eq("client_request_id", key).maybeSingle()),
    async insert(order) {
      const { data, error } = await admin.from("orders").insert(order).select("*").single();
      if (error?.code === "23505") { const existing = await one(admin.from("orders").select("*").eq("owner_id", order.owner_id).eq("client_request_id", order.client_request_id).maybeSingle()); if (existing) return existing; }
      if (error || !data) throw new Error(`Could not save the quote: ${error?.message}`);
      return data as Order;
    },
    transition: (id, from: OrderStatus[], patch) => one(admin.from("orders").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).in("status", from).select("*").maybeSingle()),
    async recordEvent(eventId, orderId, type) {
      const { error } = await admin.from("payment_events").insert({ event_id: eventId, order_id: orderId, type });
      if (error?.code === "23505") return false;
      if (error) throw new Error(`Could not record payment event: ${error.message}`);
      return true;
    },
  };
}

/** The fields a shopper's browser may see. */
export const publicOrder = (order: Order) => ({
  id: order.id, scanId: order.scan_id, status: order.status, statusDetail: order.status_detail, productId: order.product_id, title: order.title, variant: order.variant, merchant: order.merchant,
  currency: order.currency, subtotalCents: order.subtotal_cents, shippingCents: order.shipping_cents, taxCents: order.tax_cents, totalCents: order.total_cents, budgetCents: order.budget_cents,
  purpose: order.purpose, quoteExpiresAt: order.quote_expires_at, provider: order.provider, paidAt: order.paid_at, checkoutSessionId: order.checkout_session_id,
});
