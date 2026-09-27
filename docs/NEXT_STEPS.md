# Callback: done and next
Updated September 26, 2026. Meta primary; Visa secondary. Submit by Sunday 6 a.m.; team's confirmed cutoff is 8 a.m.
App: https://callback-khaki-phi.vercel.app

The latest soda and latency fixes are deployed and measured in [SODA_SCAN_FIX.md](SODA_SCAN_FIX.md): the actual shelf photo now takes **6.5–8.0 s** over three hosted runs, with **zero scan-time text extraction**. Both people’s evidence is retained. Current checks: **398 tests**, lint, types, build, and secrets check pass. Earlier results below remain historical.

## Chosen demo (built and live)
**Meta (M1):** *War and Peace* → Maya said it inspired her to try writing a novel → gentle follow-up → real reply. **Visa (V3):** coffee → Maya likes light-roast whole beans, not dark roasts → a gift matching those stated tastes → approved Stripe TEST payment.
Step-by-step for the team: **[PHONE_PRACTICE.md](PHONE_PRACTICE.md)** · Script: [PRESENTATION_NOTES.md](PRESENTATION_NOTES.md) · AI story and numbers: [AI_TECHNICAL_STORY.md](AI_TECHNICAL_STORY.md)

## Earlier verified results (September 26, live site with synthetic images and scripted replies)
- Camera glance on Meta **muse-spark-1.1**, memory on **muse-spark-1.3**. An earlier root-run set of synthetic images took **1.6–7.0s** end to end (n=4); see [readiness review](READINESS_REVIEW.md) and [model comparison](AI_TECHNICAL_STORY.md).
- New story loaded (8 fictional, labeled messages). Meta built the memory correctly in 3/3 local builds and on the live site: Maya's ambition in her words ("try writing a novel"), her taste ("light-roast whole beans") and avoid ("dark roasts"), Priya's dislikes, Jordan relaying his sister's wish, Sam recommending *Anna Karenina*, and Leo's general interest.
- Earlier team live checks (see root's later run below):
  - Book → Maya in 1.6 s; *Anna Karenina* → Sam; coffee → Maya's taste; water bottle → no one (4/4 photo check).
  - Hover 15/15 (book) and 15/15 (coffee with shopping); shopping 14/14; logins/messaging 24/24.
  - "I stopped writing it" → no one, then reset → Maya again; memory restored byte-for-byte.
- V3 end to end: coffee options ranked by Maya's words, dark roasts excluded in her words, over-budget excluded; a **$23.11 Stripe TEST payment** completed, the webhook marked it paid, and the receipt is verified with Stripe.
- Root review fixed stale coffee preferences, outdated avoids, unsupported taste claims, ambition attribution, and a live coffee-filter quote failure. Post-deploy images **4/4**, book hover **14/14**, commerce **16/16**, access/messaging **26/26**. The later glasses merge exposed reply-retry and device-event privacy regressions, now fixed; **360 tests**, lint, types, and build pass. Glasses voice messaging stays disabled pending separate migration/native/hardware validation. [Full evidence](READINESS_REVIEW.md).
- Earlier foundation: prepared memory, steady-view hover, evidence review, explicit send/reply, private auth/storage, Stripe TEST checkout and webhook, and personal SMS compose.

## Current deployed fixes

- All manual, hover, and device scans now require current prepared memory. The scan no longer starts a text extraction when memory is absent. The extraction prompt is `all-items-v9`; refreshing memory rebuilds named-product and category-taste evidence under that version.
- Mixed displays are identified as a category with up to six directly confirmed `visibleItems`. Named preferences require the named product to be visibly confirmed. A category or attribute preference is shown as a **related** reminder, without claiming that the preferred variety is in the photo.
- The vision request is prepared as a metadata-free JPEG with a 1024-pixel maximum edge and quality 82. The configured split is Meta **muse-spark-1.2** for vision and **muse-spark-1.3** for memory; vision uses `minimal` effort and a 1,536-token cap. New diagnostics separate image preparation from request serialization, response-header wait, body read, parsing, and retries. The header wait includes network and provider time, so it cannot be labeled pure inference latency.
- Keep the teammates' approved test messages intact, including Agarwal's Diet Coke versus Coke Zero comparison and Alan's “zero sugar sodas” preference. Refresh memory after any edit and check both source-backed relations. A broad shelf should not state that Diet Coke or a zero-sugar product is pictured unless a label is actually confirmed.
- Hosted manual upload and all four book/coffee/bottle control cases passed. The 18-source memory rebuild took 28.56 s separately from scans. Most remaining hosted latency is waiting on the vision request; a second region did not improve it. See [measured evidence and limits](SODA_SCAN_FIX.md).

## Next, in order
1. **Team, now:** get a *War and Peace* copy (or printed cover) and a coffee bag. Keep the approved teammate test messages and wait for **Memory ready** before rehearsal. Do [PHONE_PRACTICE.md](PHONE_PRACTICE.md) Parts 1–3 on two phones, five runs with a real reply, and **record one**.
2. **Team:** Part 4 break-it tests and Part 5 phone photos (`npm run photos:label`, then `npm run photos:check`). Report misses.
3. **Team:** 3–5 people outside the team try it; ask whether the reminder felt specific and welcome.
4. **Team:** final video (Meta story, then Visa continuation), Devpost write-up, public-repo review. **Submit by 6:00 a.m. Sunday** (hard deadline 8:00 a.m.).
5. **Freeze optional features until those gates pass.** SAM outlines, glasses, and more product types are deferred. A segmentation mask needs frame alignment/tracking before it can stay on a moving object.

## Keep the distinction clear
- The selected story works on the live site with synthetic images and scripted replies; physical phones and a real human reply are the remaining proof.
- Hosted image uploads and scripted replies do not establish phone smoothness or meaningful human connection.
- Stripe's TEST payment is verified; physical-phone exchanges/checkout and XR hardware remain unverified.
- Prioritize a welcome invitation and actual reply. Shopping supports the gesture; it is optional.
- No split-second, faster-than-QR, glasses, or spatial-XR claims until demonstrated on the actual setup.
