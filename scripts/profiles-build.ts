// Offline relationship-profile preparation for a large chat corpus (LoCoMo; see docs/PROFILES.md).
//
//   npm run profiles:build -- data/private/datasets/locomo10.json [--friends 2] [--concurrency 6] [--write]
//
// 1. Converts each LoCoMo conversation into one friendship: one speaker becomes a friend, the other the owner.
// 2. Meta (the memory model) reads every session once and extracts typed, verbatim-grounded relations with an AI-made
//    topic, visual cues, and importance. Each session's result is checkpointed in data/private/profiles/raw/, so a rerun
//    resumes instead of paying again.
// 3. Consolidates repeated mentions into one profile per friend (importance grows with repetition).
// 4. With --write: loads ONLY the quoted evidence messages plus the prepared memory into the dataset owner's account
//    (DEMO_ADVISOR_EMAIL), so scans reuse it with zero preparation calls. The full dataset never goes to the backend.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { corpusRevision } from "../src/lib/corpus";
import type { Source } from "../src/lib/decision";
import { stableSourceId } from "../src/lib/demo-data";
import { INDEX_PROMPT_VERSION, extractBatch, groundedIn, keyFor, removeAmbiguousSelfRequests, uniqueRelations, type IndexedRelation } from "../src/lib/knowledge-index";
import { z } from "zod";
import { modelDisplayConfig, structuredCall, type ModelUsage } from "../src/lib/model";
import { SOURCE_INDEX_LIMIT } from "../src/lib/source-selection";
import { flags, need } from "./lib/live";

type Turn = { speaker: string; dia_id: string; text: string; img_url?: string[]; blip_caption?: string; query?: string };
type Conversation = { sample_id: string; conversation: Record<string, unknown> & { speaker_a: string; speaker_b: string } };
// One friend per conversation; the other speaker plays the owner. Chosen so friend names don't collide.
const FRIEND_BY_SAMPLE: Record<number, "a" | "b"> = { 0: "b", 1: "b", 2: "b", 3: "b", 4: "a", 5: "b", 6: "a", 7: "b", 8: "b", 9: "b" };
const OUT = resolve("data/private/profiles");
const MAX_PER_FRIEND = 45;
const MAX_BATCH = 30;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
function parseWhen(value: string) {
  // "1:56 pm on 8 May, 2023"
  const match = value.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm) on (\d{1,2}) ([a-z]+),? (\d{4})$/);
  if (!match) throw new Error(`Unrecognized session time: ${value}`);
  let hour = Number(match[1]) % 12; if (match[3] === "pm") hour += 12;
  return Date.UTC(Number(match[6]), MONTHS.indexOf(match[5]), Number(match[4]), hour, Number(match[2]));
}

export function friendships(data: Conversation[], ownerId: string) {
  return data.map((sample, index) => {
    const c = sample.conversation;
    const friendName = FRIEND_BY_SAMPLE[index] === "a" ? c.speaker_a : c.speaker_b;
    const friend = friendName.toLowerCase();
    const sessions = Object.keys(c).filter((key) => /^session_\d+$/.test(key)).sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
    const batches: Source[][] = [];
    const images: { friend: string; caption: string; query?: string; speakerIsFriend: boolean; diaId: string }[] = [];
    for (const session of sessions) {
      const start = parseWhen(String(c[`${session}_date_time`]));
      const turns = c[session] as Turn[];
      const rows = turns.map((turn, i): Source => {
        const record = { speaker_id: turn.speaker === friendName ? friend : "owner", thread_id: friend, participant_ids: ["owner", friend],
          original_text: turn.text, source_at: new Date(start + i * 60_000).toISOString(), is_synthetic: true };
        return { ...record, id: stableSourceId(ownerId, record) } as Source;
      });
      // Shared photos are kept out of the text (their captions become held-out evaluation cases).
      for (const turn of turns) if (turn.blip_caption) images.push({ friend, caption: turn.blip_caption, query: turn.query, speakerIsFriend: turn.speaker === friendName, diaId: turn.dia_id });
      for (let i = 0; i < rows.length; i += MAX_BATCH) batches.push(rows.slice(i, i + MAX_BATCH));
    }
    return { friend, name: friendName, batches, images, sessions: sessions.length };
  });
}

/** Repeated mentions become one relation per (person, topic, relation); importance grows with repetition. */
export function consolidate(relations: IndexedRelation[]) {
  const groups = new Map<string, IndexedRelation[]>();
  const topicOf = (relation: IndexedRelation) => (relation.topic?.trim() || relation.itemMention).toLowerCase().replace(/\s+/g, " ");
  for (const relation of relations) {
    const key = JSON.stringify([relation.personId, relation.subject, relation.relation, topicOf(relation)]);
    groups.set(key, [...(groups.get(key) ?? []), relation]);
  }
  const merged: (IndexedRelation & { mentions: number })[] = [];
  for (const list of groups.values()) {
    // Input is sorted oldest → newest, so the last one is the latest evidence for this group.
    const latest = list[list.length - 1];
    const strength = Math.min(1, Math.max(...list.map((item) => item.strength ?? 0.5)) + 0.05 * (list.length - 1));
    const cues = [...new Set(list.flatMap((item) => item.cues ?? []).map((cue) => cue.toLowerCase().trim()))].slice(0, 8);
    // Evidence: the strongest statement plus the latest (a latest "I sold it" alone would misrepresent a long passion).
    const strongest = [...list].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0))[0];
    // The latest entry's own citations come first, so its quoted words stay grounded; the strongest fill the rest.
    const sourceIds = [...new Set([...latest.sourceIds, ...strongest.sourceIds])].slice(0, 4);
    merged.push({ ...latest, sourceIds, topic: topicOf(latest), cues, strength: Math.round(strength * 100) / 100, mentions: list.length });
  }
  return merged;
}

// A second, independent AI pass (a critic) rereads each profile entry against its quoted messages and removes
// entries that actually describe the other speaker: "How did you get into watercolor?" is not the friend's hobby.
const verdictSchema = { type: "object", additionalProperties: false, properties: { keep: { type: "array", items: { type: "integer" } } }, required: ["keep"] };
const Verdict = z.object({ keep: z.array(z.number().int()) });
async function verifyProfiles<T extends IndexedRelation>(relations: T[], sources: Source[], people: { friend: string; name: string }[], onCall: (usage?: ModelUsage) => void) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const kept: T[] = [];
  await Promise.all(people.map(async (person) => {
    const mine = relations.filter((relation) => relation.personId === person.friend);
    if (!mine.length) return;
    const items = mine.map((relation, index) => ({ index, relation: relation.relation, about: relation.itemMention, topic: relation.topic,
      evidence: relation.sourceIds.map((id) => `${byId.get(id)?.speaker_id === person.friend ? person.name.toUpperCase() : "OTHER"}: ${byId.get(id)?.original_text ?? ""}`) }));
    for (let attempt = 1; ; attempt++) {
      try {
        const answer = await structuredCall({ name: "profile_verdict", schema: verdictSchema, parse: Verdict, reasoningEffort: "low", timeoutMs: 120_000,
          instructions: `You audit a relationship profile about ${person.name.toUpperCase()}. Each entry claims ${person.name} has this relation to the item or topic (enjoys = their own hobby, pursuing = their own goal, owns = their own possession, planned_together = a plan between ${person.name} and OTHER, and so on). Using only the quoted messages, keep an entry only if it is genuinely true of ${person.name}. Remove it when it actually describes OTHER (for example ${person.name} asking about, praising, or reacting to OTHER's hobby, goal, or possession), when the evidence is only a question, or when it is too vague to be true. Return the indices to keep.`,
          content: JSON.stringify(items) });
        onCall(answer.usage);
        const keep = new Set(answer.value.keep);
        kept.push(...mine.filter((_, index) => keep.has(index)));
        break;
      } catch (error) {
        if (attempt >= 3) { console.log(`  ! verification failed for ${person.name}; keeping unverified entries: ${(error as Error).message}`); kept.push(...mine); break; }
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }));
  console.log(`Verification pass kept ${kept.length} of ${relations.length} merged entries.`);
  return kept;
}

async function main() {
  const { read, has } = flags(process.argv.slice(2));
  const path = process.argv[2];
  if (!path || path.startsWith("--")) throw new Error("Usage: npm run profiles:build -- data/private/datasets/locomo10.json [--friends N] [--concurrency N] [--write]");
  const admin = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const email = need("DEMO_ADVISOR_EMAIL").toLowerCase();
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (usersError) throw usersError;
  const owner = users.users.find((user) => user.email?.toLowerCase() === email);
  if (!owner) throw new Error("Dataset owner account (DEMO_ADVISOR_EMAIL) not found.");
  const data = JSON.parse(await readFile(path, "utf8")) as Conversation[];
  const limit = Number(read("friends") ?? data.length);
  const people = friendships(data, owner.id).slice(0, limit);
  const concurrency = Number(read("concurrency") ?? 6);
  await mkdir(join(OUT, "raw"), { recursive: true });

  const jobs = people.flatMap((person) => person.batches.map((batch, index) => ({ person, batch, file: join(OUT, "raw", `${person.friend}-${String(index).padStart(3, "0")}.json`) })));
  const usage: ModelUsage[] = [];
  let calls = 0, reused = 0, dropped = 0, done = 0, cursor = 0;
  const started = Date.now();
  const results: IndexedRelation[][] = new Array(jobs.length);
  console.log(`${people.length} friendships · ${people.reduce((n, p) => n + p.batches.reduce((m, b) => m + b.length, 0), 0)} messages · ${jobs.length} batches · model ${modelDisplayConfig().model}`);
  const worker = async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      const job = jobs[index];
      const cached = await readFile(job.file, "utf8").then((text) => JSON.parse(text) as { relations: IndexedRelation[] }, () => null);
      if (cached) { results[index] = cached.relations; reused++; }
      else {
        for (let attempt = 1; ; attempt++) {
          try {
            const out = await extractBatch(job.batch, owner.id, { onCall: (u) => { calls++; if (u) usage.push(u); } });
            results[index] = out.relations; dropped += out.dropped;
            await writeFile(job.file, JSON.stringify({ relations: out.relations, dropped: out.dropped }));
            break;
          } catch (error) {
            if (attempt >= 3) { console.log(`  ! ${job.person.friend} batch ${index} failed: ${(error as Error).message}`); results[index] = []; break; }
          }
        }
      }
      done++;
      if (done % 10 === 0 || done === jobs.length) console.log(`  ${done}/${jobs.length} batches · ${calls} calls · ${reused} reused · ${Math.round((Date.now() - started) / 1000)} s`);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const allSources = people.flatMap((person) => person.batches.flat());
  // A person's own state needs their own words: the owner's goals, which a friend merely reacted to, are not the friend's.
  const speaker = new Map(allSources.map((source) => [source.id, source.speaker_id]));
  const ownState = new Set(["enjoys", "pursuing", "owns", "prefers", "wanted", "inspired", "dislikes", "recommended"]);
  const attributed = results.flat().filter((relation) => !ownState.has(relation.relation) || relation.sourceIds.some((id) => speaker.get(id) === relation.personId));
  const misattributed = results.flat().length - attributed.length;
  const everything = removeAmbiguousSelfRequests(uniqueRelations(attributed), allSources);
  const at = new Map(allSources.map((source) => [source.id, Date.parse(source.source_at!)]));
  const latestAt = (relation: IndexedRelation) => Math.max(...relation.sourceIds.map((id) => at.get(id) ?? 0));
  everything.sort((a, b) => latestAt(a) - latestAt(b));
  const merged = await verifyProfiles(consolidate(everything), allSources, people, (u) => { calls++; if (u) usage.push(u); });
  // Keep each friend's strongest relations; negatives are kept so later changes still close older reasons.
  const kept = people.flatMap((person) => merged.filter((relation) => relation.personId === person.friend)
    .sort((a, b) => Number(b.sentiment === "negative" || ["dislikes", "cancelled"].includes(b.relation)) - Number(a.sentiment === "negative" || ["dislikes", "cancelled"].includes(a.relation)) || (b.strength ?? 0) - (a.strength ?? 0))
    .slice(0, MAX_PER_FRIEND));
  // The app rejects a whole memory if any entry's quote can't be found in its cited messages; never write one.
  const verify = groundedIn(allSources, owner.id);
  const ungrounded = kept.filter((relation) => !verify(relation));
  if (ungrounded.length) console.log(`Dropped ${ungrounded.length} entries whose quoted words aren't in their cited messages.`);
  for (const relation of ungrounded) kept.splice(kept.indexOf(relation), 1);
  const evidenceIds = new Set(kept.flatMap((relation) => relation.sourceIds));
  if (evidenceIds.size > SOURCE_INDEX_LIMIT) throw new Error(`${evidenceIds.size} evidence messages exceed the ${SOURCE_INDEX_LIMIT}-message backend limit; lower MAX_PER_FRIEND.`);
  const evidence = allSources.filter((source) => evidenceIds.has(source.id));
  const relations = kept.map((relation) => { const copy: Partial<typeof relation> = { ...relation }; delete copy.mentions; delete copy.threadHash; return copy as IndexedRelation; });
  const topics = new Set(relations.map((relation) => relation.topic));
  const inputTokens = usage.reduce((n, u) => n + u.inputTokens, 0), outputTokens = usage.reduce((n, u) => n + u.outputTokens, 0);
  console.log(`\nExtracted ${everything.length} relations → ${merged.length} after merging repeats → kept ${relations.length} (${topics.size} AI-made topics) citing ${evidence.length} evidence messages.`);
  console.log(`Calls this run: ${calls} (${reused} batches reused from checkpoints), ${dropped} unverifiable entries dropped, ${misattributed} dropped for not citing the person's own words; ${inputTokens} input / ${outputTokens} output tokens.`);
  for (const person of people) {
    const mine = relations.filter((relation) => relation.personId === person.friend).sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));
    console.log(`  ${person.name.padEnd(8)} ${String(mine.length).padStart(2)} relations · top: ${mine.slice(0, 5).map((r) => `${r.topic} (${r.relation}, ${r.strength})`).join("; ")}`);
  }
  const model = modelDisplayConfig();
  await writeFile(join(OUT, "profile.json"), JSON.stringify({ ownerId: owner.id, model: model.model, promptVersion: INDEX_PROMPT_VERSION, friends: people.map((p) => ({ id: p.friend, name: p.name, sessions: p.sessions })),
    relations, evidence, images: people.flatMap((p) => p.images) }, null, 1));
  console.log(`Saved ${join(OUT, "profile.json")}`);

  if (!has("write")) { console.log("Dry run: nothing written to the backend (add --write)."); return; }
  const { data: existing, error: readError } = await admin.from("sources").select("id,is_synthetic").eq("owner_id", owner.id);
  if (readError) throw readError;
  if ((existing ?? []).some((row) => !row.is_synthetic)) throw new Error("Refusing: the dataset owner has non-synthetic messages.");
  const removed = await admin.from("sources").delete().eq("owner_id", owner.id).eq("is_synthetic", true);
  if (removed.error) throw removed.error;
  for (let i = 0; i < evidence.length; i += 200) {
    const insert = await admin.from("sources").insert(evidence.slice(i, i + 200).map((source) => ({ ...source, owner_id: owner.id, origin: "import" })));
    if (insert.error) throw insert.error;
  }
  // Fingerprint the messages exactly as the app will read them back (the database normalizes timestamps).
  const { data: stored, error: storedError } = await admin.from("sources").select("id,speaker_id,thread_id,participant_ids,original_text,source_at,is_synthetic")
    .eq("owner_id", owner.id).order("created_at", { ascending: true }).limit(SOURCE_INDEX_LIMIT + 1);
  if (storedError || !stored || stored.length !== evidence.length) throw new Error("Could not read back the imported evidence.");
  const revision = corpusRevision(stored);
  const upsert = await admin.from("context_indexes").upsert({ owner_id: owner.id, cache_key: keyFor(owner.id, revision, model.provider, model.model), corpus_revision: revision,
    provider: model.provider, model: model.model, prompt_version: INDEX_PROMPT_VERSION, source_count: evidence.length, relations }, { onConflict: "owner_id" });
  if (upsert.error) throw upsert.error;
  // Every friend routes to the recipient demo phone, so any match can be sent and answered live.
  const recipient = users.users.find((user) => user.email?.toLowerCase() === need("DEMO_RECIPIENT_EMAIL").toLowerCase());
  if (recipient) for (const person of people) await admin.from("contacts").upsert({ owner_id: owner.id, person_id: person.friend, recipient_id: recipient.id }, { onConflict: "owner_id,person_id" });
  console.log(`Wrote ${evidence.length} evidence messages and the prepared memory to ${email}; ${people.length} friends mapped to the recipient phone.`);
}

if (process.argv[1]?.endsWith("profiles-build.ts")) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
