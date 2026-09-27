// Write the photo check's labels file from simple name prefixes: `npm run photos:label`
// (see docs/PHONE_PRACTICE.md). The labels are decided by how the team names each photo BEFORE any model runs:
//   book-…    the War and Peace cover  → should find maya (inspired)
//   anna-…    an Anna Karenina cover   → should find sam (recommended)
//   coffee-…  a coffee bag or cup      → should find maya (prefers)
//   unclear-… too blurry/far to read   → should ask to get closer
//   other-…   anything else            → should find no one
// Review the printed table, then run `npm run photos:check`. Refuses to overwrite an existing cases.json unless --force.
import { access, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { flags } from "./lib/live";
import { IMAGE, MAX_PHOTOS, type PhotoCase } from "./lib/photo-cases";

const PREFIXES: Record<string, Omit<PhotoCase, "file">> = {
  book: { status: "matched", person: "maya", relation: "inspired" },
  anna: { status: "matched", person: "sam", relation: "recommended" },
  coffee: { status: "matched", person: "maya", relation: "prefers" },
  unclear: { status: "needs_clarification" },
  other: { status: "no_match" },
};

async function main() {
  const { read, has } = flags(process.argv.slice(2));
  const folder = resolve(read("dir") ?? "data/private/phone-photos");
  const out = join(folder, "cases.json");
  const files = (await readdir(folder).catch(() => [] as string[])).filter((name) => IMAGE.test(name)).sort();
  if (!files.length) throw new Error(`No photos in ${folder}. Put the phone photos there first.`);
  if (files.length > MAX_PHOTOS) throw new Error(`${files.length} photos; keep it to ${MAX_PHOTOS} or fewer.`);
  const unknown = files.filter((file) => !PREFIXES[file.split(/[-_.]/)[0].toLowerCase()]);
  if (unknown.length) throw new Error(`Rename these to start with book-, anna-, coffee-, unclear-, or other-: ${unknown.join(", ")}`);
  if (!has("force") && await access(out).then(() => true, () => false)) throw new Error(`${out} already exists. Re-run with --force to replace it.`);
  const cases = files.map((file) => ({ file, ...PREFIXES[file.split(/[-_.]/)[0].toLowerCase()] }));
  await writeFile(out, JSON.stringify({ cases }, null, 2) + "\n");
  for (const item of cases) console.log(`${item.file.padEnd(28)} → ${item.status === "matched" ? `${item.person} (${item.relation})` : item.status.replace("_", " ")}`);
  console.log(`\nWrote ${cases.length} labels to ${out}. If they look right, run: npm run photos:check`);
}

main().catch((cause) => { console.error((cause as Error).message); process.exitCode = 1; });
