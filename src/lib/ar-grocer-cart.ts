import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { z } from "zod";
import type { IngredientOffer } from "./ar-shopping-discovery";
import type { Offer } from "./commerce/discovery";

const QUOTE_MS = 10 * 60_000;
const retailers = [
  { key: "walmart", name: "Walmart", names: ["walmart", "walmart.com"], domains: ["walmart.com"] },
  { key: "kroger", name: "Kroger", names: ["kroger", "kroger.com"], domains: ["kroger.com"] },
  { key: "target", name: "Target", names: ["target", "target.com"], domains: ["target.com"] },
  { key: "whole-foods", name: "Whole Foods Market", names: ["whole foods", "whole foods market"], domains: ["wholefoodsmarket.com", "amazon.com"] },
  { key: "publix", name: "Publix", names: ["publix", "publix super markets"], domains: ["publix.com"] },
  { key: "safeway", name: "Safeway", names: ["safeway", "safeway.com"], domains: ["safeway.com"] },
  { key: "aldi", name: "ALDI", names: ["aldi", "aldi us"], domains: ["aldi.us", "aldi.com"] },
  { key: "heb", name: "H-E-B", names: ["h-e-b", "heb", "heb.com"], domains: ["heb.com"] },
  { key: "food-lion", name: "Food Lion", names: ["food lion"], domains: ["foodlion.com"] },
  { key: "hy-vee", name: "Hy-Vee", names: ["hy-vee", "hy vee", "hy-vee, inc."], domains: ["hy-vee.com"] },
  { key: "meijer", name: "Meijer", names: ["meijer", "meijer.com"], domains: ["meijer.com"] },
  { key: "wegmans", name: "Wegmans", names: ["wegmans"], domains: ["wegmans.com"] },
  { key: "costco", name: "Costco", names: ["costco", "costco wholesale"], domains: ["costco.com"] },
  { key: "sams-club", name: "Sam's Club", names: ["sam's club", "sams club"], domains: ["samsclub.com"] },
] as const;
type Retailer = (typeof retailers)[number];

function retailerFor(offer: Offer): Retailer | null {
  const name = offer.merchant.trim().toLowerCase().replace(/\s+/g, " ");
  const retailer = retailers.find((candidate) => (candidate.names as readonly string[]).includes(name));
  if (!retailer) return null;
  let host: string;
  try {
    const url = new URL(offer.merchantUrl);
    if (url.protocol !== "https:") return null;
    host = url.hostname.toLowerCase();
  } catch { return null; }
  // Google Shopping may link to a listing intermediary. Other domains must belong to the named retailer.
  const googleShopping = host === "google.com" || host.endsWith(".google.com");
  if (!googleShopping && !(retailer.domains as readonly string[]).some((domain) => host === domain || host.endsWith(`.${domain}`))) return null;
  return retailer;
}

export function recognizedGrocer(offer: Offer): string | null {
  return retailerFor(offer)?.name ?? null;
}

const Item = z.object({
  query: z.string().min(1).max(100), title: z.string().min(1).max(300), merchantUrl: z.url().max(2000),
  imageUrl: z.url().max(2000).nullable(), unitPriceCents: z.number().int().min(1).max(1_000_000),
  quantity: z.number().int().min(1).max(24), lineTotalCents: z.number().int().positive(),
  observedAt: z.iso.datetime(), priceSource: z.enum(["cached", "live"]).optional(),
});
export type GrocerCartItem = z.infer<typeof Item>;
export type GrocerCart = { merchant: string; items: GrocerCartItem[]; subtotalCents: number; checkoutToken: string; expiresAt: string };
const Quote = z.object({ kind: z.literal("grocer-cart-v1"), ownerId: z.string().min(1).max(100),
  nonce: z.uuid(), exp: z.number().int().positive(), merchantKey: z.string(), merchant: z.string(),
  items: z.array(Item).min(1).max(12), subtotalCents: z.number().int().positive().max(10_000_000) });

function signingKey() {
  const dedicated = process.env.PREVIEW_SIGNING_SECRET;
  if (dedicated && dedicated.length < 32) throw new Error("PREVIEW_SIGNING_SECRET must be at least 32 characters.");
  const secret = dedicated || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Grocer cart signing is not configured.");
  return Buffer.from(hkdfSync("sha256", secret, "callback-ar-grocer-cart", "grocer-cart-signing-v1", 32));
}
function signature(body: string) {
  return createHmac("sha256", signingKey()).update(`callback-ar-grocer-cart-v1:${body}`).digest();
}
function sign(quote: z.infer<typeof Quote>) {
  const body = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${body}.${signature(body).toString("base64url")}`;
}
function decode(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 40_000) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const expected = signature(parts[0]);
  let actual: Buffer;
  try { actual = Buffer.from(parts[1], "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return null; }
}

function validListing(offer: Offer) {
  return Boolean(retailerFor(offer) && offer.title.trim() && offer.price.currency === "USD" &&
    Number.isInteger(offer.price.amountCents) && offer.price.amountCents > 0 && offer.price.amountCents <= 1_000_000 &&
    !Number.isNaN(Date.parse(offer.price.observedAt)));
}

/** Returns only complete carts: one observed listing for every requirement from the same named grocer. */
export function buildGrocerCarts(ingredients: readonly IngredientOffer[], ownerId: string): GrocerCart[] {
  if (!ownerId || !ingredients.length || ingredients.length > 12) return [];
  if (ingredients.some((ingredient) => !Number.isInteger(ingredient.quantity) || ingredient.quantity < 1 || ingredient.quantity > 24 ||
    !ingredient.query.trim())) return [];
  const choices = ingredients.map((ingredient) => {
    const byRetailer = new Map<string, Offer>();
    for (const offer of ingredient.offers) {
      if (!validListing(offer)) continue;
      const retailer = retailerFor(offer)!;
      const previous = byRetailer.get(retailer.key);
      if (!previous || offer.price.amountCents < previous.price.amountCents) byRetailer.set(retailer.key, offer);
    }
    return byRetailer;
  });
  if (choices.some((choice) => !choice.size)) return [];
  const expiresAtMs = Date.now() + QUOTE_MS;
  const carts: GrocerCart[] = [];
  for (const retailer of retailers) {
    if (!choices.every((choice) => choice.has(retailer.key))) continue;
    const items = ingredients.map((ingredient, index): GrocerCartItem => {
      const offer = choices[index].get(retailer.key)!;
      return { query: ingredient.query, title: offer.title, merchantUrl: offer.merchantUrl,
        imageUrl: offer.imageUrl, unitPriceCents: offer.price.amountCents, quantity: ingredient.quantity,
        lineTotalCents: offer.price.amountCents * ingredient.quantity, observedAt: offer.price.observedAt,
        priceSource: offer.source.provider === "searchapi-cache" ? "cached" : "live" };
    });
    const subtotalCents = items.reduce((total, item) => total + item.lineTotalCents, 0);
    if (subtotalCents > 10_000_000) continue;
    const quote = Quote.parse({ kind: "grocer-cart-v1", ownerId, nonce: randomUUID(), exp: expiresAtMs,
      merchantKey: retailer.key, merchant: retailer.name, items, subtotalCents });
    carts.push({ merchant: retailer.name, items, subtotalCents, checkoutToken: sign(quote), expiresAt: new Date(expiresAtMs).toISOString() });
  }
  return carts.sort((a, b) => a.subtotalCents - b.subtotalCents || a.merchant.localeCompare(b.merchant));
}

export function verifyGrocerCartQuote(raw: unknown, ownerId: string, expectedTotalCents: number) {
  const parsed = Quote.safeParse(decode(raw));
  if (!parsed.success || parsed.data.ownerId !== ownerId || parsed.data.exp <= Date.now() ||
      parsed.data.subtotalCents !== expectedTotalCents) return null;
  const quote = parsed.data;
  const retailer = retailers.find((candidate) => candidate.key === quote.merchantKey && candidate.name === quote.merchant);
  if (!retailer || quote.items.some((item) => item.lineTotalCents !== item.unitPriceCents * item.quantity ||
    retailerFor({ merchant: retailer.name, merchantUrl: item.merchantUrl } as Offer)?.key !== retailer.key) ||
    quote.items.reduce((total, item) => total + item.lineTotalCents, 0) !== quote.subtotalCents) return null;
  return quote;
}

function testStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) throw new Error("Stripe TEST mode is not configured.");
  return key;
}

/** A Stripe TEST payment for observed listing amounts. No retailer order or fulfillment is placed. */
export async function createGrocerCheckout(input: { checkoutToken: string; ownerId: string; expectedTotalCents: number; origin: string }) {
  const quote = verifyGrocerCartQuote(input.checkoutToken, input.ownerId, input.expectedTotalCents);
  if (!quote) throw new Error("This grocer quote expired or changed. Review a new cart.");
  const origin = new URL(input.origin);
  if (!(["https:", "http:"].includes(origin.protocol) && (origin.protocol === "https:" || ["localhost", "127.0.0.1"].includes(origin.hostname))))
    throw new Error("App origin is invalid.");
  const stripe = new Stripe(testStripeKey());
  const session = await stripe.checkout.sessions.create({
    mode: "payment", payment_method_types: ["card"],
    line_items: quote.items.map((item) => ({ quantity: item.quantity, price_data: { currency: "usd", unit_amount: item.unitPriceCents,
      product_data: { name: item.title.slice(0, 300), description: `Observed ${quote.merchant} listing; TEST payment only, no merchant order or fulfillment.` } } })),
    client_reference_id: quote.nonce,
    metadata: { demo: "ar_grocer", owner_id: quote.ownerId, quote_nonce: quote.nonce, merchant: quote.merchant,
      fulfillment: "not_created", listing_subtotal_cents: String(quote.subtotalCents) },
    success_url: `${origin.origin}/ar?grocer_checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin.origin}/ar?grocer_checkout=cancelled`,
    expires_at: Math.floor(quote.exp / 1000) + 31 * 60,
  }, { idempotencyKey: `ar-grocer-${createHash("sha256").update(input.checkoutToken).digest("hex")}` });
  if (!session.url || session.livemode || session.amount_total !== quote.subtotalCents || session.currency !== "usd")
    throw new Error("Stripe returned an invalid TEST checkout session.");
  return { checkoutUrl: session.url };
}

/** Confirms a returned Stripe TEST session belongs to this signed-in owner and has no merchant fulfillment. */
export async function getGrocerCheckoutStatus(sessionId: string, ownerId: string) {
  if (!/^cs_test_[A-Za-z0-9_]+$/.test(sessionId)) return null;
  const stripe = new Stripe(testStripeKey());
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session.metadata;
  if (session.livemode || session.mode !== "payment" || session.currency !== "usd" ||
      metadata?.demo !== "ar_grocer" || metadata.owner_id !== ownerId || metadata.fulfillment !== "not_created" ||
      !retailers.some((retailer) => retailer.name === metadata.merchant) ||
      !Number.isSafeInteger(session.amount_total) || session.amount_total !== Number(metadata.listing_subtotal_cents)) return null;
  return { paid: session.payment_status === "paid" && session.status === "complete",
    merchant: metadata.merchant, subtotalCents: session.amount_total as number };
}
