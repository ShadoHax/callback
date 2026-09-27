// Import an approved source bundle for one owner: `npm run import:sources -- <file.json> <owner-uuid> [person-id recipient-uuid]...`
// Safe to rerun: sources get stable per-owner IDs (or keep explicit ones) and are upserted. Refuses IDs owned by someone else.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { Bundle, SOURCE_LIMIT, importBundle, mapContact } from "../src/lib/demo-data";

async function main() {
  const [file, ownerId, ...pairs] = process.argv.slice(2);
  if (!file || !z.string().uuid().safeParse(ownerId).success || pairs.length % 2) throw new Error("Usage: npm run import:sources -- <file.json> <owner-user-uuid> [person-id recipient-user-uuid]...");
  for (let index = 1; index < pairs.length; index += 2) if (!z.string().uuid().safeParse(pairs[index]).success) throw new Error(`Recipient for ${pairs[index - 1]} must be a user UUID.`);
  const bundle = Bundle.parse(JSON.parse(await readFile(file, "utf8")));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service role key must be set in .env.local.");
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const result = await importBundle(admin, ownerId, bundle);
  for (let index = 0; index < pairs.length; index += 2) await mapContact(admin, ownerId, pairs[index], pairs[index + 1]);
  console.log(`Imported ${result.imported} "${bundle.label}" sources for ${ownerId} (${result.updated} already present, now ${result.total} total).`);
  if (pairs.length) console.log(`Mapped ${pairs.length / 2} contact(s).`);
  if (result.overLimit) console.log(`Warning: this owner now has more than ${SOURCE_LIMIT} sources, so scans will refuse to run. Run npm run demo:reset or narrow the import.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
