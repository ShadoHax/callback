import { z } from "zod";
import { adminSupabase } from "@/lib/admin-supabase";
import { appOrigin, json, shopper } from "@/lib/commerce/route-helpers";
import { CommerceError, approve } from "@/lib/commerce/orders";
import { publicOrder, supabaseOrderStore } from "@/lib/commerce/store";
import { stripeConfigured, stripeProvider } from "@/lib/commerce/stripe";
import { currentScanContext } from "@/lib/commerce/scan-context";

const Input = z.object({ expectedTotalCents: z.number().int().positive() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await shopper();
  if ("response" in auth) return auth.response;
  if (!stripeConfigured()) return json({ error: "Test checkout isn't configured yet (needs a Stripe test key). Nothing was charged." }, 503);
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Approve the total you reviewed." }, 400);
  const { id } = await context.params;
  try {
    const store = supabaseOrderStore(adminSupabase());
    const order = await store.get(id, auth.user.id);
    if (!order) return json({ error: "Order not found." }, 404);
    if (order.status === "quoted") {
      const context = await currentScanContext(auth.supabase, auth.user.id, order.scan_id);
      if ("error" in context) return json({ error: context.error }, context.status);
    }
    const result = await approve(store, stripeProvider(), { ownerId: auth.user.id, orderId: id, expectedTotalCents: input.data.expectedTotalCents, origin: appOrigin(request) });
    return json({ kind: result.kind, url: result.kind === "redirect" ? result.url : undefined, order: publicOrder(result.order) }, result.kind === "redirect" || result.kind === "done" ? 200 : 409);
  } catch (cause) {
    if (cause instanceof CommerceError) return json({ error: cause.message }, cause.status);
    return json({ error: "Could not approve this order." }, 500);
  }
}
