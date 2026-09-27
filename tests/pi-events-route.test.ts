import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticateDevice: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/device-auth", () => ({ authenticateDevice: mocks.authenticateDevice }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
import { GET } from "../src/app/api/device/events/route";

afterEach(() => {
  mocks.authenticateDevice.mockReset(); mocks.adminSupabase.mockReset();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.GLASSES_MESSAGING_ENABLED;
});

function configure() {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
}

it("still refuses device kinds that do not consume events", async () => {
  configure();
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "quest" });
  const denied = await GET(new Request("http://localhost/api/device/events", { headers: { authorization: "Bearer token" } }));
  expect(denied.status).toBe(403);
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
});

it("scopes glasses reply events to the exact device token", async () => {
  configure();
  process.env.GLASSES_MESSAGING_ENABLED = "true";
  mocks.authenticateDevice.mockResolvedValue({ id: "glasses-1", ownerId: "owner", kind: "glasses" });
  const chain = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn() };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.gt.mockReturnValue(chain); chain.order.mockReturnValue(chain);
  chain.limit.mockResolvedValue({ data: [{ id: 9, kind: "reply", payload: { senderName: "Maya", body: "Sunday works!" } }], error: null });
  mocks.adminSupabase.mockReturnValue({ from: vi.fn(() => chain) });
  const response = await GET(new Request("http://localhost/api/device/events?after=8", { headers: { authorization: "Bearer token" } }));
  expect(response.status).toBe(200);
  expect(chain.eq).toHaveBeenCalledWith("device_id", "glasses-1");
});

it("uses the token owner and cursor to fetch only new events", async () => {
  configure();
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "pi" });
  const chain = { select: vi.fn(), eq: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn() };
  chain.select.mockReturnValue(chain); chain.eq.mockReturnValue(chain); chain.gt.mockReturnValue(chain); chain.order.mockReturnValue(chain);
  chain.limit.mockResolvedValue({ data: [{ id: 8, kind: "connection", payload: { person: "Maya", item: "mug", relation: "gift" } }], error: null });
  mocks.adminSupabase.mockReturnValue({ from: vi.fn(() => chain) });
  const response = await GET(new Request("http://localhost/api/device/events?after=7", { headers: { authorization: "Bearer token" } }));
  expect(response.status).toBe(200);
  expect(chain.eq).toHaveBeenCalledWith("owner_id", "owner");
  expect(chain.eq).toHaveBeenCalledWith("kind", "connection");
  expect(chain.gt).toHaveBeenCalledWith("id", 7);
  expect((await response.json()).cursor).toBe(8);
});

it("keeps experimental glasses reply access off without an explicit server gate", async () => {
  configure();
  mocks.authenticateDevice.mockResolvedValue({ id: "glasses-1", ownerId: "owner", kind: "glasses" });
  const response = await GET(new Request("http://localhost/api/device/events"));
  expect(response.status).toBe(503);
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
});

it("rejects malformed cursors", async () => {
  configure();
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "pi" });
  const response = await GET(new Request("http://localhost/api/device/events?after=-1", { headers: { authorization: "Bearer token" } }));
  expect(response.status).toBe(400);
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
});
