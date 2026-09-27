// Paired latency experiment: npm run vision:latency -- data/private/vision-cases.json
// Manifest: { cases: [{ id, image, expectedTitle, provenance }], repeats?: 1|2|3 }.
// Images resolve relative to the manifest. Paid vision only; no DB writes or messages.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { z } from "zod";
import { identifyItem } from "../src/lib/meta";
import { modelDisplayConfig } from "../src/lib/model";
import { compareProductIdentity } from "../src/lib/product-identity";

const Manifest = z.object({
  repeats: z.number().int().min(1).max(3).default(2),
  cases: z.array(z.object({ id: z.string().min(1), image: z.string().min(1), expectedTitle: z.string().min(1), provenance: z.string().min(1) })).min(1).max(6),
});
const mime: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
type Row = { id: string; repetition: number; effort: "low" | "minimal"; ok: boolean; ms: number; title?: string; error?: string; inputTokens?: number; outputTokens?: number };

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Pass a labeled vision-case manifest before any paid calls.");
  const manifestPath = resolve(path);
  const manifest = Manifest.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.cases.length * manifest.repeats * 2 > 24) throw new Error("This experiment is limited to 24 calls.");
  if (new Set(manifest.cases.map((item) => item.id)).size !== manifest.cases.length) throw new Error("Case IDs must be unique.");
  const model = modelDisplayConfig();
  if (model.provider !== "meta") throw new Error("Select Meta: OpenAI maps minimal to low and would not compare two settings.");
  // Read every image before the first model call, including later negative/variant cases.
  const cases = await Promise.all(manifest.cases.map(async (item) => {
    const type = mime[extname(item.image).toLowerCase()];
    if (!type) throw new Error(`Unsupported image: ${item.id}`);
    const bytes = await readFile(resolve(dirname(manifestPath), item.image));
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error(`Image must be 1 byte–8 MB: ${item.id}`);
    return { ...item, image: new File([bytes], item.id, { type }) };
  }));
  const rows: Row[] = [];
  const originalEffort = process.env.VISION_REASONING_EFFORT;
  try {
    for (let repetition = 0; repetition < manifest.repeats; repetition++) {
      for (const [index, item] of cases.entries()) {
        // Alternate order to reduce a consistent first-request/caching advantage.
        const efforts = (repetition + index) % 2 ? ["minimal", "low"] as const : ["low", "minimal"] as const;
        for (const effort of efforts) {
          process.env.VISION_REASONING_EFFORT = effort;
          const started = Date.now();
          let row: Row;
          try {
            const answer = await identifyItem(item.image);
            row = { id: item.id, repetition: repetition + 1, effort, ms: answer.ms,
              ok: answer.value.specificity === "exact_title" && compareProductIdentity(item.expectedTitle, answer.value) === "same",
              title: answer.value.title || answer.value.item, inputTokens: answer.usage?.inputTokens, outputTokens: answer.usage?.outputTokens };
          } catch (error) { row = { id: item.id, repetition: repetition + 1, effort, ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : "vision failed" }; }
          rows.push(row);
          console.log(`${item.id} ${effort}: ${row.ok ? "correct" : "FAIL"}, ${row.ms} ms`);
        }
      }
    }
  } finally {
    if (originalEffort === undefined) delete process.env.VISION_REASONING_EFFORT; else process.env.VISION_REASONING_EFFORT = originalEffort;
  }
  const summaries = (["low", "minimal"] as const).map((effort) => {
    const group = rows.filter((row) => row.effort === effort);
    const times = group.filter((row) => !row.error).map((row) => row.ms).sort((a, b) => a - b);
    return { effort, correct: group.filter((row) => row.ok).length, total: group.length, errors: group.filter((row) => row.error).length,
      medianMs: times.length ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2 : null,
      maxMs: times.at(-1) ?? null };
  });
  await mkdir("data/private/latency", { recursive: true });
  const output = resolve("data/private/latency", `vision-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(output, JSON.stringify({ model, at: new Date().toISOString(), cases: manifest.cases, summaries, rows,
    note: "Small paired engineering experiment. Not a held-out accuracy benchmark or a phone end-to-end timing. Failed calls may incur additional usage." }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(summaries));
  console.log(`Private report: ${output}`);
  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "Experiment failed"); process.exitCode = 1; });
