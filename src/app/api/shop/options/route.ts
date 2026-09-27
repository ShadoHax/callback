import { z } from "zod";
import { Budget, Kind, Purpose, json, shopper } from "@/lib/commerce/route-helpers";
import { currentScanContext } from "@/lib/commerce/scan-context";
import { shoppingOptions } from "@/lib/commerce/options";

const Input = z.object({ scanId: z.string().uuid(), budgetCents: Budget, purpose: Purpose, preference: Kind.optional() });

export async function POST(request: Request) {
  const auth = await shopper();
  if ("response" in auth) return auth.response;
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "Enter a budget and choose who it's for." }, 400);
  const loaded = await currentScanContext(auth.supabase, auth.user.id, input.data.scanId);
  if ("error" in loaded) return json({ error: loaded.error }, loaded.status);
  try { return json(shoppingOptions(loaded.context, input.data)); }
  catch (cause) { return json({ error: cause instanceof Error ? cause.message : "Could not build options." }, 400); }
}
