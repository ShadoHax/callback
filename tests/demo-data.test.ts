import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Bundle, importBundle, resetDemoUpdates, stableSourceId } from "../src/lib/demo-data";

const record = { speaker_id: "maya", thread_id: "maya", participant_ids: ["owner", "maya"], original_text: "If you spot an X100V, send me a picture.", source_at: "2026-09-12T18:04:00.000Z", is_synthetic: true };
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

// Minimal chainable fake that records filters and returns canned rows.
function fakeAdmin(existing: { id: string; owner_id: string }[]) {
  const calls: { op: string; filters: [string, unknown][]; rows?: unknown }[] = [];
  const from = () => {
    const call: { op: string; filters: [string, unknown][]; rows?: unknown } = { op: "select", filters: [] };
    calls.push(call);
    const chain = {
      select() { return chain; },
      in(column: string, values: unknown) { call.filters.push([column, values]); return Promise.resolve({ data: existing, error: null }); },
      eq(column: string, value: unknown) { call.filters.push([column, value]); return chain; },
      upsert(rows: unknown) { call.op = "upsert"; call.rows = rows; return Promise.resolve({ error: null }); },
      delete() { call.op = "delete"; return chain; },
      then(resolve: (value: unknown) => void) { resolve(call.op === "delete" ? { data: [{ id: "a" }, { id: "b" }], error: null } : { count: 9, error: null }); },
    };
    return chain;
  };
  return { client: { from } as never, calls };
}

afterEach(() => vi.restoreAllMocks());

describe("demo data", () => {
  it("derives stable, valid, owner-specific IDs so reruns upsert instead of duplicating", () => {
    const first = stableSourceId(owner, record);
    expect(stableSourceId(owner, record)).toBe(first);
    expect(stableSourceId(other, record)).not.toBe(first);
    expect(z.string().uuid().safeParse(first).success).toBe(true);
  });

  it("imports the synthetic demo bundle, all labeled synthetic", () => {
    const bundle = Bundle.parse(JSON.parse(readFileSync("fixtures/synthetic-demo.json", "utf8")));
    expect(bundle.label).toMatch(/SYNTHETIC/);
    expect(bundle.sources.every((source) => source.is_synthetic)).toBe(true);
  });

  it("upserts owner-scoped rows tagged as imports", async () => {
    const { client, calls } = fakeAdmin([]);
    const result = await importBundle(client, owner, { label: "test", sources: [record] });
    const upsert = calls.find((call) => call.op === "upsert")!;
    expect(upsert.rows).toEqual([expect.objectContaining({ id: stableSourceId(owner, record), owner_id: owner, origin: "import" })]);
    expect(result).toMatchObject({ imported: 1, updated: 0, total: 9, overLimit: false });
  });

  it("refuses to import over another owner's source IDs", async () => {
    const id = stableSourceId(owner, record);
    const { client, calls } = fakeAdmin([{ id, owner_id: other }]);
    await expect(importBundle(client, owner, { label: "test", sources: [{ ...record, id }] })).rejects.toThrow(/another owner/);
    expect(calls.some((call) => call.op === "upsert")).toBe(false);
  });

  it("resets only synthetic demo updates for the given owner", async () => {
    const { client, calls } = fakeAdmin([]);
    expect(await resetDemoUpdates(client, owner)).toBe(2);
    expect(calls[0]).toMatchObject({ op: "delete", filters: [["owner_id", owner], ["origin", "demo_update"], ["is_synthetic", true]] });
  });
});
