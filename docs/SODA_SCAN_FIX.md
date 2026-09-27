# Soda matching and scan latency

September 26, 2026. Root review of the user's shelf-photo failures. The original uploaded shelf photo, saved scans, and paid-call reports stay in ignored `data/private/soda-audit/`.

## What actually failed

The two saved scans did **not** use prepared memory, even though the browser displayed “Memory ready.” The manual path silently fell back to reading the messages through another model call:

| Saved scan | Vision | Relationship extraction | Server assembly |
|---|---:|---:|---:|
| First shelf result | 5.873 s | 36.387 s | 42.421 s |
| After adding the other preference | 9.725 s | 30.111 s | 39.898 s |

The logs establish that fallback occurred; they do not identify whether each missing index was caused by an in-flight edit, an outdated extraction version, or another readiness change. A client ready label was not sufficient.

There were two matching defects. The decision code downgraded **all** preferences to category evidence and let them bypass observed-product checks. A named Diet Coke preference could therefore become a match on generic soda. Separately, extraction/retrieval varied with the photo's wording (soda versus Coca-Cola versus soft drink); one extraction returned only the newly added person's mention.

## Changes

- Every capture path requires a current prepared index **before** vision or storage upload. Missing/stale/read-failed memory produces an explicit `memory_required` event. The browser clears its stale ready flag, rebuilds, preserves the attempted photo, and offers an explicit retry. No hidden text-model fallback or automatic manual rescan remains.
- Memory prompt `all-items-v9` distinguishes named products from category/attribute tastes. Broad displays retrieve same-kind candidates without treating them as visually confirmed products. Source evidence remains independently checked.
- Vision describes a mixed shelf as a category plus at most six explicitly identified product names. The person's messages never go into this vision call. It must not infer an unseen diet/sugar-free variant.
- Named preferences need the named product in the visual identity. Otherwise the person remains in the checked candidates with `needs_exact`. A category taste can support a **related** reminder, clearly labeled as such; its draft describes the observed category, not an unconfirmed preferred variety.
- Primary editions remain intact when the visual inventory repeats the main title. A secondary item must retain its own full variant name. Book printings still refer to the same work.
- All images are auto-oriented and bounded to 1024 pixels, JPEG quality 82, with metadata stripped from the model input. The original saved photo is unchanged. Images are decoded with a 64-megapixel limit.
- Vision uses Meta `muse-spark-1.2`, `minimal` reasoning, and a 1,536-token cap; prepared memory remains on `muse-spark-1.3`. A timed-out vision call no longer silently doubles the 15-second wait. Other transient provider errors retain one bounded retry, recorded in the diagnostics.

## Measured vision experiments

These are small engineering comparisons, not a randomized latency study or held-out accuracy benchmark.

- Original prompt/model 1.1 on the actual 1280-pixel shelf photo: **8.218 s** in a local API replay.
- Compact prompt/model 1.1: **5.058 and 5.479 s** at 1024 pixels; **4.213 and 6.151 s** at 768 pixels. Reducing resolution further was not consistently faster, so we kept 1024 for label detail.
- Compact prompt/model 1.2 at 1024 pixels: **2.550 and 3.276 s**. Both identified a mixed soda shelf and neither reported Diet Coke or a zero-sugar product.
- Model 1.2 control images: *War and Peace* **2.219 s**, *Anna Karenina* **1.798 s**, coffee **3.066 s**, bottle **2.658 s**. These are existing rendered demo controls, not phone photographs; identifying the broad subject is not proof of every small-label character.
- Meta 1.1 rejected `reasoning_effort: none` with HTTP 400. We did not deploy that unsupported setting.

## Hosted verification

Deployed code: `2ae24c0`, production deployment `dpl_4cznss9HDWhQsvBn7Zf94MqLz991`, at [the live app](https://callback-khaki-phi.vercel.app). Production was verified to use Meta 1.2 vision, 1.3 memory, and the v9 index. **398 tests**, lint, TypeScript, production build, and the tracked-file secrets check pass.

The existing **18 source messages were preserved**. Rebuilding their derived memory took **28.56 s / one model call**, separately from scans. The stored result contains the named Diet Coke preference at exact-title level and the zero-sugar-soda taste at category level. This cold build cost has not disappeared; it happens ahead of scanning and after relevant context changes.

Three unsaved hosted runs used the **original user-uploaded shelf image**, without the screenshot's surrounding preference text:

| Run | Client wall | Server total | Vision request | Memory read | Relationship extraction |
|---|---:|---:|---:|---:|---:|
| 1 | 6.473 s | 5.831 s | 5.592 s | 30 ms | 0 ms |
| 2 | 7.605 s | 7.322 s | 7.147 s | 32 ms | 0 ms |
| 3 | 7.980 s | 7.810 s | 7.626 s | 34 ms | 0 ms |

All three produced Alan's **related** preference and kept Agarwal as an unconfirmed candidate (`needs_exact`). Each made one vision attempt and zero text-extraction calls. A separate **manual saved upload** passed the same checks in **6.823 s**: no Diet Coke/zero-sugar identity invented, safe category-based draft, and both people's source-backed candidates retained. A local counterfactual using the actual prepared relations without Alan's entry still retained Agarwal as `needs_exact`; this did not edit the live corpus.

Four additional hosted unsaved controls passed their expected person/relation: *War and Peace* → Maya/inspired (**3.872 s**), *Anna Karenina* → Sam/recommended (**8.450 s**), coffee → Maya/prefers (**4.933 s**), bottle → no match (**6.860 s**). These remain rendered demo images, not proof of physical-camera performance. No external messages, payments, or context resets were made in this verification.

The remaining hosted bottleneck is measurable: the three shelf calls spent **5.587–7.624 s waiting for response headers**, versus **49–75 ms** image preparation and **4–12 ms** retrieval plus decision. There were no retries. The same request made locally afterward took **2.826 s**. Production's non-secret model/effort/size settings matched the local run. We cannot separate provider queue/inference from server-to-provider network time using these timings.

A second, unpromoted deployment tested runtime region `sfo1`, verified by the response header. Its two shelf calls took **7.369 and 8.068 s server total**, with **6.187 and 7.246 s vision**, and slower database reads. It did not improve the measured path, so the main domain remains on `iad1`. Its CLI wall time includes authenticated deployment access and is not comparable to the main-domain client measurements.

Private reports: `data/private/live/scan-performance-2026-09-26T19-30-04-660Z.json`, `data/private/soda-audit/hosted-verification.json`, and `data/private/soda-audit/sfo-comparison.json`. The large avoidable per-scan extraction delay is removed; **a dependable two-second hosted result is not established**.

## Repeat the timing check

### Browser console (enabled on live scans)

Open DevTools → Console, enable **Info**, filter for **Callback**, and start a fresh scan. Each scan has a local numbered `[Callback scan N]` prefix. Logs include capture/request start, response headers, each server stage (including `frame_received`), provider attempt timings, normalized image sizes, a phase timing table, token counts, and final result/error/cancellation duration. `[Callback memory]` reports preparation separately. Enable **Preserve log** to keep output across reloads; reload once after deploying to load the new client bundle.

`browserElapsedMs` starts at capture; `serverElapsedMs` starts inside the server scan pipeline; `serverStageDeltaMs` is the interval between emitted stages, not necessarily a single operation. `requestToHeadersMs` includes upload, authentication, and initial server work rather than measuring pure upload. Vision `responseHeadersMs` includes network and provider waiting. Logs omit raw events, message text, people, images, preview tokens, and credentials. Cached hover revisits do not create a new scan request or new API timing log.

```sh
npm run scan:performance -- --image data/private/soda-audit/original-shelf.jpeg --runs 3
```

Use `--app https://your-deployment.example` to change the target. The command signs in with the local demo credentials, prepares the existing corpus without editing it, and runs **unsaved hover previews**. It sends no messages or payments and never opens/saves previews. Reports in `data/private/live/` include image hashes, model names, source revision, prompt version, candidate IDs/reason codes, token counts, attempt counts, and timing fields; no source text, preview tokens, or credentials.

`imagePreparationMs` measures decode/resize/encode. Provider diagnostics split serialization, response-header wait, body read, parse, and individual attempts. Header wait includes network/upload, provider queue, and computation; it is **not** pure model inference time. Client wall time includes request/auth/upload/transport around the server pipeline. `relationsMs` must be zero and `usage.relations` absent on successful scans.

## Remaining limits

Hosted upload timings do not measure steady-view detection, autofocus, phone uplink, or rendering. Model latency and small-label recognition can still vary. Prepared extraction can omit a relation despite citation validation; the tests cover the reported failure but cannot guarantee every future chat. A wide display inventory is limited to six names, and an unconfirmed variety must remain unconfirmed.
