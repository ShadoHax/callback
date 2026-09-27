import { z } from "zod";
import { adminSupabase } from "@/lib/admin-supabase";
import { placeArActivityTestOrder, verifyArActivityCart } from "@/lib/ar-activity";
import { corpusRevision } from "@/lib/corpus";
import { Source } from "@/lib/decision";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { configured, serverSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 30;
const Input = z.object({ checkoutToken: z.string().min(1).max(20_000), expectedTotalCents: z.number().int().positive() });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  if (!configured()) return reply({ error: "Sign in before approving a TEST cart." }, 503);
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in before approving a TEST cart." }, 401);
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: "Review the TEST total before approving." }, 400);
  try {
    const verified = verifyArActivityCart(input.data.checkoutToken, user.id, input.data.expectedTotalCents);
    if (!verified) return reply({ error: "This TEST quote expired or changed. Review a new cart." }, 409);
    const admin = adminSupabase();
    const { data, error } = await admin.from("sources")
      .select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
      .eq("owner_id", user.id).limit(SOURCE_INDEX_LIMIT + 1);
    if (error || (data?.length ?? 0) > SOURCE_INDEX_LIMIT) return reply({ error: "Could not verify your current messages." }, 503);
    const parsed = Source.array().safeParse(data ?? []);
    if (!parsed.success) return reply({ error: "Could not verify your current messages." }, 503);
    if (corpusRevision(parsed.data) !== verified.token.corpusRevision)
      return reply({ error: "Your messages changed. Review a new TEST cart." }, 409);
    const order = await placeArActivityTestOrder({ checkoutToken: input.data.checkoutToken, ownerId: user.id,
      expectedTotalCents: input.data.expectedTotalCents });
    return reply(order);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEST order failed.";
    console.error("ar_activity.order_failed", JSON.stringify({ message }));
    return reply({ error: message }, message.includes("not configured") ? 503 : message.includes("expired") ? 409 : 502);
  }
}
