import { adminSupabase } from "@/lib/admin-supabase";
import { json, shopper } from "@/lib/commerce/route-helpers";
import { verifyCheckout } from "@/lib/commerce/orders";
import { publicOrder, supabaseOrderStore } from "@/lib/commerce/store";
import { stripeConfigured, stripeProvider } from "@/lib/commerce/stripe";

// Status comes from the provider via an authenticated server-side retrieval, never from the return URL.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await shopper();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const store = supabaseOrderStore(adminSupabase());
  let order = await store.get(id, auth.user.id).catch(() => null);
  if (!order) return json({ error: "Order not found." }, 404);
  if (order.status === "checkout_pending" && order.checkout_session_id && stripeConfigured()) {
    try { order = (await verifyCheckout(store, stripeProvider(), order.checkout_session_id)) ?? order; }
    catch { return json({ order: publicOrder(order), verification: "unavailable" }); }
  }
  return json({ order: publicOrder(order), verification: "provider" });
}
