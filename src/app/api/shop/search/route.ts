import { z } from "zod";
import { currentScanContext } from "@/lib/commerce/scan-context";
import { json, shoppingSearcher } from "@/lib/commerce/route-helpers";
import { shoppingSearchLinks } from "@/lib/commerce/live-search";

const Input = z.object({ scanId: z.string().uuid() });

export async function POST(request: Request) {
  const auth = await shoppingSearcher();
  if ("response" in auth) return auth.response;
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return json({ error: "A valid scan is required." }, 400);
  const loaded = await currentScanContext(auth.supabase, auth.user.id, input.data.scanId);
  if ("error" in loaded) return json({ error: loaded.error }, loaded.status);
  try { return json(shoppingSearchLinks(loaded.context.observed)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : "Could not search for this item." }, 502); }
}
