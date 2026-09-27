# How the AI works: the technical story for judges

Updated September 26, 2026. Current hosted checks and earlier model comparisons are labeled separately. See [the soda scan audit](SODA_SCAN_FIX.md) for the latest targeted work.

## One sentence

**Callback uses Meta muse-spark-1.3 ahead of time to extract private relationship memory with source citations. Meta muse-spark-1.2 identifies the image, then code checks the prepared evidence and chooses a supported connection without rereading the chats through a model.**

## Two models, two jobs (tiered inference)

| Job | When it runs | Model | Why this model |
|---|---|---|---|
| **Build relationship memory**: read approved messages, extract typed relations and source words | Ahead of time, when you open the app or your context changes | `muse-spark-1.3` | Kept for extraction; initial preparation still blocks hover until ready |
| **The glance**: what is the camera looking at? | Live, while you hold the phone steady | `muse-spark-1.2` | Current configured model for a compact title/category and mixed-display inventory |
| **The decision**: who, why, and is it still true? | Live, right after the glance | No model: code over the prepared memory | Milliseconds in prior traces; constrains IDs and evidence, but cannot prove every model-assigned relation is semantically correct |

This is the same idea as serving systems that route requests by cost: spend the memory model's time ahead of the live scan. All capture paths require current prepared memory; a stale or missing index prompts a refresh before vision. The current vision input is auto-oriented, resized to a 1024-pixel maximum edge, and encoded as metadata-free JPEG quality 82. The Meta call uses `minimal` reasoning and a 1,536-token output cap.

## Earlier model comparison: two manufacturer images

Same two manufacturer images (a board game box with a readable title, and a second box that should match no one), each shown twice at both reasoning settings: **8 calls per model, same session, same network** (MacBook to `api.meta.ai`, September 26 ~12:00 ET). "Correct" = the model returned the exact product title.

| Meta model | Correct | Typical time (median, best setting) | Slowest call | Notes |
|---|---|---|---|---|
| `muse-spark-1.3` | **8/8** | 4.7 s (`minimal`); 6.5 s (`low`) | 8.3 s | Used for memory |
| `muse-spark-1.2` | 7/8 | 3.3 s (`minimal`); 3.9 s (`low`) | 15.0 s (timed out, counted as a miss) | Current model, with a different prompt/image path |
| `muse-spark-1.1` | **8/8** | **1.7 s** (`minimal` and `low`) | **2.9 s** | Used in the earlier M1/V3 deployment |

What this does and doesn't show:
- **Does:** on these two clean, readable product images, 1.1 matched 1.3's titles and was about 2.8× faster at the median in that historical setup.
- **Doesn't:** it isn't a phone-camera benchmark (glare, angles, motion), and two images aren't a held-out accuracy test. Re-check with `npm run photos:check` on real phone photos of the actual props, and report the misses.
- Earlier end-to-end hover runs on 1.3 took 5.0–10.0 s total, of which 4.8–9.2 s was vision and about 5 ms was memory lookup and decision. These are not timings for the current image path.

Private reports (not in Git): `data/private/latency/vision-2026-09-26T15-58-10-448Z.json` (1.2), `…15-58-26-212Z.json` (1.1), `…15-59-21-495Z.json` (1.3).

## Current hosted shelf checks (September 26, deployed source `2ae24c0`)

The original uploaded soda shelf photo produced three unsaved hosted previews in **6.473 / 7.605 / 7.980 s**. Each used prepared memory with `relationsMs: 0`. Agarwal's named Diet Coke preference stayed in the candidate evidence as `needs_exact`; Alan's zero-sugar-soda taste appeared only as a **related** reminder, without asserting the preferred variety was visible. A manual scan took **6.823 s** with no text extraction. Four existing rendered demo controls returned their expected person and relation. Cold preparation of 18 sources took **28.56 s** and one model call, separate from these warm scan times. The current check passed **398 offline tests**, lint, types, build, and release checks.

These are hosted upload checks, not live phone hover or a two-second latency promise. The new timing fields separate image preparation, request serialization, response-header wait, body read, parse, and retries. Response-header wait includes network/upload, provider queue, and computation; it is not pure model inference time. See [SODA_SCAN_FIX.md](SODA_SCAN_FIX.md) for the source photo, measured comparison, and remaining limits.

## Earlier live demo-story checks (September 26, prior 1.1 deployment)

Synthetic rendered images (not phone photos), fictional labeled chats, `muse-spark-1.1` vision + `muse-spark-1.3` memory:

| Scan | Result | End-to-end | Of which vision |
|---|---|---|---|
| *War and Peace* cover | Maya (inspired: "try writing a novel") | **1.6 s** | 0.9 s |
| *Anna Karenina* cover | Sam (recommended it) | 1.9 s | n/a |
| Coffee bag (fictional brand) | Maya (likes "light-roast whole beans") | 3.3–5.4 s | n/a |
| Water bottle | no one | 1.7–2.0 s | 1.5 s |

Memory build for 8 messages: 5 parallel `muse-spark-1.3` calls, 13–44 s ahead of time (local builds). An added message re-reads only its own conversation (1 call, ~15 s), and reset costs 0 calls (0.3 s). Decision and retrieval: ~5 ms.

**Later independent check:** the corrected deployment produced the same four expected results in **3.120s / 1.912s / 4.017s / 2.507s** respectively (median 2.814s, n=4). A separate book save/send/reply check took 2.678s for recognition. Additional synthetic messages had been added during testing; these timings describe that run, not a fixed eight-message benchmark. See [the readiness review](READINESS_REVIEW.md). Do not turn an earlier 1.6s result into a general speed claim.

## The research ideas we actually use (and how to say them)

1. **Task-specific model routing.** One model prepares memory; another identifies the image. This is a fixed split by task, not a learned cascade that escalates the same query. Related work: [FrugalGPT](https://arxiv.org/abs/2305.05176) (Chen et al., 2023); we do not implement its learned cascade.
2. **Prepared memory with evidence checks.** The model extracts typed relations with item words and message IDs. Code verifies those strings and references and requests bounded corrective retries when validation fails. This resembles the external-feedback idea in [CRITIC](https://arxiv.org/abs/2305.11738) (Gou et al., 2023), but is not its implementation. Correct strings do not guarantee correct relation labels or complete recall. Knowledge lives outside the model and can be updated without retraining, as in the broad retrieval pattern discussed in [FAIR's RAG research](https://arxiv.org/abs/2005.11401); we do not implement its dense-retrieval/generation model.
3. **Temporal belief revision.** Later messages retire earlier reasons with explicit rules: "I stopped writing it" ends the ambition, owning something ends a wish, disliking a variety doesn't cancel liking another. Deterministic, so judges can see *why* someone was ruled out.
4. **Preference elicitation → constraint ranking (the Visa half).** The AI reads a casual chat line and decides the *polarity* ("light-roast whole beans" = likes; "dark roasts aren't my thing" = avoids). Code then ranks a catalog by those constraints and explains every exclusion in the friend's own words. The AI never picks the product; it turns messy language into constraints a store can use.
5. **Incremental computation.** Conversations are content-hashed like a build system. Unchanged threads with stored verified relations can be reused. Threads with no extracted relations may be re-read; changed threads can need several batches/retries. One-call updates and zero-call resets describe the measured demo, not a universal bound.

## Meta research we probed but haven't shipped: Segment Anything 3.1

Meta's `sam-3.1` is on the same API (`POST /v1/responses`, a short noun prompt plus the image; it returns a pixel box and mask for each match). Our probe (September 26):
- **Found:** the manufacturer product photo, prompt "box", in 2.4 s; the rendered coffee bag, prompt "bag", in 1.1 s.
- **Didn't match:** the flat, drawn book cover ("book" / "book cover"), which is not a photo of a real book.

**Proposed use, deferred:** draw a segmentation outline after recognition. A returned mask describes the submitted frame, not wherever the object has moved in the current camera view. Live placement needs frame alignment or tracking plus physical-device tests. This is not implemented, is not needed for the selected demo, and has no reliable one-hour estimate.

## Talking points that are true and land with Meta engineers

1. **"No scan rereads your chats through a model."** Memory was extracted ahead of time; manual, hover, and device scans require that prepared index and use one vision call plus deterministic retrieval/decision. Show `relationsMs: 0`; missing or stale memory asks for a refresh.
2. **"Each surfaced connection has evidence you can inspect."** Code checks source IDs, item words, and attribution, and asks for retries when extraction fails validation. The model can still mislabel or omit a relationship; the visible source lets the user judge the suggestion.
3. **"Memory knows when things change."** A later "I gave up on that" or "let's skip it" closes the old reason; owning something closes a wish but not a plan to do it together. Rules are deterministic, so the same memory always gives the same answer.
4. **"Memory reuses unchanged conversations."** Content hashes identify reusable derived relations. The measured demo reset used zero model calls; that is not guaranteed for every corpus or provider change.
5. **"A separate Meta model for each job."** Current vision uses 1.2 with a compact visual inventory; memory uses 1.3. The earlier two-image model comparison is historical.

Don't claim: split-second or "faster than a QR code" recognition, on-device AI, all-knowing memory, or that we implemented FAIR's RAG, DINO, or SAM. The honest line is "we use Meta's models in a retrieval-style architecture: the model's knowledge of your relationships is external, cited, and updatable without retraining."
