import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ shopper: vi.fn(), get: vi.fn(), currentScanContext: vi.fn(), approve: vi.fn(), stripeProvider: vi.fn() }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: () => ({}) }));
vi.mock("@/lib/commerce/route-helpers", () => ({ shopper: mocks.shopper, json: (body: unknown, status = 200) => Response.json(body, { status }), appOrigin: () => "https://app.test" }));
vi.mock("@/lib/commerce/store", () => ({ supabaseOrderStore: () => ({ get: mocks.get }), publicOrder: (order: unknown) => order }));
vi.mock("@/lib/commerce/stripe", () => ({ stripeConfigured: () => true, stripeProvider: mocks.stripeProvider }));
vi.mock("@/lib/commerce/scan-context", () => ({ currentScanContext: mocks.currentScanContext }));
vi.mock("@/lib/commerce/orders", async (original) => ({ ...await original<object>(), approve: mocks.approve }));
import { POST } from "../src/app/api/shop/orders/[id]/approve/route";
const call = () => POST(new Request("https://app.test/api/shop/orders/order/approve", { method: "POST", body: JSON.stringify({ expectedTotalCents: 7554 }) }), { params: Promise.resolve({ id: "order" }) });
beforeEach(() => { vi.resetAllMocks(); mocks.shopper.mockResolvedValue({ user: { id: "alex" }, supabase: {} }); });

it("rejects stale evidence before creating a checkout session", async () => {
  mocks.get.mockResolvedValue({ status: "quoted", scan_id: "scan" });
  mocks.currentScanContext.mockResolvedValue({ error: "Context changed since this scan. Scan again.", status: 409 });
  expect((await call())?.status).toBe(409);
  expect(mocks.approve).not.toHaveBeenCalled();
  expect(mocks.stripeProvider).not.toHaveBeenCalled();
});

it("checks order ownership before reading its scan", async () => {
  mocks.get.mockResolvedValue(null);
  expect((await call())?.status).toBe(404);
  expect(mocks.get).toHaveBeenCalledWith("order", "alex");
  expect(mocks.currentScanContext).not.toHaveBeenCalled();
});

it("allows returning to an already-approved checkout without reusing evidence for a new purchase", async () => {
  mocks.get.mockResolvedValue({ status: "checkout_pending", scan_id: "scan" });
  mocks.approve.mockResolvedValue({ kind: "redirect", url: "https://checkout.test/session", order: { id: "order" } });
  expect((await call())?.status).toBe(200);
  expect(mocks.currentScanContext).not.toHaveBeenCalled();
});
