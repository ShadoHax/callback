import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), serverSupabase: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));

import { DELETE, PUT } from "../src/app/api/presence/route";

beforeEach(() => {
  process.env.NEXT_PUBLIC_ENABLE_PROXIMITY = "true";
  mocks.configured.mockReturnValue(true);
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) } });
  mocks.adminSupabase.mockReset();
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
});
afterEach(() => { delete process.env.NEXT_PUBLIC_ENABLE_PROXIMITY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

it("keeps nearby sharing disabled unless the deployment explicitly enables it", async () => {
  delete process.env.NEXT_PUBLIC_ENABLE_PROXIMITY;
  const response = await PUT(new Request("http://localhost/api/presence", { method: "PUT", body: JSON.stringify({ latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: new Date().toISOString() }) }));
  expect(response.status).toBe(503);
  expect(mocks.adminSupabase).not.toHaveBeenCalled();
});

it("stores a fresh accurate presence for only ten minutes", async () => {
  const upsert = vi.fn<(row: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: null }>>().mockResolvedValue({ error: null });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ upsert }) });
  const capturedAt = new Date().toISOString();
  const response = await PUT(new Request("http://localhost/api/presence", { method: "PUT", body: JSON.stringify({ latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt }) }));
  expect(response.status).toBe(200);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "owner", latitude: 40.741, longitude: -73.989, captured_at: capturedAt }), { onConflict: "user_id" });
  const row = upsert.mock.calls[0][0];
  expect(Date.parse(String(row.expires_at)) - Date.now()).toBeGreaterThan(9 * 60_000);
});

it("rejects stale presence without writing it", async () => {
  const upsert = vi.fn();
  mocks.adminSupabase.mockReturnValue({ from: () => ({ upsert }) });
  const response = await PUT(new Request("http://localhost/api/presence", { method: "PUT", body: JSON.stringify({ latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: new Date(Date.now() - 10 * 60_000).toISOString() }) }));
  expect(response.status).toBe(400);
  expect(upsert).not.toHaveBeenCalled();
});

it("lets the owner revoke presence immediately", async () => {
  const eq = vi.fn(async () => ({ error: null }));
  mocks.adminSupabase.mockReturnValue({ from: () => ({ delete: () => ({ eq }) }) });
  const response = await DELETE();
  expect(response.status).toBe(200);
  expect(eq).toHaveBeenCalledWith("user_id", "owner");
});
