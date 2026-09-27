import { z } from "zod";
import { adminSupabase } from "@/lib/admin-supabase";
import { AR_ACTIVITY_ACTIONS, planArActivity, verifyArConnection } from "@/lib/ar-activity";
import { planArShopping } from "@/lib/ar-shopping-plan";
import { discoverIngredientOffers } from "@/lib/ar-shopping-discovery";
import { completeGrocerCarts } from "@/lib/ar-grocer-discovery";
import { searchNearbyPlaces } from "@/lib/ar-nearby";
import { corpusRevision } from "@/lib/corpus";
import { Source } from "@/lib/decision";
import { SOURCE_INDEX_LIMIT } from "@/lib/source-selection";
import { configured, serverSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 90;
const Input = z.object({ connectionToken: z.string().min(1).max(16_000), action: z.enum(AR_ACTIVITY_ACTIONS).default("shop"),
  location: z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).optional() });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request) {
  if (!configured()) return reply({ error: "Sign in to prepare this activity." }, 503);
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return reply({ error: "Sign in to prepare this activity." }, 401);
  const input = Input.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: "Open a verified connection first." }, 400);
  try {
    const connection = verifyArConnection(input.data.connectionToken, user.id);
    if (!connection) return reply({ error: "This connection expired. Scan the item again." }, 401);
    const admin = adminSupabase();
    const { data, error } = await admin.from("sources")
      .select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
      .eq("owner_id", user.id).limit(SOURCE_INDEX_LIMIT + 1);
    if (error || (data?.length ?? 0) > SOURCE_INDEX_LIMIT) return reply({ error: "Could not verify your current messages." }, 503);
    const parsed = Source.array().safeParse(data ?? []);
    if (!parsed.success) return reply({ error: "Could not verify your current messages." }, 503);
    if (corpusRevision(parsed.data) !== connection.corpusRevision)
      return reply({ error: "Your messages changed. Scan again for a current connection." }, 409);
    const byId = new Map(parsed.data.map((source) => [source.id, source]));
    const cited = connection.sourceIds.map((id) => byId.get(id));
    if (cited.some((source) => !source) || !cited.some((source) => source?.speaker_id === connection.personId) ||
        cited.some((source) => source && source.speaker_id !== connection.personId && !source.participant_ids.includes(connection.personId)))
      return reply({ error: "The cited messages no longer support this connection." }, 409);
    const sources = cited as Source[];
    if (input.data.action === "shop") {
      const started = Date.now();
      const planned = await planArShopping({ identification: connection.identification, sources, personId: connection.personId, signal: request.signal });
      if (!planned.supported) return reply(planned);
      if (request.signal.aborted) throw new Error("Shopping request was cancelled.");
      const shopping = await discoverIngredientOffers(planned.requirements, { signal: request.signal, offerLimit: 30, useSavedPrices: true });
      const carts = await completeGrocerCarts(shopping.ingredients, user.id, request.signal);
      const displayShopping = { ...shopping, carts, ingredients: shopping.ingredients.map(item => ({ ...item, offers: item.offers.slice(0, 3) })) };
      return reply({ supported: true, action: "shop", plan: planned.plan, shopping: displayShopping, model: planned.model, timingMs: Date.now() - started });
    }
    const activity = await planArActivity({ identification: connection.identification, sources, personId: connection.personId,
      action: input.data.action, signal: request.signal });
    if (!activity.supported) return reply({ supported: false, action: activity.action, reason: activity.reason, model: activity.model, timingMs: activity.timingMs });
    if (activity.action === "nearby") {
      const places = await searchNearbyPlaces({ query: activity.nearby.query.replace(/\s+near me\s*$/i, ""), location: input.data.location, signal: request.signal });
      return reply({ supported: true, action: activity.action, nearby: places,
      supportSourceIds: activity.supportSourceIds,
      evidence: sources.map((source) => ({ id: source.id, quote: source.original_text, sourceAt: source.source_at, synthetic: source.is_synthetic })),
      model: places.model, timingMs: activity.timingMs + places.timingMs });
    }
    return reply({ supported: true, action: activity.action, plan: activity.plan, ...(activity.shoppingNote ? { shoppingNote: activity.shoppingNote } : {}),
      evidence: sources.map((source) => ({ id: source.id, quote: source.original_text, sourceAt: source.source_at, synthetic: source.is_synthetic })),
      model: activity.model, timingMs: activity.timingMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare this activity.";
    console.error("ar_activity.prepare_failed", JSON.stringify({ message }));
    return reply({ error: message }, 503);
  }
}
