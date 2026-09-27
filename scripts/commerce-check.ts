// Live database/API checks using one explicitly labeled developer scan. No inference, checkout session, or payment.
// npm run commerce:check [-- --app https://your-app]
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { corpusRevision } from "../src/lib/corpus";
import { SOURCE_INDEX_LIMIT } from "../src/lib/source-selection";
import { flags, need, recorder, service, session, type Session } from "./lib/live";

async function main() {
  const app = (flags(process.argv.slice(2)).read("app") ?? process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const admin = service(), { checks, check } = recorder();
  const scanner = await session(app, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD"));
  const recipient = await session(app, need("DEMO_RECIPIENT_EMAIL"), need("DEMO_RECIPIENT_PASSWORD"));
  const person = process.env.DEMO_RECIPIENT_PERSON || "maya";
  const { data: sources, error } = await admin.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic").eq("owner_id", scanner.id).limit(SOURCE_INDEX_LIMIT + 1);
  if (error || !sources?.length || sources.length > SOURCE_INDEX_LIMIT) throw new Error("Run demo:setup with the synthetic book + coffee story first.");
  const taste = sources.find((item) => item.speaker_id === person && /light-roast/i.test(item.original_text));
  if (!taste?.is_synthetic) throw new Error("This developer check requires the labeled synthetic coffee-taste message; it won't invent labels for real messages.");
  const send = async (user: Session, path: string, body: object) => {
    const response = await user.call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const scanId = crypto.randomUUID(), updateId = crypto.randomUUID();
  const messageIds: string[] = [];
  const path = `${scanner.id}/${scanId}.jpeg`;
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
  const config = await (await scanner.call("/api/shop/config")).json();
  if (!config.enabled) throw new Error("Enable COMMERCE_ENABLED on the running app first.");
  const purpose = { kind: "gift", personId: person }, selection = { scanId, purpose, budgetCents: 2500 };
  try {
    const uploaded = await admin.storage.from("scan-images").upload(path, jpeg, { contentType: "image/jpeg" });
    if (uploaded.error) throw uploaded.error;
    // A labeled developer fixture that looks like a coffee scan matched to the friend's stated taste. NOT a model result.
    const inserted = await admin.from("scans").insert({ id: scanId, owner_id: scanner.id, image_path: path, trace: [], corpus_revision: corpusRevision(sources), result: {
      scanId, devFixture: "commerce-check developer fixture: NOT a model result", status: "matched", person, recipientId: recipient.id,
      relation: "prefers", mention: "light-roast whole beans", sourceIds: [taste.id],
      preferences: { likes: ["light-roast whole beans for pour-over"], avoids: ["Dark roasts"] },
      identification: { item: "Sunrise Coffee Co. House Blend coffee beans", title: "House Blend", category: "coffee beans", specificity: "exact_title", searchTerms: ["coffee", "coffee beans"] },
      advice: [],
    } });
    if (inserted.error) throw inserted.error;
    console.log("Live shopping routes; labeled developer fixture, no model or payment");
    const options = await send(scanner, "/api/shop/options", selection);
    check("taste-matched gift options use live scan context", options.status === 200 && options.body.options?.[0]?.productId === "ethiopia-light-whole", `top: ${options.body.options?.[0]?.productId ?? options.status}`);
    const excluded = (options.body.excluded ?? []) as { productId: string; why: string }[];
    check("what the friend avoids is excluded with their words", excluded.some((item) => item.productId === "french-dark-whole" && /Dark roasts/.test(item.why)));
    check("reasons quote the friend's stated taste", (options.body.options?.[0]?.reasons ?? []).some((line: string) => /light-roast whole beans/.test(line)));
    const payload = { ...selection, productId: "ethiopia-light-whole", clientRequestId: crypto.randomUUID(), totalCents: 1 };
    const quoted = await send(scanner, "/api/shop/quote", payload);
    check("quote uses server totals", quoted.status === 201 && quoted.body.order?.totalCents === 2311, `HTTP ${quoted.status}; ${quoted.body.order?.totalCents}`);
    if (quoted.status === 201) {
      const id = quoted.body.order.id;
      check("identical quote retry reuses the order", (await send(scanner, "/api/shop/quote", payload)).body.order?.id === id);
      check("same key with a different product is rejected", (await send(scanner, "/api/shop/quote", { ...payload, productId: "kenya-light-ground" })).status === 409);
      check("another user cannot read the order", (await recipient.call(`/api/shop/orders/${id}`)).status === 404);
      const stored = await admin.from("orders").select("status").eq("id", id).single();
      check("no checkout started by quoting", stored.data?.status === "quoted");
      if (!config.checkout) check("unconfigured payment reports an explicit blocker", (await send(scanner, `/api/shop/orders/${id}/approve`, { expectedTotalCents: 2311 })).status === 503);
    }
    const filteredPayload = { ...payload, preference: "coffee", clientRequestId: crypto.randomUUID() };
    const filtered = await send(scanner, "/api/shop/quote", filteredPayload);
    check("coffee kind filter survives the database quote constraint", filtered.status === 201 && filtered.body.order?.totalCents === 2311, `HTTP ${filtered.status}`);
    if (filtered.status === 201) {
      const stored = await admin.from("orders").select("preference").eq("id", filtered.body.order.id).single();
      check("coffee preference is persisted on the quote", !stored.error && stored.data?.preference === "coffee");
    }
    check("a shared-plan purpose is rejected for a taste match", (await send(scanner, "/api/shop/options", { ...selection, purpose: { kind: "together", personId: person } })).status === 400);
    check("an avoided product can't be quoted", (await send(scanner, "/api/shop/quote", { ...payload, productId: "french-dark-whole", clientRequestId: crypto.randomUUID() })).status >= 400);
    check("over-budget quote is rejected", (await send(scanner, "/api/shop/quote", { ...payload, clientRequestId: crypto.randomUUID(), budgetCents: 100 })).status === 409);
    const update = await admin.from("sources").insert({ id: updateId, owner_id: scanner.id, speaker_id: person, thread_id: `commerce-check-${scanId}`, participant_ids: ["owner", person], original_text: "Developer check: a context change.", source_at: new Date().toISOString(), is_synthetic: true, origin: "demo_update" });
    if (update.error) throw update.error;
    check("changed context invalidates old shopping options", (await send(scanner, "/api/shop/options", selection)).status === 409);
    check("changed context invalidates old quote requests", (await send(scanner, "/api/shop/quote", { ...payload, clientRequestId: crypto.randomUUID() })).status === 409);
  } catch (cause) { check("commerce check completed", false, cause instanceof Error ? cause.message : String(cause)); }
  finally {
    // Exact fixture IDs only; each result is checked so cleanup failures cannot masquerade as success.
    const operations = [
      ...messageIds.reverse().map((id) => () => admin.from("messages").delete().eq("id", id)),
      () => admin.from("orders").delete().eq("scan_id", scanId),
      () => admin.from("scans").delete().eq("id", scanId),
      () => admin.from("sources").delete().eq("id", updateId),
      () => admin.storage.from("scan-images").remove([path]),
    ];
    let clean = true;
    for (const operation of operations) { try { if ((await operation()).error) clean = false; } catch { clean = false; } }
    check("developer fixture cleaned up", clean);
  }
  const passed = checks.filter((item) => item.ok).length;
  console.log(`\n${passed}/${checks.length} commerce checks passed. No model, checkout session, or payment was run.`);
  await mkdir(resolve("data/private/live"), { recursive: true });
  await writeFile(resolve("data/private/live", `commerce-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ app, checks, fixture: true, paymentRun: false }, null, 2));
  process.exitCode = passed === checks.length ? 0 : 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
