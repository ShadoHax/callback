// One-command, rerunnable demo setup: `npm run demo:setup -- [bundle.json]`
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_SCANNER_EMAIL, DEMO_SCANNER_PASSWORD,
// DEMO_RECIPIENT_EMAIL, DEMO_RECIPIENT_PASSWORD. Optional: DEMO_SCANNER_NAME, DEMO_RECIPIENT_NAME, DEMO_RECIPIENT_PERSON (default maya),
// DEMO_ADVICE_PERSONS (default noah), DEMO_ADVISOR_EMAIL/PASSWORD/NAME (else advice goes to the recipient account).
// Creates the two accounts if missing (never changes an existing password), imports the bundle for the scanner,
// maps the person to the recipient account, and prints the DEMO_OWNER_ID to set. Passwords are never printed.
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { Bundle, importBundle, mapContact, SOURCE_LIMIT } from "../src/lib/demo-data";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Set ${name} in .env.local.`); return value; };

async function findUser(admin: SupabaseClient, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match || data.users.length < 200) return match ?? null;
  }
  return null;
}

async function ensureUser(admin: SupabaseClient, email: string, password: string, displayName: string): Promise<User> {
  const existing = await findUser(admin, email);
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, { user_metadata: { ...existing.user_metadata, display_name: displayName } });
    if (error) throw new Error(`Could not update ${email}: ${error.message}`);
    console.log(`  ✓ ${email} exists (${existing.id}); password unchanged`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  console.log(`  ✓ created ${email} (${data.user.id})`);
  return data.user;
}

async function main() {
  const bundlePath = process.argv[2] ?? "fixtures/synthetic-demo.json";
  const admin = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  console.log("Schema");
  for (const [table, columns] of [["sources", "id,origin"], ["scans", "id"], ["messages", "id,sender_name,quoted_at,purpose,about_person_id"], ["contacts", "owner_id"], ["device_tokens", "id"], ["orders", "id,preference"], ["payment_events", "event_id"]] as const) {
    const { error } = await admin.from(table).select(columns, { head: true, count: "exact" });
    if (error) throw new Error(`Table ${table} is missing or outdated (${error.message}). Run supabase/schema.sql in the Supabase SQL editor, then rerun.`);
  }
  console.log("  ✓ tables and columns present");
  console.log("Accounts");
  const scanner = await ensureUser(admin, required("DEMO_SCANNER_EMAIL"), required("DEMO_SCANNER_PASSWORD"), process.env.DEMO_SCANNER_NAME || "Alex");
  const recipient = await ensureUser(admin, required("DEMO_RECIPIENT_EMAIL"), required("DEMO_RECIPIENT_PASSWORD"), process.env.DEMO_RECIPIENT_NAME || "Maya");
  if (scanner.id === recipient.id) throw new Error("Scanner and recipient must be different accounts.");
  console.log("Context");
  const bundle = Bundle.parse(JSON.parse(await readFile(bundlePath, "utf8")));
  const result = await importBundle(admin, scanner.id, bundle);
  console.log(`  ✓ ${result.imported} sources from "${bundle.label}" (${result.updated} already present; owner total ${result.total}/${SOURCE_LIMIT})`);
  if (result.overLimit) console.log("  ! over the scan limit: run npm run demo:reset, or remove old imports");
  const person = process.env.DEMO_RECIPIENT_PERSON || "maya";
  await mapContact(admin, scanner.id, person, recipient.id);
  console.log(`  ✓ person "${person}" → ${recipient.email}`);
  // Advice contacts for the shopping continuation ("Ask Noah"). A third account is optional; otherwise the
  // recipient phone plays that friend too, and the inbox labels those messages as advice requests.
  const advisor = process.env.DEMO_ADVISOR_EMAIL && process.env.DEMO_ADVISOR_PASSWORD ? await ensureUser(admin, process.env.DEMO_ADVISOR_EMAIL, process.env.DEMO_ADVISOR_PASSWORD, process.env.DEMO_ADVISOR_NAME || "Noah") : recipient;
  for (const advicePerson of (process.env.DEMO_ADVICE_PERSONS ?? "noah").split(",").map((item) => item.trim()).filter(Boolean)) {
    if (advicePerson === person) continue;
    await mapContact(admin, scanner.id, advicePerson, advisor.id);
    console.log(`  ✓ advice contact "${advicePerson}" → ${advisor.email}${advisor.id === recipient.id ? " (same phone as the recipient)" : ""}`);
  }
  console.log(`\nSet these (in .env.local and the deployment):\nDEMO_MODE=true\nDEMO_OWNER_ID=${scanner.id}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
