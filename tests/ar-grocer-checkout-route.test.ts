import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), verify: vi.fn(), create: vi.fn(), status: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: () => true, serverSupabase: async () => ({ auth: { getUser: m.user } }) }));
vi.mock("@/lib/ar-grocer-cart", () => ({ verifyGrocerCartQuote: m.verify, createGrocerCheckout: m.create, getGrocerCheckoutStatus: m.status }));
import { GET, POST } from "../src/app/api/ar/activity/checkout/route";

function post(body: object) {
  return new Request("https://callback.example/api/ar/activity/checkout", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.user.mockResolvedValue({ data: { user: { id: "owner" } } });
});

it("requires authentication and an owner-valid quote before creating checkout", async () => {
  const input = { checkoutToken: "signed-token", expectedTotalCents: 300 };
  m.user.mockResolvedValueOnce({ data: { user: null } });
  expect((await POST(post(input))).status).toBe(401);
  expect(m.verify).not.toHaveBeenCalled();
  m.verify.mockReturnValue(null);
  expect((await POST(post(input))).status).toBe(409);
  expect(m.verify).toHaveBeenCalledWith("signed-token", "owner", 300);
  expect(m.create).not.toHaveBeenCalled();
});

it("passes only the signed-in owner and approved total to TEST checkout", async () => {
  m.verify.mockReturnValue({ subtotalCents: 300 });
  m.create.mockResolvedValue({ checkoutUrl: "https://checkout.stripe.com/c/pay/test" });
  const response = await POST(post({ checkoutToken: "signed-token", expectedTotalCents: 300 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ checkoutUrl: "https://checkout.stripe.com/c/pay/test" });
  expect(m.create).toHaveBeenCalledWith({ checkoutToken: "signed-token", expectedTotalCents: 300,
    ownerId: "owner", origin: "https://callback.example" });
});

it("checks returned sessions against the current owner", async () => {
  m.status.mockResolvedValue({ paid: true, merchant: "Walmart", subtotalCents: 300 });
  const response = await GET(new Request("https://callback.example/api/ar/activity/checkout?sessionId=cs_test_123"));
  expect(await response.json()).toEqual({ paid: true, merchant: "Walmart", subtotalCents: 300 });
  expect(m.status).toHaveBeenCalledWith("cs_test_123", "owner");
});
