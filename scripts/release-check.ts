// Before making the repo public: `npm run release:check`
// Scans every tracked file for secrets, private data, and unlabeled fixtures. Exit code 1 if anything is found.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const findings: string[] = [];
const patterns: [string, RegExp][] = [
  ["Meta API key", /\bLLM[_|][A-Za-z0-9_|-]{20,}/],
  ["OpenAI API key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{30,}/],
  ["Stripe secret key", /\b(sk|rk)_(live|test)_[A-Za-z0-9]{12,}/],
  ["Stripe webhook secret", /\bwhsec_[A-Za-z0-9]{12,}/],
  ["JWT / Supabase key", /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{12,}/],
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["API key in an env-style line", /^(MODEL_API_KEY|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|SUPABASE_SERVICE_ROLE_KEY)=[^\s#]{12,}/m],
];
for (const file of files) {
  if (/^(\.env(?!\.example)|data\/private\/|.*\.pem$)/.test(file)) findings.push(`${file}: private file is tracked`);
  if (/\.(png|jpe?g|webp|gif|ico|lock)$/i.test(file) || file === "package-lock.json") continue;
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const [label, pattern] of patterns) if (pattern.test(text)) findings.push(`${file}: looks like a ${label}`);
  if (file.startsWith("fixtures/") && file.endsWith(".json") && /"is_synthetic"\s*:\s*false/.test(text)) findings.push(`${file}: contains a non-synthetic source; real messages belong in data/private/`);
}
const photos = files.filter((file) => /\.(png|jpe?g|webp|heic)$/i.test(file) && !file.startsWith("public/"));
if (photos.length) findings.push(`tracked photos outside public/ (check they contain no private people or messages): ${photos.join(", ")}`);
console.log(`Checked ${files.length} tracked files.`);
if (findings.length) { console.log(findings.map((line) => `  ✗ ${line}`).join("\n")); process.exitCode = 1; }
else console.log("  ✓ no secrets, private files, or unlabeled fixtures found. Also review commit history and the README before publishing.");
