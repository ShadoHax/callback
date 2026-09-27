# Demo readiness review — September 26

Reviewed from `a542015` (Claude's M1/V3 story and guides), not just the earlier 316-test memory change. Root inspected the code, reproduced failures, and ran final checks; Sol agents handled bounded code and documentation work.

**Decision:** M1 (book → ambition → invitation) and V3 (coffee → stated taste → gift → TEST checkout) are implemented. After the fixes below, prioritize actual-phone acceptance and recording over more features. Passing API checks alone does not establish a smooth camera demo or a welcome human interaction.

## Findings fixed

| Finding | Reproduction / correction |
|---|---|
| A newer “I quit coffee” left an old coffee preference active | Whole-category rejection now closes the older taste. Disliking dark roasts still does not cancel light-roast taste. Unknown chronology stays visible as a caveat. |
| Old dislikes and superseded likes polluted gift ranking | Only surviving likes feed gift options. A strictly newer explicit preference for the same taste retires the old avoid. |
| “Decaf” could produce arbitrary coffee labeled personalized | No options when the catalog has no supported positive trait or cannot verify an avoid; individual zero-match products are excluded. This is still a small catalog with a fixed trait vocabulary. |
| An activity copied from the owner's message could be attributed to a friend | An `inspired` activity must appear in that friend's own cited words. |
| `preference: coffee` passed API validation but quote insertion failed with HTTP 500 | Root reproduced it live. Applied the coffee CHECK-constraint migration through Supabase and added a hosted quote/persistence regression. No order rows or access policies were changed. |
| Current guides contradicted the implemented story | Updated README, setup, submission, demo options, and memory guide; labeled older runs as historical. Narrowed technical claims about model routing, evidence verification, and incremental reuse. |
| Photo evaluation used a larger image size than the live camera | Now uses 1280px/quality86 JPEG limits and explicit provenance. Camera-roll and synthetic images still do not prove live hover performance. |

## Verification boundaries

- Baseline reproduced: 324 tests, lint, TypeScript, build, release check.
- After code fixes: 337 tests across 51 files, lint, TypeScript, and build passed. Release checking also runs after new files are staged.
- Initial production configuration independently checked: Meta muse-spark-1.1 vision, muse-spark-1.3 memory, `all-items-v7`, eight sources and nine extracted relations.
- Existing coffee payment independently checked read-only: saved `paid_test` order for $23.11, Stripe `complete`/`paid`/test-mode, matching amount/currency/order, and `checkout.session.completed` event. No new payment was needed for this audit.
- Post-deployment results are below. All automated messages stayed within demo accounts; no personal SMS was sent.

## Root post-deployment verification

Runtime commit `c6a2016`, deployment `dpl_5WakMft39dBkQ3JApTgkNMyFjGtg`, checked around 13:12 ET:

| Check | Result | Boundary |
|---|---|---|
| Story images | **4/4**: book → inspired, Anna Karenina → recommendation, coffee → taste, bottle → no match | Synthetic rendered images through the same preview API, resized to camera limits; no physical phone |
| Timing | Book **3.120s**, Anna **1.912s**, coffee **4.017s**, bottle **2.507s** | Client API wall time; actual median **2.814s**, n=4. Corrected script's even-sample median display, which previously selected the lower middle value |
| Book preview/save/send/reply | **14/14**; main preview **2.678s**, vision **2.392s**, retrieval/decision **1ms** | Prepared path, no text-model usage; replies scripted. Checked owner isolation, unsaved preview, concurrent-save deduplication, and reopening |
| Commerce | **16/16** | Includes coffee-filter persistence, server quote totals, isolation, idempotency, exclusions, budget, stale-context refusal, cleanup; no new payment |
| Existing coffee payment | Independently verified **$23.11 TEST** | Saved order and Stripe agree; completed webhook present; not a phone checkout run |

The source corpus changed during the audit: five additional synthetic camera messages were added by someone using the demo. Root preserved them. The final hover run reused **13 sources / 13 relations**, rather than the initial eight-source baseline. Do not say that final run was performed on exactly eight messages. Coordinate an intentional reset with the team before recording; do not delete active edits during someone else's rehearsal.

Private reports: `data/private/live/photos-2026-09-26T17-11-49-995Z.json`, `data/private/live/hover-2026-09-26T17-11-56-920Z.json`, and the commerce report from the same run. New preference-lifecycle edge cases were verified by deterministic regression tests; the team's separate writing-cancellation live result is earlier evidence, not a new root-run claim.

The two Supabase reads in scanning are not simply independent: index validity depends on the loaded corpus revision. Raw row prefetch could be explored, but it saves little in the measured trace and is deferred. Starting paid vision before checking current memory would spend calls on invalid hover requests.

## Required before calling the booth demo ready

1. **Five actual two-phone runs:** hover, correct source evidence, save, send, receive, a real typed reply. Record every failure and time from steady camera to rendered card; record one complete successful run.
2. **One phone coffee checkout:** correct preference evidence, $25 all-in budget, dark-roast exclusions, $23.11 best fit, explicit TEST approval, receipt, back/cancel/retry behavior.
3. **Actual props under venue conditions:** readable cover/coffee bag, glare, angle, dim lighting, movement, denied camera/upload fallback, unrelated object, and another title. Label photos before inference and retain misses in the denominator.
4. **Update/reset:** writing cancellation and coffee rejection remove the relevant suggestion; reset restores it. Wait for memory ready before the next scan. Use only labeled synthetic updates.
5. **Connection evidence:** ask 3–5 people whether the reminder feels specific and welcome. Show the person's voluntary reply, not only the recognition card. Do not infer lasting relationship benefit from a staged exchange.
6. **Record and submit:** final video, filled-in write-up, correct inference/payment labels, backup recording, tested login/props, and submission by the team's planned cutoff.

## Defer

- SAM outlines, glasses, Quest, more product categories, and automatic social-message import. These add unverified surfaces to a working demo.
- Native SMS delivery automation. Current sharing hands text to the user's own app; replies and delivery confirmation stay outside Callback. Rehearse the intended external app if using that route.
- Broad product claims: the fixture is fictional, catalog inventory is fictional, and Stripe TEST is not Visa Intelligent Commerce. Confirm the sponsor's eligibility requirements separately.
- Nearby sharing stays disabled. Coordinate visibility expires, but that is not physical database deletion; client-reported GPS is not authenticated venue proof.

The fixed model split is not FrugalGPT's learned cascade. Evidence validation does not prove semantic correctness or exhaustive recall. Prepared memory avoids live chat inference, but still reads and checks stored sources. A mask on an old image is not tracked AR.

## Late teammate merge: phone regression and device privacy

Remote `main` advanced to `86901c6` during this review with the glasses voice flow (`4489bcc`). Merged normally, preserving that work. Root reviewed the incoming server and adapter changes and found additional issues before shipping them:

- Replies now inherit a scan ID, but retry validation still required a null scan ID. Corrected reply idempotency and added a hosted lost-response/retry check.
- Pi event queries could expose the new full-text reply events. Pi tokens now fetch only short `connection` events; glasses reads remain scoped to their exact token.
- Glasses sends lacked the phone path's current-source check and acknowledged insert conflicts without validating the winning send. Added corpus-version verification, full replay validation, and race handling.
- Optional glasses notification failures could fail an already-saved phone reply, and follow-up replies could be routed using the wrong recipient's scan. Notification publication is best-effort, scoped to the recipient's own scan and active glasses device.

Glasses messaging and reply reads are **off by default** behind server-only `GLASSES_MESSAGING_ENABLED=true`. Native state machines and network adapters remain experimental: actual SDK integration, microphone/edit/cancel/confirm, concurrent capture/send behavior, and hardware delivery are not established by the server tests. The new glasses SQL migration is documented but was not applied by this audit; it is unnecessary for the phone demo while this gate is off.

After this merge and hardening, **351 tests across 52 files**, lint, TypeScript, and production build passed. On deployed runtime `6a2a54b`, hosted access/messaging passed **26/26**, including a retry of the same scan-associated reply, edited-key refusal, actual Realtime delivery, follow-up, and fixture cleanup. No model was called. These checks supersede the earlier 337-test count without changing the earlier image timing evidence.

The later teammate commit `4b115b9` adds explicit category-level requests and restores a previous card after a failed scan. Root resolved its decision-rule conflict by retaining both the category-request change and preference lifecycle fixes. The extraction version is now `all-items-v8`, which invalidates old memory and requires preparation again. **354 tests**, lint, and production build passed after this merge. Corrected the failure message so it only promises a previous connection when one actually exists.

## Verified v8 story snapshot

Runtime **`e07a6d4`**, deployment **`dpl_DwL4wecvyqFhjfM3rcbfTKwgHdvT`**, verified around 13:36 ET. This dated story run precedes the polling-only integration recorded below.

- **4/4 synthetic story photos:** War and Peace 2.581s, Anna Karenina 1.646s, coffee 6.953s, bottle 2.939s. Median **2.760s**, n=4. The seven-second coffee tail is real; keep it in the evidence rather than only quoting the faster earlier batch. No physical camera timing is claimed.
- **14/14 book hover/save/send/reply:** 2.822s main preview; vision 2.486s, prepared retrieval 5ms and decision 3ms, no text-model call during the glance. Scripted reply only.
- The v8 rebuild used **10 model calls**, 14,642 input and 8,502 output tokens for **13 sources / 13 relations**. The immediate second preparation and subsequent photo batch reused memory with **zero preparation calls**. This demonstrates moving inference ahead of the glance, not free or instant cold preparation. Wait for Memory ready before the presentation.
- Hosted `/api/device/messages` returned the expected **503 / disabled** response, confirming the default-off glasses gate on production. No hardware migration was applied.
- **26/26 access checks** and **16/16 commerce checks** were run earlier in this same audit on the corrected routes. Those routes were unchanged by the subsequent category/scan-recovery merge. The saved $23.11 TEST payment was independently checked, not repeated.
- Final local total **354 tests / 52 files**, lint, TypeScript via production build, and release check (**209 tracked files**) passed. The last scan-error wording edit passed its four focused UI tests and the hosted production build.

Final private evidence: `data/private/live/hover-2026-09-26T17-35-41-131Z.json` and `data/private/live/photos-2026-09-26T17-35-57-080Z.json`. Source edits made by the team remain intact. The phone acceptance and submission steps above are still outstanding.

## Final polling integration

Teammate `12afecd` stabilized camera callback handling, deduplicated inbox polling, and added one bounded retry for internal model timeouts. Root found a new edge case: an explicit refresh or Realtime event during a pending GET could reuse an older snapshot and leave the new reply unseen until the next poll. The fix queues one fresh GET after that request, coalesces simultaneous refreshes, and prevents queued fetches after unmount. Deferred-response regression tests cover all three cases. A model timeout can now incur a second attempt (up to another 15 seconds for vision); it does not make the glance instantly responsive.

Use one frozen release for phone acceptance. Changes made by another agent or teammate after a verified snapshot require relevant checks again; do not assume these results cover future pushes. The chosen M1/V3 work needs physical acceptance and submission prep, rather than additional feature scope.

Final polling integration verification: **360 tests / 52 files**, lint, TypeScript via production build, and release scan passed. UI race coverage uses controlled deferred responses; physical phone/venue-network acceptance remains required.
