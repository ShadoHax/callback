// Regression: the merge left sending and shopping capped at 40 messages while scanning allowed 1,000.
import { beforeEach, expect, it, vi } from "vitest";
import { corpusRevision } from "../src/lib/corpus";

const mocks = vi.hoisted(() => ({ configured: vi.fn(() => true), serverSupabase: vi.fn(), adminSupabase: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ configured: mocks.configured, serverSupabase: mocks.serverSupabase }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
import { POST } from "../src/app/api/messages/route";
import { currentScanContext } from "../src/lib/commerce/scan-context";

const sources = Array.from({ length: 45 }, (_, index) => ({ id: `885edbf2-d497-4f6f-a2cf-3427119700${String(index).padStart(2, "0")}`, speaker_id: index === 0 ? "maya" : "sam",
  thread_id: "t", participant_ids: ["owner", index === 0 ? "maya" : "sam"], original_text: `message ${index}`, source_at: null, is_synthetic: true }));
const scanId = "885edbf2-d497-4f6f-a2cf-3427119711aa", recipientId = "885edbf2-d497-4f6f-a2cf-3427119711bb";
const scan = { id: scanId, owner_id: "owner", image_path: "owner/p.jpg", corpus_revision: corpusRevision(sources), result: { status: "matched", person: "maya", recipientId, sourceIds: [sources[0].id], identification: { item: "Wingspan", specificity: "exact_title" } }, trace: [] };
const query = (data: unknown) => ({ select() { return this; }, eq() { return this; }, order() { return this; }, async maybeSingle() { return { data }; }, async limit() { return { data, error: null }; } });

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  mocks.serverSupabase.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner", email: "alex@example.com", user_metadata: {} } } }) },
    from: (table: string) => query(table === "scans" ? scan : table === "contacts" ? { recipient_id: recipientId } : sources) });
});

it("sends from a scan whose owner has more than 40 messages", async () => {
  const insert = vi.fn().mockReturnValue({ select() { return { async single() { return { data: { id: "new" }, error: null }; } }; } });
  mocks.adminSupabase.mockReturnValue({ from: () => ({ ...query(null), insert }) });
  const response = await POST(new Request("http://localhost/api/messages", { method: "POST", body: JSON.stringify({ kind: "scan", scanId, recipientId, body: "Saw this!", clientRequestId: "885edbf2-d497-4f6f-a2cf-3427119711cc" }) }));
  expect(response.status).toBe(201);
});

it("loads shopping context for an owner with more than 40 messages", async () => {
  const supabase = await mocks.serverSupabase();
  const loaded = await currentScanContext(supabase, "owner", scanId);
  expect("error" in loaded ? loaded.error : "ok").toBe("ok");
});
