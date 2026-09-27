// Scan photos as the dataset owner (DEMO_ADVISOR_EMAIL) through a running app's real hover path, printing the
// recognized topics, every friend's confidence, the second check, and timings (see docs/PROFILES.md).
//   npm run profiles:live -- [--app http://localhost:3001] photo1.jpg photo2.png …
import { flags, need, photo, session } from "./lib/live";
const { read } = flags(process.argv.slice(2));
const app = (read("app") ?? "http://localhost:3001").replace(/\/$/, "");
const user = await session(app, need("DEMO_ADVISOR_EMAIL"), need("DEMO_ADVISOR_PASSWORD"));
const t0 = Date.now(); const prep = await (await user.call("/api/context/prepare", { method: "POST" })).json();
console.log("prepare:", JSON.stringify({ ready: prep.ready, reused: prep.reused, calls: prep.modelCalls, sources: prep.sourceCount, relations: prep.relationCount, error: prep.error }), Date.now() - t0, "ms");
for (const file of process.argv.slice(2).filter((arg, i, all) => !arg.startsWith("--") && all[i - 1] !== "--app")) {
  const image = await photo(file);
  const f = new FormData(); f.set("image", image!); f.set("captureSource", "phone_camera"); f.set("mode", "hover");
  const started = Date.now();
  const r = await user.call("/api/scans", { method: "POST", body: f });
  const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const last = lines.at(-1); const res = last.result;
  if (!res) { console.log(file.split("/").pop(), "ERROR", last.message); continue; }
  console.log(`\n${file.split("/").pop()} → ${res.status} ${res.personName ?? ""} (${res.relation ?? ""}) in ${Date.now() - started} ms [vision ${res.timings?.visionMs} ms, check ${res.verification?.ms ?? 0} ms]`);
  console.log(`  seen: ${res.observedEntity} | topics: ${(res.topicMatches ?? []).map((m: { topic: string; confidence: number }) => `${m.topic} ${m.confidence}`).join(", ")}`);
  console.log(`  ranking: ${(res.ranking ?? []).filter((x: { eligible: boolean }) => x.eligible).slice(0, 4).map((x: { personName: string; score: number; topic?: string }) => `${x.personName} ${x.score} (${x.topic})`).join(" · ")}`);
  if (res.reason) console.log(`  reason: ${res.reason}`);
  if (res.verification?.checked) console.log(`  check: ${res.verification.sensible ? "✓" : "✗"} ${res.verification.why}`);
}
