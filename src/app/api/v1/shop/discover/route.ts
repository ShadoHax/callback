import { z } from "zod";
import { currentScanContext } from "@/lib/commerce/scan-context";
import { discover } from "@/lib/commerce/discovery";
import { Budget, Purpose, json, shoppingSearcher } from "@/lib/commerce/route-helpers";

const Input = z.object({ scanId: z.string().uuid(), purpose: Purpose, budgetCents: Budget.optional(), storeLocationId: z.string().regex(/^\d{8}$/).optional() });

export async function POST(request: Request) {
  const auth = await shoppingSearcher();
  if ("response" in auth) return auth.response;
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "A valid scan and purpose are required." }, 400);
  const loaded = await currentScanContext(auth.supabase, auth.user.id, input.data.scanId);
  if ("error" in loaded) return json({ error: loaded.error }, loaded.status);
  try { return json(await discover(loaded.context, input.data)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Could not find products." }, 400); }
}
