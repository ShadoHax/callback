import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), verify: vi.fn(), data: vi.fn(), plan: vi.fn(), shop: vi.fn(), offers: vi.fn(), nearby: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: () => true, serverSupabase: async () => ({ auth: { getUser: m.user } }) }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ limit: m.data }) }) }) }) }));
vi.mock("@/lib/ar-activity", () => ({ AR_ACTIVITY_ACTIONS: ["recipe", "shop", "nearby", "plan"], verifyArConnection: m.verify, planArActivity: m.plan }));
vi.mock("@/lib/ar-shopping-plan", () => ({ planArShopping: m.shop }));
vi.mock("@/lib/ar-shopping-discovery", () => ({ discoverIngredientOffers: m.offers }));
vi.mock("@/lib/ar-grocer-discovery", () => ({ completeGrocerCarts: async () => [] }));
vi.mock("@/lib/ar-nearby", () => ({ searchNearbyPlaces: m.nearby }));
import { POST } from "../src/app/api/ar/activity/route";
import { corpusRevision } from "../src/lib/corpus";
const source = { id: "33333333-3333-4333-8333-333333333333", speaker_id: "friend", thread_id: "thread", participant_ids: ["friend"], original_text: "Let's make soup.", source_at: null, is_synthetic: true };
const connection = { personId: "friend", sourceIds: [source.id], corpusRevision: corpusRevision([source]), identification: { item: "tomato" } };
const request = (body: object) => new Request("http://localhost/api/ar/activity", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionToken: "signed", ...body }) });
beforeEach(() => {
  Object.values(m).forEach(fn => fn.mockReset());
  m.user.mockResolvedValue({ data: { user: { id: "owner" } } }); m.verify.mockReturnValue(connection);
  m.data.mockResolvedValue({ data: [source], error: null });
});
it("rejects invalid location before reading memory or calling an external provider", async () => {
  expect((await POST(request({ action: "nearby", location: { latitude: 91, longitude: 0 } }))).status).toBe(400);
  expect(m.nearby).not.toHaveBeenCalled(); expect(m.data).not.toHaveBeenCalled();
});
it("requires current authenticated evidence before any live search", async () => {
  m.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await POST(request({ action: "shop" }))).status).toBe(401);
  m.verify.mockReturnValueOnce({ ...connection, corpusRevision: "old" });
  expect((await POST(request({ action: "shop" }))).status).toBe(409);
  expect(m.shop).not.toHaveBeenCalled(); expect(m.offers).not.toHaveBeenCalled();
});
it("passes only a grounded venue query and optional location to Muse search", async () => {
  m.plan.mockResolvedValue({ supported: true, action: "nearby", nearby: { query: "coffee shops near me" }, supportSourceIds: [source.id], timingMs: 10 });
  m.nearby.mockResolvedValue({ query: "coffee shops", places: [], usedFallback: false, model: "muse", timingMs: 20 });
  const location = { latitude: 33.77, longitude: -84.39 };
  const body = await (await POST(request({ action: "nearby", location }))).json();
  expect(m.nearby).toHaveBeenCalledWith({ query: "coffee shops", location, signal: expect.any(AbortSignal) });
  expect(body).toMatchObject({ action: "nearby", timingMs: 30 }); expect(body).not.toHaveProperty("cart");
});
it("passes missing geolocation to the server fallback without fabricating coordinates", async () => {
  m.plan.mockResolvedValue({ supported: true, action: "nearby", nearby: { query: "coffee shops near me" }, supportSourceIds: [source.id], timingMs: 1 });
  m.nearby.mockResolvedValue({ model: "muse", timingMs: 2, usedFallback: true });
  await POST(request({ action: "nearby" }));
  expect(m.nearby.mock.calls[0][0].location).toBeUndefined();
});
it("returns live offer discovery with complete grocer cart options", async () => {
  const requirements = [{ query: "tomatoes", quantity: 1, reason: "Soup" }];
  m.shop.mockResolvedValue({ supported: true, plan: { title: "Soup", supportSourceIds: [source.id] }, requirements, model: "muse" });
  m.offers.mockResolvedValue({ ingredients: [], allIngredientsHaveOffers: false });
  const body = await (await POST(request({ action: "shop" }))).json();
  expect(m.offers).toHaveBeenCalledWith(requirements, { signal: expect.any(AbortSignal), offerLimit: 30, useSavedPrices: true });
  expect(body).toMatchObject({ supported: true, action: "shop", shopping: { ingredients: [] } });
  expect(body).not.toHaveProperty("cart"); expect(body).not.toHaveProperty("checkoutToken");
  expect(m.plan).not.toHaveBeenCalled();
});
