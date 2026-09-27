// Held-out evaluation of photo → person matching on the prepared LoCoMo profiles (see docs/PROFILES.md).
//
//   npm run profiles:eval -- [--per-friend 8] [--concurrency 4]
//
// Positives: photos a friend shared in the conversation (their captions were kept OUT of profile preparation), labeled
// with that friend. Negatives: everyday objects that should match no one. Each case runs the same identification +
// AI-topic classification call as a live scan, but from the caption text instead of pixels, then the same memory
// retrieval and scored decision. Baseline: literal keyword overlap with the friends' own words (no AI categories).
// Proxy caveat: "the friend who shared a photo of X" is a reasonable but imperfect label for "who X should remind you of".
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { decide, tokens, type Source } from "../src/lib/decision";
import { memoryTopics, relationsForPhoto, type IndexedRelation, type KnowledgeIndex } from "../src/lib/knowledge-index";
import { z } from "zod";
import { classifyDescription } from "../src/lib/meta";
import { VERIFY_BELOW_SCORE, verifyDecision } from "../src/lib/verify";
import { modelDisplayConfig, structuredCall } from "../src/lib/model";
import { flags } from "./lib/live";

type Profile = { friends: { id: string; name: string }[]; relations: IndexedRelation[]; evidence: Source[]; images: { friend: string; caption: string; speakerIsFriend: boolean; diaId: string }[] };
const NEGATIVES = ["a red stapler on an office desk", "an orange traffic cone on a street", "a ream of printer paper", "a tube of toothpaste on a sink",
  "a car key fob", "a fire extinguisher mounted on a wall", "a coiled ethernet cable", "a pocket calculator", "a single light bulb", "a parking meter",
  "a plastic trash can", "a roll of packing tape"];
// Held-out test objects, fixed before the first test run (September 26, ~17:30 ET) and never used for tuning.
const TEST_NEGATIVES = ["a box of tissues", "a USB flash drive", "a pair of scissors", "a bag of rice", "a ceiling fan", "a doormat",
  "a shower curtain", "a tape measure", "an umbrella stand", "a power strip", "a mop and bucket", "a paper shredder"];
// Final objects, fixed before the one final run (September 26, ~17:45 ET), after all tuning was finished.
const FINAL_NEGATIVES = ["a box of paper clips", "a kitchen sponge", "a coat hanger", "a smoke detector", "a spray bottle of glass cleaner",
  "a set of AA batteries", "an extension cord", "a plastic storage bin", "a wall clock", "a door hinge", "a garden hose", "a box of envelopes"];

async function main() {
  const { read, has } = flags(process.argv.slice(2));
  const perFriend = Number(read("per-friend") ?? 8), concurrency = Number(read("concurrency") ?? 4);
  // --split dev: the photos used while tuning. --split test: different photos (offset sampling) and new objects.
  const split = read("split") ?? "dev";
  const profile = JSON.parse(await readFile(resolve("data/private/profiles/profile.json"), "utf8")) as Profile;
  const index = { relations: profile.relations } as KnowledgeIndex;
  const topics = memoryTopics(index);
  const cases: { caption: string; expected: string | null }[] = [];
  for (const friend of profile.friends) {
    const shared = profile.images.filter((image) => image.friend === friend.id && image.speakerIsFriend);
    const step = Math.max(1, Math.floor(shared.length / perFriend));
    const devPicks = new Set<number>();
    for (let i = 0; i < shared.length && devPicks.size < perFriend; i += step) devPicks.add(i);
    if (split === "test" || split === "final") {
      // test: halfway between dev picks; final: a quarter of the way, skipping anything dev or test used.
      const offset = split === "test" ? Math.floor(step / 2) : Math.floor(step / 4);
      const testPicks = new Set<number>();
      for (let i = Math.max(1, Math.floor(step / 2)); i < shared.length && testPicks.size < perFriend; i += Math.max(1, step)) testPicks.add(i);
      let taken = 0;
      for (let i = Math.max(1, offset); i < shared.length && taken < perFriend; i++) {
        if (devPicks.has(i) || (split === "final" && testPicks.has(i)) || (i - offset) % Math.max(1, step) !== 0) continue;
        cases.push({ caption: shared[i].caption.replace(/^a (?:photo|photography|picture|close up|closeup)(?: photo)? of\s+/i, ""), expected: friend.id }); taken++;
      }
      continue;
    }
    // Captions read "a photo of …"; describe the subject itself, as the camera would see it.
    for (let i = 0; i < shared.length && cases.filter((c) => c.expected === friend.id).length < perFriend; i += step) cases.push({ caption: shared[i].caption.replace(/^a (?:photo|photography|picture|close up|closeup)(?: photo)? of\s+/i, ""), expected: friend.id });
  }
  const negativesUsed = split === "final" ? FINAL_NEGATIVES : split === "test" ? TEST_NEGATIVES : NEGATIVES;
  for (const caption of negativesUsed) cases.push({ caption, expected: null });
  console.log(`[${split} split] ${cases.length} cases (${cases.length - negativesUsed.length} friend photos, ${negativesUsed.length} unrelated objects) · ${profile.relations.length} relations · ${topics.length} AI-made topics · vision model ${modelDisplayConfig().visionModel}`);

  // Baseline: which friend's own words share the most content words with the photo description?
  const baseline = (caption: string) => {
    const words = tokens(caption);
    const hits = new Map<string, number>();
    for (const relation of profile.relations) if ([...tokens(relation.itemMention)].some((word) => word.length > 3 && words.has(word))) hits.set(relation.personId, (hits.get(relation.personId) ?? 0) + 1);
    const best = [...hits].sort((a, b) => b[1] - a[1]);
    return !best.length || (best[1] && best[1][1] === best[0][1]) ? null : best[0][0];
  };

  const rows: { caption: string; expected: string | null; proposed?: string | null; checkWhy?: string; predicted: string | null; top3: string[]; score: number; scores?: [string, number][]; topics: string; baseline: string | null; ms: number; evidence?: string; sensible?: boolean; judgeWhy?: string; error?: string }[] = [];
  const text = new Map(profile.evidence.map((source) => [source.id, `${source.speaker_id === "owner" ? "YOU" : source.speaker_id.toUpperCase()}: ${source.original_text}`]));
  let cursor = 0;
  const worker = async () => {
    while (cursor < cases.length) {
      const item = cases[cursor++];
      const started = Date.now();
      try {
        let identification;
        for (let attempt = 1; ; attempt++) {
          try { identification = (await classifyDescription(item.caption, topics)).value; break; }
          catch (error) { if (attempt >= 4 || !/\(429\)/.test((error as Error).message)) throw error; await new Promise((resolve) => setTimeout(resolve, 3000 * attempt)); }
        }
        const relations = relationsForPhoto(identification, index);
        const proposed = decide({ identification, relations, sources: profile.evidence, ownerIds: [] });
        // Same propose → verify step as a live scan: matches reached through topics/kind get the fast second check.
        const winner = proposed.connection && relations.find((r) => r.personId === proposed.connection!.personId && r.itemMention === proposed.connection!.mention && r.relation === proposed.connection!.relation);
        const topScore = proposed.ranking.find((r) => r.personId === proposed.connection?.personId)?.score ?? 0;
        const checked = winner?.matchConfidence !== undefined && topScore < VERIFY_BELOW_SCORE ? await verifyDecision(proposed, identification, profile.evidence) : { decision: proposed, verification: { checked: false } as { checked: boolean; why?: string } };
        const decision = checked.decision;
        rows.push({ caption: item.caption, expected: item.expected, proposed: proposed.connection?.personId ?? null, checkWhy: checked.verification.why, predicted: decision.connection?.personId ?? null, top3: decision.ranking.filter((r) => r.eligible).slice(0, 3).map((r) => r.personId),
          evidence: decision.connection ? `${decision.connection.reason} Evidence: ${decision.connection.sourceIds.map((id) => text.get(id)).join(" / ")}` : undefined,
          score: decision.ranking[0]?.score ?? 0, scores: decision.ranking.filter((r) => r.eligible).map((r) => [r.personId, r.score] as [string, number]), topics: (identification.topicMatches ?? []).map((m) => `${m.topic}:${m.confidence}`).join(" "), baseline: baseline(item.caption), ms: Date.now() - started });
      } catch (error) {
        rows.push({ caption: item.caption, expected: item.expected, predicted: null, top3: [], score: 0, topics: "", baseline: baseline(item.caption), ms: Date.now() - started, error: (error as Error).message });
      }
      if (rows.length % 10 === 0) console.log(`  ${rows.length}/${cases.length}`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Optional AI judge: is each suggestion a sensible reminder given its quoted evidence? (Separate from the strict label.)
  if (has("judge")) {
    const Judged = z.object({ sensible: z.boolean(), why: z.string() });
    let next = 0;
    const answered = rows.filter((row) => row.predicted && row.evidence);
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < answered.length) {
        const row = answered[next++];
        for (let attempt = 1; ; attempt++) {
          try {
            const verdict = await structuredCall({ name: "callback_judge", schema: { type: "object", additionalProperties: false, properties: { sensible: { type: "boolean" }, why: { type: "string" } }, required: ["sensible", "why"] }, parse: Judged,
              instructions: "You judge a social reminder app. Given what the camera sees and the reason the app gives (with the friend's quoted messages), answer whether a thoughtful person who knows this friend would reasonably be reminded of them by this object right now. Be strict: a generic, loose, or wrong-person association is not sensible. Answer in one short sentence.",
              content: `Camera sees: ${row.caption}\nSuggested friend: ${row.predicted}\n${row.evidence}`, reasoningEffort: "low", timeoutMs: 60_000 });
            row.sensible = verdict.value.sensible; row.judgeWhy = verdict.value.why; break;
          } catch (error) { if (attempt >= 3) { row.judgeWhy = (error as Error).message; break; } await new Promise((resolve) => setTimeout(resolve, 3000 * attempt)); }
        }
      }
    }));
  }
  const positives = rows.filter((row) => row.expected), negatives = rows.filter((row) => !row.expected);
  const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
  const summarize = (label: string, pick: (row: typeof rows[number]) => string | null) => {
    const answered = positives.filter((row) => pick(row));
    const correct = answered.filter((row) => pick(row) === row.expected).length;
    const falseMatches = negatives.filter((row) => pick(row)).length;
    console.log(`${label.padEnd(34)} correct ${pct(correct, positives.length)} · precision when it answers ${pct(correct, answered.length)} · unrelated objects matched ${pct(falseMatches, negatives.length)}`);
    return { correct, answered: answered.length, positives: positives.length, falseMatches, negatives: negatives.length };
  };
  console.log("");
  summarize("Scoring only (before the check)", (row) => row.proposed ?? null);
  const ours = summarize("Scoring + fast verification (app)", (row) => row.predicted);
  const top3 = positives.filter((row) => row.expected && row.top3.includes(row.expected)).length;
  console.log(`${"".padEnd(34)} right friend in the top 3: ${pct(top3, positives.length)}`);
  const base = summarize("Keyword baseline (friends' words)", (row) => row.baseline);
  if (has("judge")) {
    const judged = rows.filter((row) => row.sensible !== undefined);
    const sensible = judged.filter((row) => row.sensible).length;
    const wrongLabel = judged.filter((row) => row.expected && row.predicted !== row.expected);
    console.log(`AI judge (muse-spark-1.3): sensible suggestions ${pct(sensible, judged.length)}; of answers that disagreed with the proxy label, still sensible ${pct(wrongLabel.filter((row) => row.sensible).length, wrongLabel.length)}; unrelated-object matches judged sensible ${pct(judged.filter((row) => !row.expected && row.sensible).length, judged.filter((row) => !row.expected).length)}`);
  }
  const errors = rows.filter((row) => row.error).length;
  const times = rows.map((row) => row.ms).sort((a, b) => a - b);
  console.log(`Errors: ${errors}. Call time median ${(times[Math.floor(times.length / 2)] / 1000).toFixed(1)} s (text description, not image).`);
  const perFriendRows = profile.friends.map((friend) => { const mine = positives.filter((row) => row.expected === friend.id); return `${friend.name} ${mine.filter((row) => row.predicted === friend.id).length}/${mine.length}`; });
  console.log(`Per friend: ${perFriendRows.join(" · ")}`);
  console.log("\nMisses (expected → got, topics):");
  for (const row of rows.filter((row) => row.predicted !== row.expected).slice(0, 14)) console.log(`  ${row.expected ?? "none"} → ${row.predicted ?? "none"} | "${row.caption.slice(0, 70)}" | ${row.topics || "no topic"}`);
  const out = resolve("data/private/profiles");
  await mkdir(out, { recursive: true });
  const file = join(out, `eval-${split}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ at: new Date().toISOString(), visionModel: modelDisplayConfig().visionModel, topics: topics.length, ours, top3, baseline: base, errors, rows }, null, 1));
  console.log(`\nReport: ${file}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
