import { z } from "zod";
import { adminSupabase } from "@/lib/admin-supabase";
import { Budget, Kind, Purpose, json, shopper } from "@/lib/commerce/route-helpers";
import { currentScanContext } from "@/lib/commerce/scan-context";
import { CommerceError, createQuote } from "@/lib/commerce/orders";
import { publicOrder, supabaseOrderStore } from "@/lib/commerce/store";

const Input = z.object({ scanId: z.string().uuid(), productId: z.string().min(1).max(80), budgetCents: Budget, purpose: Purpose, preference: Kind.optional(), clientRequestId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await shopper();
  if ("response" in auth) return auth.response;
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Invalid quote request." }, 400);
  const loaded = await currentScanContext(auth.supabase, auth.user.id, input.data.scanId);
  if ("error" in loaded) return json({ error: loaded.error }, loaded.status);
  try {
    const order = await createQuote(supabaseOrderStore(adminSupabase()), { ownerId: auth.user.id, context: loaded.context, ...input.data });
    return json({ order: publicOrder(order) }, 201);
  } catch (cause) {
    if (cause instanceof CommerceError) return json({ error: cause.message }, cause.status);
    return json({ error: "Could not create the quote." }, 500);
  }
}
