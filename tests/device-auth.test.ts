import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ adminSupabase: vi.fn() }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));

import { authenticateDevice, hashDeviceSecret, newDeviceSecret } from "../src/lib/device-auth";

afterEach(() => { mocks.adminSupabase.mockReset(); });

it("creates a random scan secret and stores only its digest", () => {
  const first = newDeviceSecret(); const second = newDeviceSecret();
  expect(first).toMatch(/^cbdev_[A-Za-z0-9_-]{43}$/);
  expect(first).not.toBe(second);
  expect(hashDeviceSecret(first)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashDeviceSecret(first)).not.toContain(first);
});

it("rejects malformed and revoked credentials", async () => {
  expect(await authenticateDevice("Bearer short")).toBeNull();
  const secret = newDeviceSecret();
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: "device", owner_id: "owner", kind: "quest", expires_at: new Date(Date.now() + 60000).toISOString(), revoked_at: new Date().toISOString() }, error: null }; } }) });
  expect(await authenticateDevice(`Bearer ${secret}`)).toBeNull();
});

it("returns an owner and kind only for an active token", async () => {
  const secret = newDeviceSecret();
  mocks.adminSupabase.mockReturnValue({ from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: "device", owner_id: "owner", kind: "glasses", expires_at: new Date(Date.now() + 60000).toISOString(), revoked_at: null }, error: null }; } }) });
  expect(await authenticateDevice(`Bearer ${secret}`)).toEqual({ id: "device", ownerId: "owner", kind: "glasses" });
});
