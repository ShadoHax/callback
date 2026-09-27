import { z } from "zod";
import { configured, serverSupabase } from "../supabase";
import { MERCHANT } from "./catalog";
import { stripeConfigured } from "./stripe";

export const commerceEnabled = () => process.env.COMMERCE_ENABLED === "true";
export const shopConfig = () => ({ enabled: commerceEnabled(), checkout: stripeConfigured() ? "stripe_test" : null, merchant: MERCHANT });
export const Purpose = z.discriminatedUnion("kind", [z.object({ kind: z.literal("self") }), z.object({ kind: z.literal("gift"), personId: z.string().min(1).max(100) }), z.object({ kind: z.literal("together"), personId: z.string().min(1).max(100) })]);
export const Budget = z.number().int().min(100).max(1_000_000);
export const Kind = z.enum(["base", "standalone", "expansion", "accessory", "camera", "coffee"]);
const headers = { "cache-control": "private, no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

/** Common gate for shopper routes: commerce on, Supabase configured, and a signed-in owner. */
export async function shopper() {
  if (!commerceEnabled()) return { response: json({ error: "Shopping is turned off." }, 404) } as const;
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { response: json({ error: "Shopping is not configured." }, 503) } as const;
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: json({ error: "Sign in to shop." }, 401) } as const;
  return { supabase, user } as const;
}

/** Signed-in shopping discovery can show product information and outbound searches even when test checkout is off. */
export async function shoppingSearcher() {
  if (!configured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { response: json({ error: "Shopping search is not configured." }, 503) } as const;
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: json({ error: "Sign in to search for this item." }, 401) } as const;
  return { supabase, user } as const;
}

export function appOrigin(request: Request) {
  return (process.env.APP_ORIGIN || new URL(request.url).origin).replace(/\/$/, "");
}
