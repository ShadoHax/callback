# Callback: progress since the initial clone

Updated September 26, 2026. Git's clone record starts at `53c59ac` on September 25. There are 24 implementation/documentation commits between that baseline and `475dd59`. The first 21 were already on `feature/live-pipeline`; the last three completed our conversation fixes, cloud verification, and OpenAI rehearsal work.

The initial repository already contained the phone upload/capture prototype, Supabase auth and schema, a single model call, evidence review, explicit send/reply, and device bridge scaffolding. The work below extends that foundation.

## Latest: prepared-memory review and speed measurements

On September 26, the root agent reviewed the prepared index and implemented automatic preparation when the authenticated scanner opens, queued refresh after an edit during preparation, one batched contact lookup, and stage-level scan timings. Sol agents implemented bounded UI/pipeline subtasks; the root agent inspected both changes, corrected timing terminology, and performed final verification. The persistent index and one-call warm recognition path already existed; this pass did not invent a new index or add a vector model.

Code `139136f` is deployed at `dpl_2UEyM4x1E3AZukoaWEhM84uKv2XX`. **316 tests in 48 files**, lint, TypeScript, build, and release check passed. The root's post-deployment hover run passed **16/16**. Both preparations reused 10 sources/10 relations with zero model calls. The main preview took **10.053s** client time, with **9.166s vision**, **3ms retrieval**, and **2ms decision**; the unrelated image returned no match in **4.955s**. Preview storage, concurrent save, private-memory isolation, scripted messaging, and shopping options all passed. These are manufacturer-image API checks, not physical-phone performance.

A new `vision:latency` harness compared Meta vision `low` and `minimal` over eight alternating paired calls (two images, two repeats). Both were 4/4 correct; medians were 5.418s and 4.056s respectively, while the `minimal` maximum was worse. Vision now pilots `minimal`; memory remains `low`. The slower subsequent hosted main image means no reliable speedup or one-to-two-second claim is justified. The measured bottleneck is remote vision, not relationship recall. Architecture, exact implementation boundaries, reproduction instructions, and the FAIR/RAG research connection are in [PREPARED_MEMORY.md](PREPARED_MEMORY.md). DINOv3/Faiss and the book/aspiration/related-gift feature are not implemented.

The sections below retain earlier implementation and verification history; their older provider/status notes are historical.

## What changed

1. **Split inference into two stages.** Vision identifies only the image; a separate call extracts typed relationships from messages. Deterministic code chooses whom to contact, verifies cited words and item specificity, and rejects unsupported matches. Ownership can close a purchase wish while preserving an independent plan to play together; cancellation closes the plan.
2. **Made the phone flow usable.** Added a live camera, compact image preview during scanning, streamed progress with actual elapsed times, an evidence drawer, readable reasons for excluded people, editable messages, and optional sharing of the recipient's original words. The inbox supports the photo, quote/date, reply, chime, and vibration.
3. **Hardened conversation handling.** Sends use an immutable payload and idempotency key. Restoring a scan recovers its existing conversation and separate advice threads; follow-up replies stay in the thread. Late responses cannot overwrite newer state. Realtime waits for authentication and the database subscription before showing Live, with polling as fallback.
4. **Built the shared-plan story.** Maya's synthetic “We should try Wingspan together sometime” is the hero connection. Noah's favorable ownership is useful advice, Priya's dislike is a caution, and a third-party wish or generic interest is insufficient. The product ends with a person replying and agreeing on a next step.
5. **Added the Visa continuation.** The same scan supports asking an experienced friend, comparing an eight-product demo catalog, selecting a supported purpose and budget, filtering variants, and reviewing a server-calculated quote. Filters survive quoting, stale responses are discarded, and approval rechecks current context. Stripe TEST checkout, signed webhook handling, and verified receipts are implemented; payment remains unverified without credentials.
6. **Provisioned the live backend.** Created/configured Supabase tables, row-level policies, private image storage, and Realtime. Provisioned Alex, Maya, and Noah as separate demo accounts, imported ten labeled synthetic messages, and mapped the contacts. Credentials and private records stay outside Git.
7. **Deployed HTTPS.** Created the free Vercel Hobby account/project and deployed [Callback](https://callback-khaki-phi.vercel.app). Production environment settings are configured. Deployment is via CLI; GitHub automatic deployment is not connected to the repository.
8. **Unblocked inference while Meta credits are pending.** Added an explicit OpenAI route using GPT-5.4 mini, a separate server-side key, a fixed endpoint, and a 6,000-token completion cap per call. The UI identifies the provider, and saved scans record provider/model and reported usage. Meta remains supported and must be retested after switching.
9. **Added verification and handoff tooling.** Setup/reset scripts, model-free access and commerce checks, full live scan loops, and a held-out evaluation harness with two baselines are available. Reports distinguish scripted API tests from physical phones, count every required assertion, record image provenance, and avoid fabricated results. Added deployment, setup, submission, feedback, and next-step guides. The Pi relation-name compatibility patch is preserved; hardware is still outside the verified demo.

## What has actually passed

| Verification | Recorded result | What it establishes |
|---|---|---|
| Offline suite | 153 tests; lint, TypeScript, production build passed at `475dd59` | Implemented behavior and regressions |
| Access/messaging | 24/24 locally and hosted | Auth, row-level isolation, photo sharing, actual Realtime delivery, retries, replies |
| Shopping/advice | 17/17 locally and hosted | Routes and quote rules using labeled developer fixtures; no payment |
| OpenAI smoke | Text extraction and Wingspan image passed | Real provider authentication, structured output, image input |
| Hosted OpenAI loops | 5/5 consecutive loops; 51/51 checks | Actual inference → send → scripted reply, ownership update, stale scan, reset, no match |
| Hosted cancellation | 14/14 checks | Cancelled plan disappears; reset restores it |
| Shopping from a real scan | 7/7 checks | Actual model evidence → Noah's advice thread → suitable options → server quote |

The five hosted hero scans measured **7.0s median and 7.5s p95 (n=5)**. Tests used public manufacturer product images and labeled synthetic chats. Repeating one image is an integration check, not a held-out accuracy result or evidence of lasting human connection. API replies were scripted. About **$0.07** of OpenAI usage was estimated from 26 calls; this was not a retrieved billing balance. Detailed provenance and measurements are in [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md).

## Latest implementation commits

- `d05521d`: restore scan/advice conversations; preserve filters and quote consistency; reject stale checkout context.
- `6c531af`: verify hosted messaging and commerce; fix authenticated Realtime readiness; document Supabase and deployment.
- `475dd59`: add isolated OpenAI credentials, provider labeling, usage provenance, and live rehearsal checks.

The handoff branch is `codex/phone-demo-handoff`, based on this complete feature history. It does not merge separate changes from `main` or overwrite the existing feature branch. A fresh fetch found separate device/beacon work and `786d4ae` (context selection and explanation verification) on `main`; review and reconcile those before a later merge. The verification numbers above apply to this branch's tested implementation.

## What remains

Follow [NEXT_STEPS.md](NEXT_STEPS.md) and the step-by-step [PHONE_PRACTICE.md](PHONE_PRACTICE.md): physical phones and a human reply, phone photos (`npm run photos:check`), Meta retesting once credits arrive, then recording and submission by Sunday 6:00 a.m. (hard deadline 8:00 a.m.). A Stripe TEST payment has been verified end to end (September 26). No Meta model run, physical two-phone run, phone-photo result, or glasses/Quest demo has been verified yet.


## Hover implementation — September 26

Reconciled the teammate/main changes through `842ba36`, then created `codex/hover-connections`. Added owner-private prepared memory, one-call warm hover recognition, steady-view capture with pause/session limits and cached revisits, unsaved previews, and signed tap-to-save receipts. Concurrent saves retain one photo. Connection drafts now invite a concrete next step, and shopping options load on expansion with item-specific friend-advice drafts.

Validation: 197 automated tests across 33 files, lint, TypeScript, and production build pass. Live localhost hover acceptance passed 16/16: prepared-memory reuse, cross-owner RLS, two one-call vision results, no photo/scan before selection, concurrent save/reopen, a scripted invitation/reply, and three shopping options without a quote. Manufacturer Wingspan image → Maya's open plan took 3.162s; Scythe → no match took 3.703s. Neither number includes physical phone capture or proves human connection.

The first live test caught a relayed third-party wish incorrectly represented as the speaker's own request. The v2 prompt and deterministic ambiguity guard corrected it; edition/publisher regression tests were also added. One preparation attempt returned 503 and did not produce an index; a diagnostic retry succeeded. Preparation now exposes safe failure codes. Latest successful cold preparation used one call (1,607 input / 1,412 output tokens), followed by cached preparations with zero calls. The two successful localhost vision calls reported 3,722 input / 261 output tokens. Failed/earlier attempts may have additional unreported usage.

Applied the new `context_indexes` migration through the Supabase SQL editor. The row has RLS and server-only writes. Provider or context changes invalidate it. The 45-line [next-steps plan](NEXT_STEPS.md), [hover guide](HOVER.md), and submission/deployment docs describe the new behavior and remaining physical-phone, Meta, and checkout work.

Hosted hover acceptance also passed 16/16 on Vercel (`dpl_AKWmWVgT4EUby6SVfnGQoKRcpNJA`): Wingspan → Maya in 2.985s; Scythe → no match in 3.026s; two vision calls with 3,722 input / 237 output tokens. Memory preparation reused the index with zero calls. Browser inspection confirmed the updated initial layout at 390×844; actual camera permission/capture was not exercised. Synthetic-frame UI tests cover hover activation, motion, revisits, and saving. A final layout adjustment preserves the heading during hover so the viewfinder does not jump on recognition.

## Claude fixes and independent pre-merge review — September 26

Reviewed Claude's five commits from `8c2ccf3` through `1bce397`: structured visual titles, shared 1,000-source limits, per-relation validation, thread memory reuse, participant and specificity checks, and separate/derived preview-signing keys. Independently reran the 230-test baseline, lint, TypeScript, and production build successfully. Claude's hosted reruns are recorded in [HOVER.md](HOVER.md); no new live model run was performed in this review.

The review found and corrected additional failures:

- Dropping a malformed newer cancellation/ownership update could preserve an obsolete plan or wish. Retry the complete extraction batch once, count it against the 60-batch budget, and refuse to publish partial memory after a second failure. Version v5 invalidates older caches; damaged saved relations also force re-extraction.
- Broad description/subtitle cleanup could turn “Wingspan Asia” or “Ticket to Ride: Rails and Sails” into the base product. Explicit titles now govern the index and final decision, meaningful editions remain distinct, and mislabeled family evidence cannot bypass that check. Ordinary printing metadata is handled separately.
- “My wife and I play Wingspan together” could be presented as the user's shared memory. Bare household “together,” “us,” and “remember” no longer establish participation.

Final source validation: **258 tests across 36 files**, ESLint, TypeScript via the production build, and the Next.js production build pass. New tests reproduce unsafe cancellation/ownership loss, corrupted-cache reuse, retry budget exhaustion, distinct titles/editions, and household participation. An old prompt-wording assertion was removed; the test still verifies the required title/edition schema, image payload, provider endpoint, and absence of private context in vision.

Created [PRESENTATION_NOTES.md](PRESENTATION_NOTES.md) before merging, with a three-person Meta demo, Visa continuation, practical fallbacks, and the proposed book → writing invitation → optional pen story. Updated the runbook's old shutter flow, 40-message guidance, assumed advice sentiment, and unverified checkout claims. The book/aspiration/gift and spatial XR flows remain proposals.

Remaining limits: threads producing no relations are re-extracted after another context change; participant detection is an English heuristic; models can omit evidence even when all returned entries validate. Final-source live inference and physical phones still need verification. This task merges source to GitHub only; the Vercel deployment remains Claude's prior build until a separate deployment and memory rebuild.


## Stripe review and simpler book rehearsal — September 26

Independently checked Stripe TEST and Supabase read-only: a completed, paid $75.54 USD session matches the paid order, paid timestamp, and completed webhook event; an expired/unpaid session matches its expired order and expired webhook event. Hosted commerce configuration returns `stripe_test`. No new Checkout Session or payment was created in this review. Another-account receipt access was covered by prior work, not repeated here. A sanitized record is in ignored `data/private/live/stripe-review-2026-09-26.json`.

Fixed payment retries to reconcile Stripe before reusing a checkout link; complete/unpaid sessions now show processing rather than redirecting. Failure webhooks re-read provider state, verified paid orders remain paid, and a later verified payment can correct an earlier failure. Catalog identity now honors the explicit visual title/edition instead of unrelated secondary text. Shared-plan shopping copy no longer assumes every activity is a game.

Rewrote the phone guide, presentation notes, runbook, and next steps around two participants and the selected book → writing invitation → optional pen story. The existing named contacts remain developer regression data, not presentation requirements. The book/aspiration bridge, related-gift recommendations, and new demo context/catalog still need implementation; this review did not pretend the documentation change made them work.

Generalized `photos:check`: every input must have an explicit expected status/person/relation in a cases manifest. Unknown filenames are no longer silently treated as negative examples; clarification cases are supported, labels and files are checked before paid preparation, and reports include exact expectations and HTTP failures.

Validation: **272 tests across 38 files**, lint, TypeScript through the production build, and production build passed. These review changes are local and have not been deployed.

## Low-prop demo options and Meta access — September 26

Added [11 demo ideas](DEMO_IDEAS.md): six connection-first stories and five personalized commerce paths, each with props, required implementation, and positive/negative proof cases. Recommended pair: War and Peace → gentle novel follow-up; optional pen gift grounded in ink preferences and shopper budget. The existing same-book recommendation relation is the simpler social fallback. Activity links, related gifts, and stationery catalogs remain proposed.

Stored the supplied Meta credential only in ignored local configuration. Two bounded application calls against muse-spark-1.3 passed: structured relation extraction (5,849 ms, 1,213 input / 889 output tokens) and vision on the existing Wingspan manufacturer image (7,527 ms, 1,997 input / 781 output tokens). An initial authentication probe also returned HTTP 200 but exhausted its small output cap without a useful answer. These are access/adapter checks, not a benchmark or verification of the book story. No database writes, messages, payments, or deployments occurred. The private report is data/private/live/meta-access-2026-09-26.json.

Local configuration now selects Meta; OpenAI credentials remain available as a fallback. Hosted configuration remains OpenAI. Next: rebuild prepared memory and test the full Meta loop before deploying it. This turn changed documentation and private configuration only; the prior 272-test source verification remains the latest code check.

## Meta cutover, integration, and final checks — September 26

Committed the 11 low-prop demo ideas and all preceding commerce/photo-check work, then merged the latest origin/main (cce54d2), including group/location code and synthetic booth cases. Reviewed and fixed duplicate group members and partial group-send retries. Nearby sharing is disabled by default behind NEXT_PUBLIC_ENABLE_PROXIMITY; explicit opt-in is required when enabled, and failed/missing presence storage no longer breaks ordinary scans. The presence table exists, but enabling nearby discovery still needs device tests and a retention cleanup policy. Client coordinates are reported, not authenticated proof of place.

Meta muse-spark-1.3 is configured locally and in Vercel Production/Preview. The API key is in ignored local configuration and Vercel sensitive environment variables, never Git. There is no automatic fallback to OpenAI. Both providers now honor the completion cap; the release checker detects Meta/OpenAI token patterns. Exact-value checks found none of the configured private credentials in tracked files.

Production deployment dpl_6hZUHgpeSpnJEkHKptjLjxR1qxHp (application source 324e1d8) is live at https://callback-khaki-phi.vercel.app. Its model endpoint and real scan results report meta/muse-spark-1.3. Verification:

- 297 tests / 43 files, ESLint, TypeScript, and production build passed.
- Local database/auth and real Meta text/vision smoke passed.
- Hosted hover 16/16; a fresh Meta memory build and zero-call reuse both passed.
- Hosted access/messaging 24/24 including authenticated Realtime; shopping/advice 16/16. The configured-payment run omits the unconfigured-payment assertion included in some historical counts.
- Five consecutive hosted Meta scan/send/scripted-reply loops: 51/51 checks, including ownership update, stale scan rejection, reset, and unrelated item. Median 6.4s / p95 7.9s (n=5). Nine reported calls: 18,613 input / 7,529 output tokens; no provider billing total retrieved.
- Separate Meta cancellation/reset run: 14/14 checks; cancellation removed the match and reset restored it. Four reported calls: 8,002 input / 3,636 output tokens.
- Stripe read-only recheck: existing complete/paid and expired/unpaid TEST sessions still match saved orders, totals, and webhook events. No new payment was submitted.
- The access-check CLI now disconnects Realtime after cleanup; a fresh 24/24 rerun exits promptly.

The tests use labeled synthetic conversations, manufacturer images, and scripted replies. They do not establish phone-camera smoothness, human connection outcomes, or book/aspiration/related-gift functionality. The latter remains the next implementation phase in NEXT_STEPS.md.

## Personal messaging branch review — September 26

Integrated teammate branch origin/codex/personal-messaging through 6d40da7 and resolved the environment-template conflict while retaining Meta and default-off proximity settings. Native sharing passes edited text to the user's chosen app (no recipient Callback account required). Addressed SMS composition uses an owner-scoped consented number mapping, verifies current scan/context/contact, and offers a fresh explicit Messages link after authorization. iPhone clipboard denial leaves a manual-copy fallback; editing the draft clears the prepared link. External replies remain in the external app.

Removed the server SMS path before all provider/database work: the incoming implementation could share wrong numbers across owners, expose failed SMS rows as inbox messages, and misreport or duplicate uncertain sends. No SMS migration or provider credentials are needed for native sharing; addressed SMS still needs a private phone map and linked contact. No real SMS/social messages were sent in this review.

Validation covers the full offline suite, lint, TypeScript/build, plus owner isolation, stale/remapped contacts, malformed configuration, unavailable server delivery, and iPhone clipboard denial. Real phone share targets, native Messages behavior, and external replies still need the two-phone rehearsal in PERSONAL_MESSAGING.md. Remaining product work is the book/ambition bridge, preference-backed related gift discovery/catalog, human feedback, and the final recording/submission.

Personal messaging verification: **313 tests across 48 files**, lint, TypeScript, and local/hosted production builds pass. Application commit 764ba8e is deployed as dpl_8MeDCvp7DE7ogwUYC4hFaqkAhz9U. Hosted checks confirmed that missing owner phone configuration returns 409, another account cannot access the scan phone mapping (403), and the active model provider remains Meta. No external messages were sent. The deployed personal-app chooser needs no credentials; addressed SMS is not yet configured with team numbers.
