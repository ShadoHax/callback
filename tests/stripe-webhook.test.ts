import Stripe from "stripe";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ handleProviderEvent: vi.fn(async () => ({ order: { status: "paid_test" }, duplicate: false })) }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: () => ({}) }));
vi.mock("@/lib/commerce/orders", async (original) => ({ ...(await original<typeof import("../src/lib/commerce/orders")>()), handleProviderEvent: mocks.handleProviderEvent }));
import { POST } from "../src/app/api/stripe/webhook/route";

const secret = "whsec_test_only_for_unit_tests";
const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: { id: "cs_test_1", object: "checkout.session" } } });
const signed = (body: string, key = secret) => new Stripe("sk_test_unit").webhooks.generateTestHeaderString({ payload: body, secret: key });
const deliver = (body: string, signature: string | null) => POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: signature ? { "stripe-signature": signature } : {} }));

afterEach(() => { vi.clearAllMocks(); delete process.env.STRIPE_WEBHOOK_SECRET; delete process.env.STRIPE_SECRET_KEY; });

it("processes a correctly signed checkout event by re-reading the session", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = secret; process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  const response = await deliver(payload, signed(payload));
  expect(response.status).toBe(200);
  expect(mocks.handleProviderEvent).toHaveBeenCalledWith(expect.anything(), expect.anything(), { id: "evt_1", type: "checkout.session.completed", sessionId: "cs_test_1" });
});

it("rejects a missing, wrong, or tampered signature without processing", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = secret; process.env.STRIPE_SECRET_KEY = "sk_test_unit";
  expect((await deliver(payload, null)).status).toBe(400);
  expect((await deliver(payload, signed(payload, "whsec_other"))).status).toBe(400);
  expect((await deliver(payload.replace("cs_test_1", "cs_test_2"), signed(payload))).status).toBe(400);
  expect(mocks.handleProviderEvent).not.toHaveBeenCalled();
});

it("refuses to run with a live-mode key", async () => {
  process.env.STRIPE_WEBHOOK_SECRET = secret; process.env.STRIPE_SECRET_KEY = "sk_live_should_be_refused";
  expect((await deliver(payload, signed(payload))).status).toBe(400);
  expect(mocks.handleProviderEvent).not.toHaveBeenCalled();
});
