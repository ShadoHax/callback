import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(() => true), serverSupabase: vi.fn(), adminSupabase: vi.fn(() => ({})), resetDemoUpdates: vi.fn(async () => 3) }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
vi.mock("@/lib/demo-data", async (original) => ({ ...(await original<typeof import("../src/lib/demo-data")>()), resetDemoUpdates: mocks.resetDemoUpdates }));

import { DELETE } from "../src/app/api/demo/context/route";

const signedInAs = (id: string) => mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id } } }) } });
afterEach(() => { vi.clearAllMocks(); delete process.env.DEMO_MODE; delete process.env.DEMO_OWNER_ID; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

it("resets only for the configured demo owner", async () => {
  process.env.DEMO_MODE = "true"; process.env.DEMO_OWNER_ID = "demo-owner"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  signedInAs("demo-owner");
  const response = await DELETE();
  expect(await response.json()).toEqual({ removed: 3 });
  expect(mocks.resetDemoUpdates).toHaveBeenCalledWith(expect.anything(), "demo-owner");
});

it("refuses other signed-in users", async () => {
  process.env.DEMO_MODE = "true"; process.env.DEMO_OWNER_ID = "demo-owner"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  signedInAs("recipient");
  expect((await DELETE()).status).toBe(403);
  expect(mocks.resetDemoUpdates).not.toHaveBeenCalled();
});

it("is off unless demo mode is enabled", async () => {
  process.env.DEMO_OWNER_ID = "demo-owner"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  signedInAs("demo-owner");
  expect((await DELETE()).status).toBe(403);
  expect(mocks.resetDemoUpdates).not.toHaveBeenCalled();
});
