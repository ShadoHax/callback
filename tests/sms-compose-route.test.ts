import { beforeEach, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), serverSupabase: vi.fn(), smsRecipient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/sms", () => ({ smsRecipient: mocks.smsRecipient }));

import { POST } from "../src/app/api/messages/sms/compose/route";

const ownerId = "885edbf2-d497-4f6f-a2cf-342711970000";
const scanId = "885edbf2-d497-4f6f-a2cf-342711970001";
const recipientId = "885edbf2-d497-4f6f-a2cf-342711970002";
const otherRecipientId = "885edbf2-d497-4f6f-a2cf-342711970003";
const request = (recipient = recipientId) => new Request("http://localhost/api/messages/sms/compose", { method: "POST", body: JSON.stringify({ scanId, recipientId: recipient }) });
const sources = [{ id: "source", speaker_id: "maya", thread_id: "thread", participant_ids: ["owner", "maya"], original_text: "Let's play Sunday", source_at: null, is_synthetic: false }];
const scan = { id: scanId, corpus_revision: corpusRevision(sources), result: { status: "matched", person: "maya", recipientId } };

function session({ user = { id: ownerId }, currentScan = scan, contact = { recipient_id: recipientId }, currentSources = sources }: {
  user?: { id: string } | null;
  currentScan?: typeof scan | null;
  contact?: { recipient_id: string } | null;
  currentSources?: typeof sources;
} = {}) {
  const filters: [string, string][] = [];
  mocks.serverSupabase.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => ({
      select() { return this; },
      eq(column: string, value: string) { filters.push([column, value]); return this; },
      order() { return this; },
      async maybeSingle() { return { data: table === "scans" ? currentScan : contact, error: null }; },
      async limit() { return { data: currentSources, error: null }; },
    }),
  });
  return filters;
}

beforeEach(() => {
  mocks.configured.mockReturnValue(true);
  mocks.serverSupabase.mockReset();
  mocks.smsRecipient.mockReset();
  mocks.smsRecipient.mockReturnValue("+12175550123");
});

it("returns the number only after checking the owner, scan, current contact, and context", async () => {
  const filters = session();
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ phone: "+12175550123" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(filters).toContainEqual(["owner_id", ownerId]);
  expect(filters).toContainEqual(["person_id", "maya"]);
  expect(mocks.smsRecipient).toHaveBeenCalledWith(ownerId, "maya");
});

it("requires authentication and an owned matched scan", async () => {
  session({ user: null });
  expect((await POST(request())).status).toBe(401);
  session({ currentScan: null });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.smsRecipient).not.toHaveBeenCalled();
});

it("rejects a recipient absent from the scan or remapped since it was saved", async () => {
  session();
  expect((await POST(request(otherRecipientId))).status).toBe(403);
  session({ contact: { recipient_id: otherRecipientId } });
  expect((await POST(request())).status).toBe(409);
  expect(mocks.smsRecipient).not.toHaveBeenCalled();
});

it("rejects an old scan after the underlying source context changes", async () => {
  session({ currentSources: [{ ...sources[0], original_text: "Plan cancelled" }] });
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toMatch(/Context changed/);
  expect(mocks.smsRecipient).not.toHaveBeenCalled();
});

it("reports invalid private configuration without disclosing its contents", async () => {
  session();
  mocks.smsRecipient.mockImplementation(() => { throw new Error("private configuration"); });
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect((await response.json()).error).not.toContain("private configuration");
});

it("describes a missing native phone mapping without implying server delivery", async () => {
  session();
  mocks.smsRecipient.mockReturnValue(null);
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "This person's mobile number isn't configured for native texting." });
});
