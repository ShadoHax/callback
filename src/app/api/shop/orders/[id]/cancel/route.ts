import { adminSupabase } from "@/lib/admin-supabase";
import { json, shopper } from "@/lib/commerce/route-helpers";
import { CommerceError, cancelOrder } from "@/lib/commerce/orders";
import { publicOrder, supabaseOrderStore } from "@/lib/commerce/store";
import { stripeConfigured, stripeProvider } from "@/lib/commerce/stripe";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await shopper();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const store = supabaseOrderStore(adminSupabase());
  try {
    const provider = stripeConfigured() ? stripeProvider() : { name: "none", createCheckout: async () => { throw new Error("unavailable"); }, retrieve: async () => { throw new Error("unavailable"); }, expire: async () => {} };
    const order = await cancelOrder(store, provider, { ownerId: auth.user.id, orderId: id });
    return json({ order: order ? publicOrder(order) : null });
  } catch (cause) {
    if (cause instanceof CommerceError) return json({ error: cause.message }, cause.status);
    return json({ error: "Could not cancel. Check the order status before trying again." }, 502);
  }
}
