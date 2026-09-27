// Readiness check: `npm run smoke -- [path/to/photo.jpg]`. Run after `npm run demo:setup`.
// Database/auth readiness and model readiness are reported separately: a missing model key is "waiting for model
// access", not a database failure. Exit code: 0 all ready · 2 database ready, model pending · 1 something is broken.
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { decide, type Identification, type Source } from "../src/lib/decision";
import { extractRelations, identifyItem } from "../src/lib/meta";
import { modelConfig } from "../src/lib/model";

let broken = 0;
const pass = (label: string, detail = "") => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label: string, detail: unknown) => { broken++; console.log(`  ✗ ${label} — ${detail instanceof Error ? detail.message : String(detail)}`); };
const wait = (label: string, detail: string) => console.log(`  … ${label} — ${detail}`);

async function main() {
  const imagePath = process.argv[2];
  console.log("1. Database and auth (required now)");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) if (process.env[name]) pass(name); else fail(name, "missing from .env.local");
  if (url && key) {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    for (const [table, columns] of [["sources", "id,origin"], ["scans", "id"], ["messages", "id,sender_name,quoted_at,purpose,about_person_id"], ["contacts", "owner_id"], ["device_tokens", "id"], ["orders", "id,status,total_cents,preference"], ["payment_events", "event_id"]] as const) {
      const { count, error } = await admin.from(table).select(columns, { count: "exact", head: true });
      if (error) fail(`table ${table}`, `${error.message} (run supabase/schema.sql)`); else pass(`table ${table}`, `${count} rows`);
    }
    const { data: bucket, error: bucketError } = await admin.storage.getBucket("scan-images");
    if (bucketError || !bucket) fail("bucket scan-images", bucketError ?? "missing"); else if (bucket.public) fail("bucket scan-images", "must be private"); else pass("bucket scan-images", "private");
    const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (usersError) fail("auth users", usersError);
    else for (const name of ["DEMO_SCANNER_EMAIL", "DEMO_RECIPIENT_EMAIL"]) {
      const email = process.env[name];
      const user = users.users.find((item) => item.email?.toLowerCase() === email?.toLowerCase());
      if (!email) fail(name, "missing from .env.local"); else if (!user) fail(name, `${email} not found; run npm run demo:setup`); else pass(name, `${email} (${user.id})`);
    }
    const owner = process.env.DEMO_OWNER_ID;
    if (!owner) fail("DEMO_OWNER_ID", "set it to the id printed by npm run demo:setup");
    else {
      const { count } = await admin.from("sources").select("id", { count: "exact", head: true }).eq("owner_id", owner);
      const { data: contacts } = await admin.from("contacts").select("person_id").eq("owner_id", owner);
      if (!count) fail("scanner context", "no sources; run npm run demo:setup"); else pass("scanner context", `${count} sources; contacts: ${(contacts ?? []).map((row) => row.person_id).join(", ") || "none"}`);
    }
    if (process.env.DEMO_MODE !== "true") wait("DEMO_MODE", "not true, so the demo editor and reset are off");
  }

  console.log("2. Model");
  let modelReady = false;
  try { const config = modelConfig(); console.log(`  · ${config.provider} / ${config.model} at ${config.base}`); modelReady = true; }
  catch (error) { wait("model", `${error instanceof Error ? error.message : "Model configuration unavailable."} Database checks above are unaffected.`); }
  if (modelReady) {
    const fixture = JSON.parse(await readFile("fixtures/synthetic-x100v.json", "utf8")) as { sources: Source[] };
    const camera: Identification = { item: "Fujifilm X100V", category: "camera", specificity: "exact_title", visibleText: ["X100V"], searchTerms: ["X100V", "Fuji"], ambiguity: "" };
    try {
      const { value, ms, attempts, usage } = await extractRelations(camera, fixture.sources);
      pass("structured output", `${value.relations.length} relations in ${ms} ms (${attempts} attempt${attempts === 1 ? "" : "s"})`);
      if (usage) console.log(`      usage: ${usage.inputTokens} input, ${usage.outputTokens} output tokens`);
      for (const relation of value.relations) console.log(`      ${relation.personId} · ${relation.subject} · ${relation.relation} · ${relation.evidenceLevel} · "${relation.itemMention}" · ${relation.sentiment}`);
      const decision = decide({ identification: camera, relations: value.relations, sources: fixture.sources, ownerIds: [] });
      const expected = decision.status === "matched" && decision.connection?.personId === "maya";
      (expected ? pass : fail)("four-message routing", `${decision.status}${decision.connection ? ` → ${decision.connection.personId} (${decision.connection.relation})` : ""}; ruled out ${decision.ruledOut.map((item) => `${item.personId}:${item.code}`).join(", ") || "none"}`);
    } catch (error) { fail("structured output", error); }
    if (!imagePath) wait("vision", "pass a photo path to test image input");
    else {
      try {
        const type = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" }[extname(imagePath).toLowerCase()];
        if (!type) throw new Error("Use a .jpg, .png, or .webp photo.");
        const { value, ms, usage } = await identifyItem(new File([await readFile(imagePath)], imagePath, { type }));
        pass("vision", `${value.item} · ${value.specificity} · ${ms} ms`);
        if (usage) console.log(`      usage: ${usage.inputTokens} input, ${usage.outputTokens} output tokens`);
        console.log(`      terms: ${value.searchTerms.join(", ")}${value.ambiguity ? ` · ambiguity: ${value.ambiguity}` : ""}`);
      } catch (error) { fail("vision", error); }
    }
  }

  console.log("3. Shopping (optional)");
  if (process.env.COMMERCE_ENABLED !== "true") wait("commerce", "COMMERCE_ENABLED is not true; the shopping panel is hidden");
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  if (!stripeKey) wait("Stripe", "no STRIPE_SECRET_KEY; options and quotes work, approval reports checkout isn't configured");
  else if (!/^(sk|rk)_test_/.test(stripeKey)) fail("Stripe", "only test-mode keys (sk_test_…) are allowed");
  else { pass("Stripe key", "test mode"); if (!process.env.STRIPE_WEBHOOK_SECRET) wait("Stripe webhook", "no STRIPE_WEBHOOK_SECRET; payments are still verified by server-side retrieval on the order page"); else pass("Stripe webhook secret"); }

  if (broken) console.log(`\n${broken} problem(s) to fix.`);
  else if (!modelReady) console.log("\nDatabase and auth are ready. Waiting for model access; next: npm run access:check.");
  else console.log("\nAll ready. Next: npm run access:check, then npm run live:check.");
  process.exitCode = broken ? 1 : modelReady ? 0 : 2;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
