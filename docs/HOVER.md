# Hover connections

Opening the authenticated scanner starts preparing relationship memory from approved context. Start hover explicitly, then hold an item in the viewfinder. Callback recognizes the object with a vision call and looks up a supported connection. Tap the person chip to save the photo and open an editable invitation. Sending remains a separate action. See [the architecture and research notes](PREPARED_MEMORY.md).

## What runs when

- Preparation: `POST /api/context/prepare` extracts all mentioned items in bounded, thread-aware batches. The private `context_indexes` row is keyed by owner, full corpus revision, provider/model, and prompt version. Context changes invalidate it; demo controls prepare it again. Imports are picked up when preparing again.
- Recognition: approximately six tiny grayscale samples per second check stability locally. After about 400 ms of a steady, sufficiently lit/detailed view, one compressed frame goes to the model. This is a capture heuristic, not local object recognition or object tracking.
- Lookup: current prepared relations go through the existing source, subject, specificity, recency, ownership, and cancellation rules. A warm hover scan makes no relationship-extraction call.
- Preview: the server returns a ten-minute signed receipt bound to the owner, image bytes, and corpus revision. Callback stores neither the scan row nor the photo yet. Frames still go to the configured model provider for recognition; this is not an on-device-only mode.
- Selection: `POST /api/scans/save` verifies the receipt and current context, saves once, then enables messaging and shopping. Concurrent saves use separate upload paths so the losing request cannot delete the retained photo.
- Revisit: the browser remembers up to 24 confirmed views during the session. Revisiting a stable view reuses the preview without another inference call. A changed memory revision invalidates these cached views. Expired previews require a fresh scan.
- Manual capture/upload: still available. These deliberately save the scan, as before. They use prepared memory when current; otherwise they fall back to the original two-call pipeline.

## Controls and limits

One recognition request can be in flight at a time; captures are at least three seconds apart. Hover pauses when hidden, while reviewing a selected connection, or after an error. Twelve automatic checks require an explicit Resume for another batch. This is a browser session budget, not a billing/account-wide hard cap. Failed model checks count against that batch; local encoding failures do not.

Movement removes the previous chip. A recognition already in flight can finish and enter the local cache, but its result is not painted over a different view. Fingerprints are a visual heuristic: a changed angle can trigger another call, and similar views can be mistaken for repeats. Use the manual button if this happens.

Preparation batches at most 20 messages/24,000 characters per call, with a bounded deadline and workload. Very large imports may need a background indexing job; the prototype does not claim unlimited indexing. Concurrent preparations on different server instances may duplicate paid work. Failed or outdated builds are never marked ready.

## Measured localhost API check (September 26, 2026)

One `npm run hover:check` pass against `http://localhost:3000` passed 16/16 checks. The test used the [Wingspan manufacturer image](https://store.stonemaiergames.com/products/wingspan) and [Scythe manufacturer image](https://store.stonemaiergames.com/products/scythe) from `data/private/test-images/`, with the fictional 10-message demo context. It used the configured OpenAI `gpt-5.4-mini` model; this run does not establish Meta inference performance.

The already prepared index contained 10 sources and 10 relations. Both preparation requests reused it with zero new model calls and zero reported preparation tokens. Wingspan matched Maya's open plan in 3.162 seconds; Scythe returned no match in 3.703 seconds. Each hover lookup reported `relationsMs = 0` and no relation model usage. The two vision calls reported 3,722 input and 261 output tokens combined; provider charges were unavailable.

Before selection, the Wingspan preview had no saved scan or stored photo. Two concurrent save requests returned 200/201 for the same scan, leaving one photo. A scripted invitation reached the recipient in 242 ms by API polling, and a scripted reply became visible to the scanner in 294 ms. Shopping returned three demo options without creating a quote. These are localhost API timings, not browser rendering, physical-camera, Realtime, human reply, or payment measurements. The sanitized run record is under ignored `data/private/live/`.

## Measured hosted API check (September 26, 2026)

One pass against [the Vercel deployment](https://callback-khaki-phi.vercel.app) (`dpl_AKWmWVgT4EUby6SVfnGQoKRcpNJA`) passed 16/16 checks using the same [Wingspan](https://store.stonemaiergames.com/products/wingspan) and [Scythe](https://store.stonemaiergames.com/products/scythe) manufacturer images and fictional demo messages. The prepared 10-source, 10-relation index was reused twice with zero new preparation model calls. Wingspan matched Maya's open plan in 2.985 seconds; Scythe returned no match in 3.026 seconds. Both hover lookups reported `relationsMs = 0` and no relation model usage. The configured OpenAI `gpt-5.4-mini` vision calls reported 3,722 input and 237 output tokens combined; provider charges were unavailable.

The hosted preview had no scan row or photo before selection. Two concurrent saves returned 201/200 for the same scan and left one photo; reopening it succeeded. A scripted invitation appeared for the recipient in 268 ms by API polling, and the scanner saw the scripted reply in 205 ms. Shopping returned three demo options without requesting a quote. This single hosted API pass does not measure browser display, camera behavior, Realtime delivery, a human reply, checkout, or Meta inference. Its sanitized run record is under ignored `data/private/live/`.

## Review fixes and hosted re-verification (September 26, ~05:10 ET)

A review found and fixed these; each has regression tests that fail on the previous code (230 tests total):

- **Title matching.** The vision call now returns the product's store `title` and any `edition` note separately. Exact matching uses the title, with a conservative cleanup of the full description (a maker "by …", ordinal edition/printing notes, tagline subtitles; never a subtitle that names a distinct product such as "European Expansion"). Before, realistic descriptions of the correct box — "Wingspan board game by Stonemaier Games", "Stonemaier Games Wingspan", "Wingspan (2nd Edition)", or the printed tagline — missed Maya's plan. "Wingspan Asia" and "X100VI" are still rejected.
- **Source limit.** Sending and shopping used a leftover 40-message cap while scanning allowed 1,000; larger contexts could scan but not send or shop.
- **One bad entry no longer fails memory.** Each relation is validated and grounded on its own; rejects are counted (`rejectedCount`) and shown in the memory notice.
- **Stable memory.** Relations carry their thread's hash; a rebuild can reuse unchanged threads that produced verified relations. Threads with no relations have no stored hash and are read again after another context change. Small contexts get one call per thread (up to 12, 6 in parallel), because one call over all ten demo messages repeatedly missed Priya's Wingspan dislike. Five real builds found every expected relation (5/5 each) in 2.0–3.2 s.
- **Shared relations must involve you.** "We play every Sunday" (Noah's household) was extracted as a shared experience in 3–5 of 5 real builds; with Maya's plan cancelled, Noah would have become the match. Shared plans, experiences, and gifts now need the user in the cited exchange or words that address them (English heuristic, conservative).
- **Title evidence is exact.** The live memory labeled Noah's "Wingspan" as category evidence, which hid "Ask Noah". Evidence whose verified words equal the photo's title is treated as exact; brand-only or generic words are not.
- **Other:** previews are signed with `PREVIEW_SIGNING_SECRET` or an HKDF-derived key (never the service credential itself); the model is no longer asked for a discarded reason; memory preparation stays at `low` effort (`medium` took 18–23 s and once overflowed the output cap).

Hosted re-verification on production `dpl_G7jKQWqNPZzunzHgsrZSeeCP3xZi` (OpenAI `gpt-5.4-mini`, manufacturer images, synthetic context, scripted replies): hover 16/16 (Wingspan → Maya in 3.1–3.4 s; Scythe no match), access 24/24, commerce 17/17. Memory rebuild on the hosted app: 3.3 s, 6 calls. Update beat ("I bought Wingspan!"): rebuild 1.6 s re-reading 1 thread; Maya's plan kept. Cancel beat ("Let's skip the Wingspan plan…"): rebuild 2.0 s; no match, Noah not matched. Each reset: ~0.2–0.3 s, zero model calls, memory restored byte-for-byte. The current demo memory rules out Jordan, Noah, and Priya; "Ask someone" shows Noah ("hasn't said what they think" — this build did not mark his "Honestly love it" as positive) and Priya's caution.

## Pre-merge review corrections

The hosted numbers above describe Claude's deployed baseline, before these additional fixes:

- A rejected relation could be the newer cancellation or ownership update that invalidates a suggestion. Preparation now retries the affected extraction batch once and saves only a fully verified result. A second validation failure leaves memory unavailable and asks for a retry; it never publishes the remaining old plan as complete history. The prompt/cache version changes so older partial indexes are rebuilt.
- A structured product title is authoritative. A broad description cannot override “Wingspan Asia,” and genuine subtitles and meaningful editions must not be stripped into a different product. This supersedes the baseline's broad cleanup of “2nd Edition”: named/numbered editions stay distinct; an ordinary printing note can be removed. A model's mistaken family-level label must not bypass this identity check.
- Household statements containing “together,” “us,” or “remember” alone do not establish that the user participated. Direct invitations and cited owner participation still work. This remains a conservative English heuristic, not a guarantee of semantic accuracy.

See [progress](PROGRESS.md) for verification of the merged source. Rebuild memory and rerun the deployed check after releasing a new prompt version. The bounded retry can add preparation latency; warm recognition still uses one vision call. The model can still omit a relationship entirely, which is why held-out real-message/photo evaluation remains necessary.

## Merged-main deployment and memory reliability (September 26, ~07:00 ET)

Deployed merged `main` (`8c5751c`, `dpl_6VuotTnsoeNRBDVVo6XAbcKTUCto`). Its first hosted memory build failed: "unverifiable context evidence after a retry" (HTTP 503), so hover could not start. Cause: v5 verified the model's optional `aliases` directly, so one invented alias failed its relation, and the single retry could repeat it. Real-model probe on the demo context before fixing (4 builds): one needed the retry for exactly this reason; Noah's "Honestly love it" was read as owns + positive in 1/4, a separate **dislikes** in 1/4 (there is no "likes" relation), and neutral otherwise.

Fix (`claude/memory-reliability`, prompt `all-items-v6`): drop ungrounded/unsafe aliases before verification (the relation itself is still verified); allow two corrective retries per batch (still counted against the 60-call budget; partial batches are still never saved); tell the model a liked item is owns with positive sentiment, never dislikes. Probe after (8 builds, no database): 8/8 succeeded with no retries; Maya's plan 8/8; Noah owns + positive 8/8, no dislikes; Priya's Wingspan dislike 7/8; Noah's false shared experience 2/8 (still blocked by the involves-you rule).

Hosted on `dpl_2LoZbauHpruii3ustjZYRjL2z3zw` (OpenAI `gpt-5.4-mini`, manufacturer images, synthetic context, scripted replies): the first v6 build succeeded (6 calls) but was the 1/8 case missing Priya's Wingspan dislike, so the cached row was deleted and memory rebuilt once (demo preparation). Then: hover 16/16 including shopping (Wingspan → Maya 2.4 s; Scythe no match), access 24/24, commerce 17/17. Saved hero scan: advice "Noah has one and spoke well of it." and "Priya didn't like it. Worth hearing why."; Jordan, Noah, and Priya ruled out as the main match. Update beat: 1 call, 1.1 s, still Maya (2.7 s). Cancel beat: 1 call, 1.6 s, no match. Each reset: ~0.13 s, zero calls, memory restored byte-for-byte, Maya again.

If memory is ever rebuilt from scratch (provider switch, new import), check that Maya's plan, Noah's positive ownership, and Priya's dislike are all present before judging; one build in eight missed Priya's Wingspan dislike.

## Phone rehearsal

1. Open the HTTPS deployment on two phones and sign into the private Alex/Maya demo accounts.
2. Start hover on Alex's phone; wait for “Memory ready.” Aim at the real Wingspan box with its title visible.
3. Hold, move away, then return. Verify one chip, no flashing/stale person, and cached revisit behavior.
4. Tap Maya, inspect the original message, edit the invitation, and send. Have Maya type a genuine reply and agree on a next step.
5. Open shopping, ask Noah about personal experience, then compare the demo merchant's versions and total. Stripe TEST payment and webhook processing are now verified; physical-phone checkout remains pending.
6. Repeat in venue lighting and Wi-Fi, including a different edition, an unrelated item, hidden tab, and denied-camera/upload fallback. Record failures as well as timing.

Automated camera tests use synthetic frames. Online API checks use manufacturer images, fictional chats, and scripted replies. Neither establishes physical-camera smoothness or human connection.

## Stronger track story

Meta: “We remember the plans hidden in your conversations, so something you encounter can become a reason to follow through.” Demonstrate the recipient's reply and agreed activity; the person is the outcome. Measure whether the suggestion felt specific and welcome, not only whether a model found a match.

Visa: “Recognize it, remember whose experience you trust, choose the right version, and carry that decision into checkout.” Opening shopping loads options immediately; advice questions name the item and remain editable. Quotes and payment approval stay explicit. Prices/stock are a demo catalog, and Stripe TEST checkout is not a Visa API integration.

Meta inference has been verified on hosted API uploads. Do not promise faster-than-QR recognition, a particular phone latency, glasses support, or on-device CLIP until each is measured on the final setup. The present improvement is fewer taps and one model call on the warm recognition path.

## Meta production cutover — September 26

Deployment dpl_6hZUHgpeSpnJEkHKptjLjxR1qxHp runs Meta muse-spark-1.3. Fresh hosted hover checks passed 16/16, including shopping options. Preparation built 10 relations from 10 sources with six model calls (6,558 input / 7,825 output tokens); repeat preparation used zero calls. The hero preview took 6,652 ms and used no per-scan relation extraction. Both vision calls together reported 4,481 input / 1,551 output tokens. Concurrent opening saved one scan and photo, the other account could not read memory, the scripted reply arrived, and the unrelated image had no match. Private report: data/private/live/hover-2026-09-26T14-04-35-257Z.json. Manufacturer images and scripted replies; physical phones remain unverified.

## Automatic preparation and measured warm path — September 26, 11:45 ET

Root-reviewed code `139136f` is deployed as `dpl_2UEyM4x1E3AZukoaWEhM84uKv2XX`. Scanner load now starts preparation automatically; an edit during preparation queues a fresh build and prevents the old response from marking memory ready. A single contact query covers matches and advice. Offline validation passed 316 tests in 48 files, lint, TypeScript, build, and the release check.

The root agent reran the hosted check after deployment: **16/16 passed**, with 10 sources/10 relations reused on both preparations and zero preparation calls. Vision used Meta muse-spark-1.3 with `VISION_REASONING_EFFORT=minimal`; memory extraction remains `low`. This setting is a measured pilot, not a proven latency guarantee; see [the paired experiment](PREPARED_MEMORY.md).

| Stage | Main image | Unrelated image |
|---|---:|---:|
| Source loading/revision | 76 ms | 46 ms |
| Prepared memory loading/validation | 44 ms | 25 ms |
| Vision | 9,166 ms | 4,455 ms |
| Candidate retrieval | 3 ms | 1 ms |
| Deterministic decision | 2 ms | 0 ms (rounded) |
| Contact lookup | 67 ms | 0 ms (not needed) |
| Server stream completion | 9,386 ms | 4,542 ms |
| Client API wall time | 10,053 ms | 4,955 ms |

The correct connection and unrelated no-match both used `relationsMs: 0` with no relation-model usage. Both vision calls together reported 4,481 input / 573 output tokens. Private memory isolation, unsaved preview, concurrent save deduplication, reopening, scripted send/reply, and shopping options all passed. No quote or payment was created.

The main image was slower than earlier runs despite the lower median in the separate paired experiment. Do not hide this result or call recognition instant: **the prepared relationship lookup is fast, while remote vision is variable and dominates this trace**. This remains two manufacturer-image API uploads with synthetic context/scripted replies, not a phone-camera or human-connection measurement. Private report: `data/private/live/hover-2026-09-26T15-45-37-378Z.json`.
