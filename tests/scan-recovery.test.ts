import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configured: vi.fn(() => true), serverSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));

import { GET } from "../src/app/api/scans/[id]/route";

it("refuses to restore a result after its source corpus changes", async () => {
  const signedUrl = vi.fn();
  const scan = { id: "885edbf2-d497-4f6f-a2cf-342711970001", result: { status: "matched" }, trace: [], created_at: "2026-09-25T00:00:00Z", image_path: "private/image.png", corpus_revision: "old" };
  const scans = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: scan, error: null }; } };
  const sources = { select() { return this; }, eq() { return this; }, async limit() { return { data: [], error: null }; } };
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, from: (table: string) => table === "scans" ? scans : sources, storage: { from: () => ({ createSignedUrl: signedUrl }) } });
  const response = await GET(new Request("http://localhost/api/scans/id"), { params: Promise.resolve({ id: scan.id }) });
  expect(response.status).toBe(409);
  expect(signedUrl).not.toHaveBeenCalled();
});
