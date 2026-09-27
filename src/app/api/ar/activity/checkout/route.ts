import { z } from "zod";
import { createGrocerCheckout, getGrocerCheckoutStatus, verifyGrocerCartQuote } from "@/lib/ar-grocer-cart";
import { appOrigin } from "@/lib/commerce/route-helpers";
import { configured, serverSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;
const Input = z.object({ checkoutToken: z.string().min(1).max(40_000), expectedTotalCents: z.number().int().positive() });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  if (!configured()) return reply({ error: "Sign in before approving a TEST grocer cart." }, 503);
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in before approving a TEST grocer cart." }, 401);
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: "Review the grocer listing total before checkout." }, 400);
  try {
    if (!verifyGrocerCartQuote(input.data.checkoutToken, user.id, input.data.expectedTotalCents))
      return reply({ error: "This grocer quote expired or changed. Review a new cart." }, 409);
    const checkout = await createGrocerCheckout({ ...input.data, ownerId: user.id, origin: appOrigin(request) });
    return reply(checkout);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEST checkout failed.";
    console.error("ar_grocer.checkout_failed", JSON.stringify({ message }));
    return reply({ error: message }, message.includes("not configured") ? 503 : message.includes("expired") ? 409 : 502);
  }
}

export async function GET(request: Request) {
  if (!configured()) return reply({ error: "Sign in to view this TEST checkout." }, 503);
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in to view this TEST checkout." }, 401);
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) return reply({ error: "A TEST checkout session is required." }, 400);
  try {
    const status = await getGrocerCheckoutStatus(sessionId, user.id);
    if (!status) return reply({ error: "This TEST checkout was not found for your account." }, 404);
    return reply(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify TEST checkout.";
    console.error("ar_grocer.checkout_status_failed", JSON.stringify({ message }));
    return reply({ error: message }, message.includes("not configured") ? 503 : 502);
  }
}
