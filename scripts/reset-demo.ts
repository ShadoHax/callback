// Remove only the synthetic messages added with the demo editor for DEMO_OWNER_ID: `npm run demo:reset`
// Imported originals, scans, messages, and every other user's data are untouched.
import { createClient } from "@supabase/supabase-js";
import { resetDemoUpdates } from "../src/lib/demo-data";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, owner = process.env.DEMO_OWNER_ID;
  if (!url || !key || !owner) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DEMO_OWNER_ID in .env.local.");
  const removed = await resetDemoUpdates(createClient(url, key, { auth: { persistSession: false } }), owner);
  console.log(`Removed ${removed} demo update(s) for ${owner}. Earlier scans are now stale and must be rescanned before sharing.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
