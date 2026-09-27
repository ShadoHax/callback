# Callback

Callback supports object callbacks and source-backed group connections. The optional place/nearby path is **disabled by default** behind `NEXT_PUBLIC_ENABLE_PROXIMITY`; it needs explicit location sharing and physical-device testing before a booth demonstration.

When enabled, proximity requires active sharing from both people and fresh, accurate reported coordinates. GPS data is client-reported, not authenticated proof of a venue. Nearby visibility expires, but expired rows require cleanup for physical deletion. No friend coordinates are returned to the client. Missing presence storage does not block ordinary scans.

**Callback turns things you encounter into specific reasons to reconnect with people you already care about.** Point a phone at something. Callback finds a source-backed reason it matters to someone, such as "War and Peace inspired me to try writing a novel", and shows their original words. You choose to send the photo, and they reply. An optional shopping continuation finds a gift matched to what the friend said they like ("light-roast whole beans", not "dark roasts"), within your budget, with an explicitly approved test checkout.

Built at HackGT 13 for the Meta "Bringing People Closer Together with AI" challenge, with a Visa continuation. Demo context in this repo is **synthetic and labeled**; real stories live only in the gitignored `data/private/`.

**Live app:** [callback-khaki-phi.vercel.app](https://callback-khaki-phi.vercel.app). Sign in with a provisioned demo account.

**Team handoff:** [progress since the initial clone](docs/PROGRESS.md) · [completed work and next steps](docs/NEXT_STEPS.md) · [soda scan fix and current measurements](docs/SODA_SCAN_FIX.md) · [demo and presentation notes](docs/PRESENTATION_NOTES.md) · [11 low-prop demo options](docs/DEMO_IDEAS.md) · [prepared-memory architecture](docs/PREPARED_MEMORY.md).

**Earlier verification (September 26, before the M1/V3 story and vision-model split).** Five consecutive hosted scan → send → reply loops passed, including ownership-update, stale-scan, reset, and no-match checks (**51/51**); a separate cancellation/reset run passed **14/14**. Hero scans measured **6.4s median / 7.9s p95 (n=5)** on Meta muse-spark-1.3 vision. These used one manufacturer image and synthetic chats with scripted replies; they are integration checks, not physical-phone results or an accuracy benchmark.

**Earlier M1/V3 verification (September 26).** The hosted Meta build found Maya from a rendered *War and Peace* cover, Sam from *Anna Karenina*, Maya's taste from coffee, and no connection from a bottle (**4/4 photo check**). Book and coffee hover checks passed **15/15 each**; shopping passed **14/14**, and access/messaging passed **24/24** with scripted replies. A **$23.11 coffee gift Stripe TEST payment** was checked against the paid session, saved order, and webhook record. The 324-test offline baseline, lint, types, and production build passed before the final review. These are synthetic-image and scripted-message checks. Physical two-phone runs, a human reply, and phone checkout remain to be verified. See [verification history](docs/PROGRESS.md) and [current next steps](docs/NEXT_STEPS.md).

**Earlier final review and corrections:** newer coffee rejection and changed tastes updated the recommendation, unsupported catalog tastes abstained, and coffee-filter quotes passed the database constraint. Root verified **360 tests** after integrating the teammate category-recall and guarded glasses changes, the production build, **4/4** synthetic story images, **14/14** book preview/save/message checks, and **16/16** commerce checks. Those image API times were **1.6–7.0s**, not measured phone times. See [READINESS_REVIEW.md](docs/READINESS_REVIEW.md) for that review's findings and limits.

**Earlier Meta hover measurement (before M1/V3).** Automatic scanner preparation was verified in a **16/16** hosted run using 10 sources/10 relations. The main manufacturer-image preview took **10.053s**, including **9.166s vision** versus **5ms retrieval + decision**; the unrelated image took **4.955s** and returned no match. This measured muse-spark-1.3 vision, not the current muse-spark-1.2 path or phone-camera timing. See [measurements and limits](docs/HOVER.md).

**Current deployed soda fix (September 26, source `2ae24c0`).** Meta muse-spark-1.2 handles vision and muse-spark-1.3 prepares `all-items-v9` memory. The original shelf photo produced three hosted unsaved previews in **6.473 / 7.605 / 7.980 s**; all had `relationsMs: 0`. Agarwal's named Diet Coke preference remained a `needs_exact` candidate, while Alan's zero-sugar-soda taste surfaced only as a **related** reminder. A manual scan took **6.823 s** with no text extraction; four existing demo controls returned their expected person and relation. Cold preparation of 18 sources took **28.56 s** and one model call, separate from those warm scan times. **398 tests**, lint, types, build, and release check passed. These are hosted upload checks, not phone hover latency or a two-second promise; see [the targeted audit](docs/SODA_SCAN_FIX.md). Nearby sharing is off by default. GitHub pushes do not automatically deploy this project.

**Selected demo:** *War and Peace* → Maya's writing ambition → gentle follow-up → real reply (M1); then coffee → Maya's stated taste → buyer-chosen coffee gift → approved Stripe TEST checkout (V3). These paths and the eight-message synthetic story are implemented. A book-to-pen gift is a separate, unbuilt proposal. Rehearse and record the current story from [PHONE_PRACTICE.md](docs/PHONE_PRACTICE.md).

## How it works

- **Scanner (`/`).** Start hover, hold the camera steady, then tap a confirmed person chip to save and open the connection. The view remains live; moving away hides the chip and returning reuses a cached preview. Manual capture, native camera, and photo upload remain available. The provider input is auto-oriented, resized to at most 1024 px on its longest edge, and encoded as JPEG quality 82 without source metadata; the original upload remains available for saving. See [hover behavior and phone rehearsal](docs/HOVER.md).
- **Prepared memory and one-call recognition** (`src/lib/knowledge-index.ts`, `src/lib/model.ts`; Meta muse-spark-1.2 vision and muse-spark-1.3 memory on the current deployed build):
  Opening the authenticated scanner starts preparation automatically; demo edits/reset refresh it. The warm path reads approved relationship memory instead of re-extracting messages per frame. See [implementation and limits](docs/PREPARED_MEMORY.md).
  1. **Vision** sees only the image, so context can't bias what it thinks it sees. It returns the item, category, specificity (`exact_title` / `product_family` / `category`), visible text, and up to six product names confirmed by readable labels. A mixed shelf stays a category image; unseen diet or zero-sugar variants are not inferred.
  2. **Relationship preparation** is text only and runs ahead of every scan, once for the current context/provider/version. It labels each relevant message with a typed relation (`wanted`, `asked_to_find`, `planned_together`, `recommended`, `gifted`, `experienced_together`, `owns`, `dislikes`, `cancelled`, `purchased_as_gift`, `inspired`, `prefers`), whose it is, the verbatim words used for the item, and the speaker's own sentiment. `inspired` can carry the person's verbatim ambition; `prefers` can be an exact named product or a category taste.
  Every capture path requires current prepared memory. If it is missing or stale, the app asks to refresh it before scanning; no scan-time relationship-extraction fallback runs.
- **Code decides** (`src/lib/decision.ts`):
  - cited messages must exist and be the person's own words;
  - the item named in the message must be verified verbatim in the source, and a different model or edition is ruled out;
  - the photo must be at least as specific as the evidence;
  - third-party wishes and generic interests never surface.

  A newer message ends an intention only when all of these hold: same person, same item, a relevant intent, and a strictly later known date. Owning a game ends a wish for it but not a plan to play together; "let's skip it" ends the plan. Anything uncertain is shown as a caveat with its source rather than silently applied. Every skipped person gets a "Ruled out X: why" line with the messages behind it.
- **Personal messaging.** The individual composer can hand your edited text to the native share sheet without requiring a recipient Callback account. Addressed native SMS checks an owner-scoped phone mapping and current scan context, then opens the user's texting app. Replies stay in that app; Callback never sends the text itself or confirms native SMS delivery. See [setup and phone checks](docs/PERSONAL_MESSAGING.md).
- **Send and reply.**
  - The draft is built from the relation and the friend's own name for the item, and is fully editable.
  - Quoting their words is opt-in and authorized by the server.
  - Each send is one immutable payload and idempotency key: a lost response offers a retry of that exact message, and a reused key with different content is refused.
  - The recipient's inbox (`/inbox`) uses Supabase Realtime, with polling as a fallback, plus a chime and vibration. The reply appears on the scanner, where you can answer it and keep the exchange going. Reopening a recent scan restores its connection and advice threads.
- **Shopping continuation** (`COMMERCE_ENABLED=true`, collapsed under the reconnect flow):
  - *Ask someone who knows it.* Up to two people who own, tried, or recommended the item. Ownership isn't praise; favorable notes need their own words, and a dislike is a caution. Asking a contact uses the same authorized message path, with the recipient derived server-side, and stays "advice pending" until a real reply.
  - *Options.* Opening shopping loads up to three items from one labeled demo merchant, for a purpose the scan supports (for me, a gift for their stated wish or taste, or to use together for an open plan). The V3 gift is marked as a related coffee item chosen by the buyer, not a request from Maya. Code enforces stock and the full budget with shipping and tax, ranks stated taste traits, excludes recognized avoid traits, and explains tradeoffs.
  - *Checkout.*
    - The server holds the quote, and approval re-validates context, price, stock, currency, and budget; a changed quote needs fresh approval. Filters stay attached to the quote, and changing a selection clears the old review.
    - Payment runs on Stripe-hosted Checkout in **test mode**; live keys are refused.
    - An order is "paid" only after the server retrieves the session from Stripe (complete, paid, matching amount). Signed webhooks are deduplicated.
    - The receipt is labeled TEST. This is a Stripe integration, not Visa Intelligent Commerce.
- **Privacy.** Hover frames go to the selected model provider, but Callback saves no scan/photo until you tap the preview. Manual scans are saved directly. Context is explicitly imported; the prototype does not automatically read social or messaging accounts. Private tables have row-level policies, photos sit in a private bucket, and all writes happen server-side. Quotes come only from stored originals, and the model never writes them. A context change makes older scans stale for sending and shopping.
- **Devices.** Scan-only device tokens and bridges for Quest and glasses exist ([adapters](adapters/README.md)), but are not part of the demo.

Supabase and Vercel are configured. Scanner, recipient, and optional advisor accounts are ready with the base synthetic story and approved teammate test messages. Keep those test messages when rehearsing or resetting. Only scanner and recipient are needed for the chosen presentation. On the setup machine, login details are in the ignored `data/private/DEMO_ACCESS.md`. See [SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md), [DEPLOYMENT.md](docs/DEPLOYMENT.md), and the short [remaining plan](docs/NEXT_STEPS.md).

## Setup (in this order)

| # | Step | Needs model? |
|---|---|---|
| 1 | `npm install`; create a Supabase project and run `supabase/schema.sql` in its SQL editor (idempotent; rerun after pulls) | no |
| 2 | `cp .env.example .env.local`; fill in the Supabase URL, publishable key, service-role key, and the demo account emails/passwords | no |
| 3 | `npm run demo:setup`: creates the accounts, imports the labeled synthetic stories, maps contacts, prints `DEMO_OWNER_ID` | no |
| 4 | Set `DEMO_MODE=true`, `DEMO_OWNER_ID=…`, and optionally `COMMERCE_ENABLED=true`, `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_WEBHOOK_SECRET` | no |
| 5 | `npm run dev` (or deploy to Vercel with the same variables; the live camera needs HTTPS) | no |
| 6 | `npm run smoke`: exit 0 means ready, 2 means the database is ready and the model is pending, 1 means something is broken; with a provider key it makes a paid text call | if configured |
| 7 | `npm run access:check`: real sessions, row-level policies, photo access, send → reply, with no inference | no |
| 8 | Select `MODEL_PROVIDER` and its matching key (`OPENAI_API_KEY` or Meta's `MODEL_API_KEY`); run `npm run smoke -- photo.jpg`, then `npm run live:check …` (see the runbook) | yes |

Temporary OpenAI setup: `MODEL_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL=gpt-5.4-mini`. OpenAI completions are capped at 6,000 tokens per call. Meta uses `MODEL_PROVIDER=meta` and its separate `MODEL_API_KEY`. Each scan stores its provider/model and reported token usage; the scanner shows the actual provider. Switching providers requires a redeploy and new live checks.

Between judges: `npm run demo:reset` (or Demo controls → Reset) removes only this owner's synthetic session updates. For approved real stories: `npm run demo:setup -- data/private/stories.json`.

## Verify

| Command | What it establishes |
|---|---|
| `npm test` | Offline tests for decisions, authorization, commerce, hover, and preview saving |
| `npm run smoke [-- photo.jpg]` | env, tables and columns, private bucket, demo users, context; model and Stripe readiness reported separately |
| `npm run access:check [-- --app https://your-app]` | both real sessions through the app's cookies; policy isolation; private/shared photo access; authenticated Realtime delivery; send → reply → follow-up; retries and key-reuse behavior. Uses a labeled developer-fixture scan and deletes it |
| `npm run commerce:check [-- --app https://your-app]` | real advice delivery, quotes, filters, server totals, idempotency, order isolation, and stale-context rejection. Requires the synthetic book + coffee story; cleans up its fixture. Never creates a checkout session or payment |
| `npm run hover:check -- --hero … --hero-source … [--nomatch … --nomatch-source …] [--shop] [--app …]` | bounded real-memory/preview/save/reply check; manufacturer images and scripted replies, not a camera benchmark |
| `npm run vision:latency -- data/private/vision-cases.json` | paired Meta `low`/`minimal` vision calls with labeled titles; records accuracy, latency, and tokens, with no database writes or messages |
| `npm run scan:performance -- --image data/private/soda-audit/original-shelf.jpeg --runs 3 [--app https://your-app]` | prepares the existing corpus, then measures unsaved hosted previews and detailed image/provider timing; sends no messages or payments |
| `npm run live:check -- --hero … --person … --relation … --update-text … --expect-update preserved\|closed --runs 5 --app …` | real model scans in full loops; a run counts only if every assertion passes; reports complete runs and the longest streak separately, plus scan p50/p95; replies are scripted transport checks |
| `npm run eval -- data/private/eval/cases.json` | held-out photos with pre-written labels: status, person precision and coverage, relation, evidence, unsupported claims, no-match vs clarification, errors, latency. Compared against a single-call baseline with the same task and a caption+search reference |
| `npm run photos:check [-- --cases data/private/phone-photos/cases.json]` | explicit expected status/person/relation for every photo; validates labels/files before model calls; previews only, no messages |
| `npm run release:check` | no secrets, private files, or unlabeled fixtures tracked (run before making the repo public) |

The offline tests cover:
- decision rules, including three supersession regressions and the demo story run through the rules with hand-labeled relations;
- advice contacts and their authorization;
- idempotent sends, restored conversations, follow-up replies, and stream parsing/cancellation;
- UI checks for delayed options/quotes, changed filters, and immutable reply retries;
- catalog grounding, budgets, and changed totals;
- duplicate, cancelled, expired, and mismatched payments;
- webhook signature verification;
- eval scoring and demo import/reset scoping.

`supabase/schema.sql` was run twice in a row on Postgres (PGlite, with stubbed Supabase `auth`/`storage`). Constraint checks rejected mismatched order totals, invalid statuses, duplicate quote requests, and duplicate payment events.

## Known limits

- Conversation recovery uses the latest 100 inbox messages; older history needs pagination before broader use.
- Prepared memory, sending, and shopping support up to 1,000 source messages; a missing or stale index blocks every scan until refreshed. Public product images have passed integration checks; unseen real-world camera photos have not been benchmarked.
- Item identity is checked from verified words, not a product database. Differently worded names can come out as "unknown" and appear as caveats. The extractor is trusted to skip unrelated items and label relations; the original evidence is always shown.
- Code writes the explanation from typed relations and chooses the person; all quotes come from stored originals.
- Shopping explanations are rule-based from typed evidence and catalog facts; no extra model call is used there.
- The catalog, prices, stock, shipping, and tax are demo fixtures for one labeled test merchant.
- Demo-editor updates are synthetic by design; never present them as a real message.

See [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) (setup, reset, demo sequences, results), [docs/SUBMISSION.md](docs/SUBMISSION.md) (write-ups, claims to avoid, release checklist), and [docs/FEEDBACK.md](docs/FEEDBACK.md) (user feedback protocol).
