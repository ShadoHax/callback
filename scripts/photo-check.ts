// Phone-photo check: `npm run photos:check` (see docs/PHONE_PRACTICE.md).
//
// Sends each photo in data/private/phone-photos/ through the same warm hover path the phone uses (prepared memory +
// one vision call), as the configured demo scanner account. Nothing is saved: hover results are unsaved previews.
// Every photo needs an explicit expectation in --cases (default: data/private/phone-photos/cases.json).
// iPhone HEIC photos are converted with macOS `sips` to 1280 px / quality 86 JPEG, matching the camera limits.
// Camera-roll photos are still not live hover frames; record --provenance for synthetic or physical inputs.
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { flags, need, reachable, session, type Session } from "./lib/live";
import { IMAGE, matchesPhotoExpectation, parsePhotoCases, photoCaseCounts, type PhotoCase } from "./lib/photo-cases";

const run = promisify(execFile);
type Row = { file: string; expected: PhotoCase; got: string; identified: string; http: number | null; pass: boolean; ms: number; sizeKb: number };
type Line = { type: string; message?: string; identification?: { item?: string; title?: string; edition?: string; specificity?: string }; result?: { status: string; person?: string; relation?: string } };

/** A JPEG no larger than 1280 px on its longest side. Uses macOS `sips`; falls back to the original JPEG/PNG/WebP. */
async function prepareImage(path: string, scratch: string) {
  const out = join(scratch, `${basename(path, extname(path))}.jpg`);
  try {
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "86", "-Z", "1280", path, "--out", out]);
    return new File([await readFile(out)], basename(out), { type: "image/jpeg" });
  } catch {
    if (/\.(heic|heif)$/i.test(path)) throw new Error(`${basename(path)}: could not convert HEIC (needs macOS sips). Export it as JPEG instead.`);
    const type = { ".png": "image/png", ".webp": "image/webp" }[extname(path).toLowerCase()] ?? "image/jpeg";
    return new File([await readFile(path)], basename(path), { type });
  }
}

async function hover(user: Session, image: File) {
  const form = new FormData(); form.set("image", image); form.set("captureSource", "phone_camera"); form.set("mode", "hover");
  const started = Date.now();
  const response = await user.call("/api/scans", { method: "POST", body: form });
  const lines = (await response.text()).trim().split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line) as Line; } catch { return { type: "invalid" } as Line; } });
  const seen = lines.find((line) => line.identification)?.identification;
  const last = lines.at(-1);
  return { http: response.status, ms: Date.now() - started, identified: seen ? [seen.title || seen.item, seen.edition].filter(Boolean).join(" · ") : "", result: last?.type === "result" ? last.result ?? null : null, error: last?.type === "error" ? last.message ?? "scan error" : last?.type === "result" ? null : "no result" };
}

async function main() {
  const { read } = flags(process.argv.slice(2));
  const folder = resolve(read("dir") ?? "data/private/phone-photos");
  const manifest = resolve(read("cases") ?? join(folder, "cases.json"));
  const provenance = read("provenance") ?? "User-labeled images; capture source not independently verified.";
  const app = (read("app") ?? "https://callback-khaki-phi.vercel.app").replace(/\/$/, "");
  const files = (await readdir(folder).catch(() => [] as string[])).filter((name) => IMAGE.test(name)).sort();
  if (!files.length) throw new Error(`No photos found in ${folder}. Put .jpg/.heic/.png files there (see docs/PHONE_PRACTICE.md).`);
  let raw: unknown;
  try { raw = JSON.parse(await readFile(manifest, "utf8")); }
  catch (cause) { throw new Error(`Could not read valid photo cases JSON at ${manifest}: ${(cause as Error).message}`); }
  const cases = parsePhotoCases(raw, files);
  const folderReal = await realpath(folder);
  for (const item of cases) {
    const imageReal = await realpath(join(folder, item.file));
    const within = relative(folderReal, imageReal);
    if (!within || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new Error(`Photo case points outside the photo folder: ${item.file}.`);
    if (!(await stat(imageReal)).isFile()) throw new Error(`Photo case is not a file: ${item.file}.`);
  }
  if (!(await reachable(app))) throw new Error(`App not reachable at ${app}.`);
  const user = await session(app, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD")).catch(() => { throw new Error("Demo sign-in failed; check .env.local."); });
  const prepared = await user.call("/api/context/prepare", { method: "POST" });
  const memory = await prepared.json().catch(() => ({})) as { ready?: boolean; error?: string; modelCalls?: number };
  if (!prepared.ok || !memory.ready) throw new Error(`Memory not ready: ${memory.error ?? `HTTP ${prepared.status}`}. Nothing was checked.`);

  console.log(`Checking ${cases.length} photo(s) against ${app} (memory ready, ${memory.modelCalls ?? 0} model calls to prepare)\n`);
  const scratch = await mkdtemp(join(tmpdir(), "callback-photos-"));
  const rows: Row[] = [];
  try {
    for (const expected of cases) {
      const file = expected.file;
      let row: Row;
      try {
        const image = await prepareImage(join(folder, file), scratch);
        const out = await hover(user, image);
        const got = out.result;
        const pass = matchesPhotoExpectation(expected, got, out.http);
        const saw = got ? (got.status === "matched" ? `found ${got.person} (${got.relation})` : got.status.replace("_", " ")) : `error: ${out.error}`;
        row = { file, expected, got: saw, identified: out.identified, http: out.http, pass, ms: out.ms, sizeKb: Math.round(image.size / 1024) };
      } catch (cause) {
        row = { file, expected, got: `error: ${(cause as Error).message}`, identified: "", http: null, pass: false, ms: 0, sizeKb: 0 };
      }
      rows.push(row);
      const expectation = expected.status === "matched" ? `${expected.person} (${expected.relation})` : expected.status.replace("_", " ");
      console.log(`${row.pass ? "✓" : "✗"} ${file}: expected ${expectation}, ${row.got}${row.identified ? ` · saw "${row.identified}"` : ""} · HTTP ${row.http ?? "—"} · ${(row.ms / 1000).toFixed(1)} s`);
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }

  const counts = photoCaseCounts(cases, rows);
  const times = rows.filter((row) => row.ms > 0).map((row) => row.ms).sort((a, b) => a - b);
  const median = times.length ? ((times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2000).toFixed(1) : "—";
  for (const count of counts) console.log(`${count.status.replace("_", " ")}: ${count.passed}/${count.total}`);
  console.log(`Time per photo: median ${median} s, slowest ${times.length ? (times.at(-1)! / 1000).toFixed(1) : "—"} s (n=${times.length}; network + one vision call, not live-camera timing)`);
  const reportDir = resolve("data/private/live");
  await mkdir(reportDir, { recursive: true });
  const report = join(reportDir, `photos-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(report, JSON.stringify({ app, manifest, at: new Date().toISOString(), kind: "Labeled image uploads through the hover path; not live camera frames", provenance, counts, rows }, null, 2));
  console.log(`Report (no images): ${report}`);
  if (rows.some((row) => !row.pass)) process.exitCode = 1;
}

main().catch((cause) => { console.error(`\n${(cause as Error).message}`); process.exitCode = 1; });
