import type { ScanContext, Purpose } from "./options";
import { allowedPurposes, samePurpose } from "./options";

export type Offer = { id: string; title: string; merchant: string; merchantUrl: string; imageUrl: string | null; price: { amountCents: number; currency: "USD"; observedAt: string }; availability: "unknown"; match: "same" | "family" | "related"; reasons: string[]; caveats: string[]; source: { provider: string; position: number } };
export type Discovery = { query: string; offers: Offer[]; fallbackSearchUrl: string; status: "ok" | "no_verified_offers" | "provider_unavailable"; provider: string | null };
type Raw = Record<string, unknown>;
type ProviderResult = { provider: string; items: Raw[] };
const providerCache = new Map<string, { expiresAt: number; observedAt: string; result: ProviderResult }>();
const PROVIDER_CACHE_MS = 10 * 60 * 1000;

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}
function priceCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value * 100);
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/^\s*\$?\s*(\d+(?:\.\d{1,2})?)\s*$/);
  return match ? Math.round(Number(match[1]) * 100) : null;
}
const queryStopwords = new Set(["i", "me", "my", "you", "your", "they", "their", "want", "wants", "like", "likes", "prefer", "prefers", "please", "for", "a", "an", "the", "some", "to", "and", "of", "with"]);
function words(value: string) { return value.toLowerCase().match(/[a-z0-9]+/g) ?? []; }
function stem(word: string) { return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word; }
function productWords(value: string) { return words(value).filter((word) => !queryStopwords.has(word)).map(stem); }
function containsWords(title: string, phrase: string) {
  const expected = productWords(phrase);
  const actual = new Set(productWords(title));
  return expected.length > 0 && expected.every((word) => actual.has(word));
}
function category(context: ScanContext) { return `${context.observed.category ?? ""} ${context.observed.item}`.toLowerCase(); }
function queryFor(context: ScanContext, purpose: Purpose) {
  const observed = context.observed;
  const connection = purpose.kind === "gift" && context.connection?.personId === purpose.personId ? context.connection : null;
  const preference = connection?.relation === "prefers" ? connection.preferences?.likes.find((like) => productWords(like).length > 0) ?? connection.mention : null;
  const request = connection && ["wanted", "asked_to_find"].includes(connection.relation) ? connection.mention : null;
  const target = preference || request;
  if (target && productWords(target).length) {
    // Only extracted product terms leave this service; neither the person's identity nor their message does.
    const terms = productWords(target).slice(0, 9);
    const categoryTerms = productWords(observed.category ?? "").slice(0, 3);
    const query = [...new Set([...terms, ...categoryTerms])].join(" ").slice(0, 100);
    return { query, target: terms.join(" "), basis: preference ? "stated_preference" as const : "stated_request" as const };
  }
  return { query: (observed.title || observed.item || observed.category || "").trim().slice(0, 120), target: "", basis: "photo" as const };
}
function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
async function getJson(url: string, headers?: HeadersInit, signal?: AbortSignal): Promise<Raw> {
  const response = await fetch(url, { headers, signal: requestSignal(signal, 12_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  return await response.json() as Raw;
}
async function serpApi(query: string, signal?: AbortSignal): Promise<ProviderResult> {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new Error("SerpApi is not configured");
  const url = new URL("https://serpapi.com/search.json");
  for (const [name, value] of Object.entries({ engine: "google_shopping", q: query, gl: "us", hl: "en", api_key: key })) url.searchParams.set(name, value);
  const data = await getJson(url.href, undefined, signal);
  if (data.error) throw new Error("SerpApi error");
  return { provider: "serpapi", items: Array.isArray(data.shopping_results) ? data.shopping_results as Raw[] : [] };
}
async function searchApi(query: string, signal?: AbortSignal): Promise<ProviderResult> {
  const key = process.env.SEARCHAPI_API_KEY;
  if (!key) throw new Error("SearchApi is not configured");
  const url = new URL("https://www.searchapi.io/api/v1/search");
  for (const [name, value] of Object.entries({ engine: "google_shopping", q: query, gl: "us", hl: "en", link: "resolved" })) url.searchParams.set(name, value);
  const data = await getJson(url.href, { Authorization: `Bearer ${key}` }, signal);
  if (data.error) throw new Error("SearchApi error");
  return { provider: "searchapi", items: Array.isArray(data.shopping_results) ? data.shopping_results as Raw[] : [] };
}
async function bestBuy(query: string, signal?: AbortSignal): Promise<ProviderResult> {
  const key = process.env.BESTBUY_API_KEY;
  if (!key) throw new Error("Best Buy is not configured");
  const search = words(query).slice(0, 5).map((word) => `search=${word}`).join("&");
  const url = `https://api.bestbuy.com/v1/products(${search})?apiKey=${encodeURIComponent(key)}&format=json&show=sku,name,salePrice,url,image,onlineAvailability&pageSize=20`;
  const data = await getJson(url, undefined, signal);
  return { provider: "bestbuy", items: Array.isArray(data.products) ? data.products as Raw[] : [] };
}
async function kroger(query: string, locationId: string, signal?: AbortSignal): Promise<ProviderResult> {
  const clientId = process.env.KROGER_CLIENT_ID, secret = process.env.KROGER_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("Kroger is not configured");
  const tokenResponse = await fetch("https://api.kroger.com/v1/connect/oauth2/token", { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials&scope=product.compact", signal: requestSignal(signal, 4000), cache: "no-store" });
  if (!tokenResponse.ok) throw new Error("Kroger authentication failed");
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) throw new Error("Kroger authentication failed");
  const url = new URL("https://api.kroger.com/v1/products");
  url.searchParams.set("filter.term", query); url.searchParams.set("filter.locationId", locationId); url.searchParams.set("filter.limit", "20");
  const data = await getJson(url.href, { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" }, signal);
  return { provider: "kroger", items: Array.isArray(data.data) ? data.data as Raw[] : [] };
}
function normalize(result: ProviderResult, observedAt: string): Offer[] {
  return result.items.flatMap((raw, position) => {
    const provider = result.provider;
    const title = String(raw.title ?? raw.name ?? raw.description ?? "").trim();
    const amountCents = provider === "serpapi" || provider === "searchapi" ? priceCents(raw.extracted_price ?? raw.price) : provider === "bestbuy" ? priceCents(raw.salePrice) : priceCents((raw.items as Raw[] | undefined)?.[0]?.price && ((raw.items as Raw[])[0].price as Raw).regular);
    const merchant = provider === "serpapi" ? String(raw.source ?? "").trim() : provider === "searchapi" ? String(raw.seller ?? "Google Shopping").trim() : provider === "bestbuy" ? "Best Buy" : "Kroger";
    const merchantUrl = safeUrl(provider === "serpapi" ? raw.link ?? raw.product_link : provider === "searchapi" ? raw.product_link ?? raw.link : provider === "bestbuy" ? raw.url : `https://www.kroger.com/search?query=${encodeURIComponent(title)}`);
    const imageUrl = safeUrl(provider === "serpapi" || provider === "searchapi" ? raw.thumbnail : provider === "bestbuy" ? raw.image : ((raw.images as Raw[] | undefined)?.[0]?.sizes as Raw[] | undefined)?.[0]?.url);
    if (!title || !merchant || !merchantUrl || amountCents === null || amountCents <= 0 || raw.installment || (provider === "bestbuy" && raw.onlineAvailability === false)) return [];
    const caveats = ["Price, shipping, tax and availability may change at the merchant."];
    const hostname = new URL(merchantUrl).hostname;
    if (hostname === "google.com" || hostname.endsWith(".google.com")) caveats.push("Opens a Google Shopping listing; choose and verify the merchant there.");
    return [{ id: `${provider}-${position}`, title, merchant, merchantUrl, imageUrl, price: { amountCents, currency: "USD" as const, observedAt }, availability: "unknown" as const, match: "related" as const, reasons: [], caveats, source: { provider, position } }];
  });
}
function rank(offers: Offer[], context: ScanContext, purpose: Purpose, search: ReturnType<typeof queryFor>, budgetCents?: number) {
  const exact = search.basis === "photo" && context.observed.specificity === "exact_title";
  const prefs = purpose.kind === "gift" && context.connection?.personId === purpose.personId && context.connection.relation === "prefers" ? context.connection.preferences : null;
  return offers.flatMap((offer) => {
    const title = offer.title.toLowerCase();
    if (budgetCents && offer.price.amountCents > budgetCents) return [];
    const queryWords = productWords(search.query).filter((word) => word.length > 2);
    const titleWords = new Set(productWords(title));
    if (search.target && !containsWords(title, search.target)) return [];
    if (!search.target && queryWords.length && !queryWords.some((word) => titleWords.has(word))) return [];
    if (exact && !queryWords.every((word) => titleWords.has(word))) return [];
    const avoided = prefs?.avoids.find((phrase) => containsWords(title, phrase));
    if (avoided) return [];
    const matchedLikes = prefs?.likes.filter((phrase) => containsWords(title, phrase)) ?? [];
    if (prefs && !matchedLikes.length) return [];
    const match: Offer["match"] = queryWords.every((word) => titleWords.has(word)) ? "family" : "related";
    return [{ ...offer, match, reasons: matchedLikes.length ? [`Listing title supports: ${matchedLikes.join(", ")}.`] : search.basis === "photo" ? ["Related to the item in the scan; verify the exact product and variant."] : ["Listing title supports the stated product request; verify the exact variant."] }];
  }).sort((a, b) => (a.match === "family" ? 0 : 1) - (b.match === "family" ? 0 : 1) || a.price.amountCents - b.price.amountCents);
}
export async function discover(context: ScanContext, input: { purpose: Purpose; budgetCents?: number; storeLocationId?: string; signal?: AbortSignal; offerLimit?: number; merchantQuery?: string; searchTerm?: string }): Promise<Discovery> {
  if (input.signal?.aborted) throw new Error("Shopping lookup was cancelled.");
  if (!allowedPurposes(context).some((purpose) => samePurpose(purpose, input.purpose))) throw new Error("That purpose is not supported by this scan.");
  const search = queryFor(context, input.purpose);
  const providerTerm = input.searchTerm || search.query;
  const query = input.merchantQuery ? `${providerTerm} ${input.merchantQuery}` : providerTerm;
  if (!query) throw new Error("This scan has no identifiable product to search.");
  const fallbackSearchUrl = `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(query)}`;
  let unavailable = false;
  const attempted: string[] = [];
  const run = async (providerName: string, provider: () => Promise<ProviderResult>) => {
    try {
      const cacheKey = `${providerName}|${query.toLowerCase()}`;
      const cached = providerCache.get(cacheKey);
      const fresh = cached && cached.expiresAt > Date.now() ? cached : null;
      const result = fresh ? fresh.result : await provider();
      const observedAt = fresh?.observedAt ?? new Date().toISOString();
      if (!cached || cached.expiresAt <= Date.now()) {
        if (providerCache.size >= 200) providerCache.delete(providerCache.keys().next().value!);
        providerCache.set(cacheKey, { expiresAt: Date.now() + PROVIDER_CACHE_MS, observedAt, result });
      }
      attempted.push(result.provider);
      const deduped = [...new Map(normalize(result, observedAt).map((offer) => [`${offer.merchant.toLowerCase()}|${offer.title.toLowerCase()}`, offer])).values()];
      const limit = Number.isInteger(input.offerLimit) ? Math.min(30, Math.max(1, input.offerLimit!)) : 3;
      return { provider: result.provider, offers: rank(deduped, context, input.purpose, search, input.budgetCents).slice(0, limit) };
    } catch {
      if (input.signal?.aborted) throw new Error("Shopping lookup was cancelled.");
      unavailable = true; return null;
    }
  };
  const primary = process.env.SEARCHAPI_API_KEY ? await run("searchapi", () => searchApi(query, input.signal))
    : process.env.SERPAPI_API_KEY ? await run("serpapi", () => serpApi(query, input.signal)) : null;
  if (!primary) unavailable = true;
  if (primary?.offers.length) return { query, ...primary, fallbackSearchUrl, status: "ok" };
  if (process.env.SEARCHAPI_API_KEY && process.env.SERPAPI_API_KEY) {
    const backup = await run("serpapi", () => serpApi(query, input.signal));
    if (backup?.offers.length) return { query, ...backup, fallbackSearchUrl, status: "ok" };
  }
  const kind = category(context);
  const fallback = /camera|electronics|appliance|television|laptop|computer|headphone/.test(kind) ? { name: "bestbuy", call: () => bestBuy(query, input.signal) }
    : /coffee|grocery|food|beverage|soda|drink/.test(kind) && input.storeLocationId ? { name: `kroger|${input.storeLocationId}`, call: () => kroger(query, input.storeLocationId!, input.signal) } : null;
  const secondary = fallback ? await run(fallback.name, fallback.call) : null;
  if (secondary?.offers.length) return { query, ...secondary, fallbackSearchUrl, status: "ok" };
  return { query, offers: [], provider: attempted.at(-1) ?? null, fallbackSearchUrl, status: unavailable ? "provider_unavailable" : "no_verified_offers" };
}
