import { beforeEach, describe, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";

const mocks = vi.hoisted(() => ({ configured: vi.fn(), serverSupabase: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));

import { POST } from "../src/app/api/messages/route";

function query(result: unknown) {
  return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: result }; } };
}

beforeEach(() => {
  mocks.configured.mockReturnValue(true);
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  delete process.env.GLASSES_MESSAGING_ENABLED;
  mocks.configured.mockClear(); mocks.serverSupabase.mockReset(); mocks.adminSupabase.mockReset();
});

describe("replies associated with device scans", () => {
  const scanId = "885edbf2-d497-4f6f-a2cf-342711970001";
  const replyTo = "885edbf2-d497-4f6f-a2cf-342711970007";
  const payload = { kind: "reply", replyTo, body: "Sunday works", clientRequestId: "885edbf2-d497-4f6f-a2cf-342711970008" };
  const post = () => POST(new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify(payload) }));
  const user = { id: "friend", user_metadata: { display_name: "Friend" } };

  it("replays a saved reply even when it inherits the original scan ID", async () => {
    mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) } });
    const row = { id: "reply", scan_id: scanId, recipient_id: "owner", reply_to: replyTo, body: payload.body, quoted_source_id: null, purpose: "reply", about_person_id: null };
    const insert = vi.fn();
    mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(row), insert }) });
    expect(await (await post()).json()).toEqual({ id: "reply", duplicate: true });
    expect(insert).not.toHaveBeenCalled();
    mocks.adminSupabase.mockReturnValue({ from: () => query({ ...row, purpose: "advice" }) });
    expect((await post()).status).toBe(409);
  });

  function setup(options: { ownerScan?: boolean; deviceKind?: string; eventFails?: boolean } = {}) {
    mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user } }) }, from: () => query({ id: replyTo, sender_id: "owner", recipient_id: "friend", scan_id: scanId }) });
    const eventInsert = vi.fn(async () => { if (options.eventFails) throw new Error("network"); return { error: null }; });
    const scanEq = vi.fn();
    const scanQuery = { ...query(options.ownerScan === false ? null : { device_id: "glasses-1" }), eq: scanEq };
    scanEq.mockReturnValue(scanQuery);
    const from = vi.fn((table: string) => {
      if (table === "messages") return { ...query(null), insert: () => ({ select: () => ({ single: async () => ({ data: { id: "reply" }, error: null }) }) }) };
      if (table === "scans") return scanQuery;
      if (table === "device_tokens") return query({ id: "glasses-1", kind: options.deviceKind ?? "glasses", expires_at: "2099-01-01T00:00:00Z", revoked_at: null });
      if (table === "device_events") return { insert: eventInsert };
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.adminSupabase.mockReturnValue({ from });
    return { eventInsert, scanEq, from };
  }

  it("does not publish private device events when glasses messaging is off", async () => {
    const { from, eventInsert } = setup();
    expect((await post()).status).toBe(201);
    expect(from).not.toHaveBeenCalledWith("scans");
    expect(eventInsert).not.toHaveBeenCalled();
  });

  it("publishes only to the live glasses device belonging to this reply's recipient", async () => {
    process.env.GLASSES_MESSAGING_ENABLED = "true";
    const { eventInsert, scanEq } = setup();
    expect((await post()).status).toBe(201);
    expect(scanEq).toHaveBeenCalledWith("owner_id", "owner");
    expect(eventInsert).toHaveBeenCalledWith(expect.objectContaining({ owner_id: "owner", device_id: "glasses-1", kind: "reply" }));
    const reverse = setup({ ownerScan: false });
    expect((await post()).status).toBe(201);
    expect(reverse.eventInsert).not.toHaveBeenCalled();
    const pi = setup({ deviceKind: "pi" });
    expect((await post()).status).toBe(201);
    expect(pi.eventInsert).not.toHaveBeenCalled();
  });

  it("preserves a successful phone reply when the optional device event fails", async () => {
    process.env.GLASSES_MESSAGING_ENABLED = "true";
    setup({ eventFails: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await (await post()).json()).toEqual({ id: "reply", duplicate: false });
      expect(warn).toHaveBeenCalledOnce();
    } finally { warn.mockRestore(); }
  });
});

it("returns an existing message for a repeated client request without inserting", async () => {
  const insert = vi.fn();
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "sender" } } }) } });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query({ id: "existing", scan_id: "885edbf2-d497-4f6f-a2cf-342711970001", recipient_id: "885edbf2-d497-4f6f-a2cf-342711970004", reply_to: null, body: "Hello", quoted_source_id: null }), insert }) });
  const response = await POST(new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify({ kind: "scan", scanId: "885edbf2-d497-4f6f-a2cf-342711970001", recipientId: "885edbf2-d497-4f6f-a2cf-342711970004", body: "Hello", clientRequestId: "885edbf2-d497-4f6f-a2cf-342711970002" }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "existing", duplicate: true });
  expect(insert).not.toHaveBeenCalled();
});

it("refuses to share a scan the signed-in user cannot read", async () => {
  const insert = vi.fn();
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "sender" } } }) }, from: () => query(null) });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(null), insert }) });
  const response = await POST(new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify({ kind: "scan", scanId: "885edbf2-d497-4f6f-a2cf-342711970001", recipientId: "885edbf2-d497-4f6f-a2cf-342711970004", body: "Hello", clientRequestId: "885edbf2-d497-4f6f-a2cf-342711970003" }) }));
  expect(response.status).toBe(403);
  expect(insert).not.toHaveBeenCalled();
});

it("refuses delivery if the selected recipient mapping changed", async () => {
  const insert = vi.fn();
  const scan = { id: "885edbf2-d497-4f6f-a2cf-342711970001", result: { status: "matched", person: "maya", recipientId: "885edbf2-d497-4f6f-a2cf-342711970004" } };
  const contacts = { recipient_id: "885edbf2-d497-4f6f-a2cf-342711970005" };
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "sender" } } }) }, from: (table: string) => query(table === "scans" ? scan : contacts) });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(null), insert }) });
  const response = await POST(new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify({ kind: "scan", scanId: scan.id, recipientId: scan.result.recipientId, body: "Hello", clientRequestId: "885edbf2-d497-4f6f-a2cf-342711970006" }) }));
  expect(response.status).toBe(409);
  expect(insert).not.toHaveBeenCalled();
});

describe("idempotent sends", () => {
  const key = "885edbf2-d497-4f6f-a2cf-342711970010";
  const scanBody = (body: string, extra: object = {}) => JSON.stringify({ kind: "scan", scanId: "885edbf2-d497-4f6f-a2cf-342711970001", recipientId: "885edbf2-d497-4f6f-a2cf-342711970004", body, clientRequestId: key, ...extra });
  const stored = { id: "existing", scan_id: "885edbf2-d497-4f6f-a2cf-342711970001", recipient_id: "885edbf2-d497-4f6f-a2cf-342711970004", reply_to: null, body: "Hello", quoted_source_id: null };
  const post = (body: string) => POST(new Request("http://localhost/api/messages", { method: "POST", body }));
  const signedIn = () => mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "sender" } } }) } });

  it("replays a lost-response retry of the identical payload without inserting", async () => {
    const insert = vi.fn(); signedIn();
    mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(stored), insert }) });
    const response = await post(scanBody("  Hello "));
    expect(await response.json()).toEqual({ id: "existing", duplicate: true });
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses to reuse a key for edited text", async () => {
    const insert = vi.fn(); signedIn();
    mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(stored), insert }) });
    const response = await post(scanBody("Hello, edited"));
    expect(response.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses to reuse a key after the quote choice changed", async () => {
    const insert = vi.fn(); signedIn();
    mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(stored), insert }) });
    const response = await post(scanBody("Hello", { quotedSourceId: "885edbf2-d497-4f6f-a2cf-342711970003" }));
    expect(response.status).toBe(409);
  });

  it("resolves a concurrent retry that lost the insert race to the winner's message", async () => {
    signedIn();
    const scan = { id: stored.scan_id, owner_id: "sender", image_path: "sender/p.jpg", corpus_revision: corpusRevision([]), result: { status: "matched", person: "maya", recipientId: stored.recipient_id, sourceIds: [] } };
    mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "sender" } } }) }, from: (table: string) => ({ ...query(table === "scans" ? scan : { recipient_id: stored.recipient_id }), order() { return this; }, async limit() { return { data: [], error: null }; } }) });
    let lookups = 0;
    const insert = vi.fn().mockReturnValue({ select() { return { async single() { return { data: null, error: { code: "23505" } }; } }; } });
    mocks.adminSupabase.mockReturnValue({ from: () => ({ select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: lookups++ === 0 ? null : stored }; }, insert }) });
    const response = await post(scanBody("Hello"));
    expect(insert).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ id: "existing", duplicate: true });
  });
});
