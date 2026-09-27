# Submission: write-ups and release checklist

Rewrite anything below that the final build or measurements don't support. Fill in bracketed items only with real results.

## Meta: "Bringing People Closer Together with AI"

**Product promise.** Callback turns things you encounter into specific reasons to reconnect with people you already care about.

**Who it's for.** College students and young adults whose friends are spread across chats and cities. They mean to follow up on "we should do this sometime" and rarely do. The first use is intentional: browsing a shop, a friend's shelf, or a photo you already took. Hover is explicitly enabled: it sends steady camera frames for recognition, shows an unsaved preview, and saves a photo only when you tap to open it. Manual capture also remains available.

**How it strengthens connection.** You point your phone at something. Callback checks the messages you explicitly imported for a specific, current reason it matters to a friend, then shows the original words and date. You write an invitation and decide whether to include the quote. Your friend can receive the photo in Callback's inbox and reply with a next step. The value is that something they cared about was remembered, and the conversation that follows is entirely human. Nothing is sent automatically, and Callback never writes or predicts anyone's reply. This prototype does not automatically import social messages or confirm delivery through a native texting app.

**Demo story.** *War and Peace* recalls that Maya said it inspired her to try writing a novel; Alex asks how it's going and Maya replies (Meta). Coffee recalls Maya's stated preference for light-roast whole beans; Alex chooses a matching gift and approves a Stripe TEST payment (Visa). Hosted checks use fictional labeled chats and scripted replies; add the real phone/human results after rehearsal.

**Why AI is essential.** None of this is tagged anywhere. The object appears in a photo; the connection lives in an informal line of a chat. Whether it's a reason to reach out depends on:
- who said it;
- whether it's about them or someone else ("my brother wants one");
- whether it's still true.

The verified hosted demo uses **Meta muse-spark-1.3** to prepare reusable relationship memory from the imported context and **Meta muse-spark-1.1** to identify the object in a photo. The memory labels each relevant message with a relation (`inspired`, `prefers`, wanted, recommended, dislikes, cancelled, and others), the speaker's own words for the item, and the original source. Vision identifies the object and how specifically it can be identified when held in view.

Code then applies the rules a thoughtful friend would:
- it has to be their own words;
- an exact-title claim has to match the observed work or item, while a stated taste can attach to the observed kind of item;
- a newer message changes things only if it's truly newer and relevant. “I stopped writing it” closes the book-inspired ambition; disliking dark roasts does not cancel a preference for light-roast beans.

When the evidence isn't there, Callback says "I couldn't find a supported connection in the context you've shared" instead of inventing one.

**Implementation.**
- Next.js on Vercel; Supabase for auth, Postgres with row-level policies, Realtime, and private storage.
- Prepared relationship memory plus one vision call per warm hover scan; manual scans can fall back to two calls. Steady-view capture and session-local revisit caching reduce repeated work.
- Hover previews are unsaved until selected; signed receipts prevent changing the photo, owner, or decision before saving.
- Server-side authorization for every send and quote; idempotent sends.

Measured: [scan p50/p95 from live:check], [N/5 physical two-phone runs], [held-out eval with denominators and failures, or "not measured"].

Current verification (September 26, Meta muse-spark-1.1 vision + 1.3 memory, live site): book → Maya in 1.6 s; 4/4 photo check (book → Maya, *Anna Karenina* → Sam, coffee → Maya's taste, bottle → no one); hover 15/15 and 15/15; shopping 14/14; access 24/24; give-up update and exact reset; one $23.11 coffee gift Stripe TEST payment paid and verified. Inputs were synthetic rendered images and fictional chats; replies were scripted. These are integration checks, not a recognition benchmark or phone latency measurements. Physical-camera inference, a human reply, and phone checkout remain unverified. See [hover measurements](HOVER.md) and [presentation notes](PRESENTATION_NOTES.md); use only measurements for the build actually demonstrated.

**Early feedback.** [From docs/FEEDBACK.md: N people, arranged or not, how many said the connection was accurate, specific, and welcome, and whether a real exchange followed.] This is early usability evidence, not proof of lasting relationship change.

## Visa: personalized discovery, word-of-mouth advice, and approved checkout

**Pitch.** The best shopping advice may already be in a conversation with someone you know. Callback connects what you find to those people, helps you ask the right one and choose the right version, then carries that choice into an approved checkout.

**What works** (fill in the verification status):
1. **Discovery.** The V3 scan relates a coffee bag or identifiable coffee cup to coffee products in a labeled demo catalog. These are related gift ideas, not a claim that a catalog packet is the item in the photo. Exact-item, same-family, and similar-alternative distinctions also exist for other catalog paths.
2. **Word of mouth.** People who own, tried, or recommended the item appear as contacts to ask. Ownership alone doesn't count as praise; favorable notes need their own words, and a dislike is shown as a caution. Asking a contact sends a real message through the same authorized path. Advice stays "pending" until a person actually replies. This is optional in the two-person book demo.
3. **Decision support.** Opening shopping loads options. For V3, the shopper reviews an editable $25 all-in budget and a buyer-chosen gift purpose grounded in Maya's stated taste. The demo catalog ranks light-roast whole-bean coffee, excludes recognized dark-roast avoids, checks stock and totals with shipping and tax, and explains up to three options and their tradeoffs. Gift-for-a-wish and shared-plan purposes remain available where the scan supports them.
4. **Approved checkout.**
   - The server holds the quote and re-validates price, stock, currency, and budget at approval. A changed total needs a fresh approval.
   - Checkout runs on Stripe-hosted Checkout in **test mode**, and card data stays with Stripe.
   - An order becomes "paid" only after the server retrieves the Checkout Session from Stripe and sees it complete, paid, and matching the approved amount. Signed webhooks are deduplicated.
   - The receipt is labeled TEST. Buying a gift is not recorded as the recipient owning it.

**Be precise.**
- The selected **coffee** gift's $23.11 Stripe TEST checkout was independently verified against the paid session, saved order, and webhook event on September 26. Phone checkout remains pending. The **book-to-pen** gift is a separate, unbuilt proposal and should not appear in the V3 demo claim.
- Merchant: "Callback Demo Store", with demo prices, stock, shipping, and tax.
- Provider: Stripe, test mode.
- This is **not** a Visa Intelligent Commerce integration, and a Visa-branded test card doesn't make it one. Say so unless the sponsor supplied and we ran their sandbox.

## Claims to avoid

- "Nobody in your life connects to this", or that only AI could solve these fixed examples.
- Automatic access to existing messengers or social inboxes. Context here is explicitly imported, selected, and consented; native SMS opens the user's texting app and Callback cannot confirm its delivery.
- "First ever". Precedents such as OurLife and several HackMIT projects touch similar ideas; our claim is the present-world discovery that ends in a real reply.
- Any accuracy or latency number, or physical-phone run, that wasn't actually measured. Browser-only or scripted checks must be labeled as such.
- Glasses or ambient operation. They are not shipped; a glasses experiment happens only after a phone recording, capped at 90 minutes, and only with a device physically in hand.
- Any synthetic message presented as real.
- Any OpenAI-powered result presented as Meta Muse Spark output. The current hosted M1/V3 checks used Meta vision and memory; confirm the deployed provider during phone rehearsal and describe only the build actually shown.

## Release checklist (before Sunday 6 a.m.; organizers list different cutoffs)

- [ ] `npm test`, `npm run lint`, `npm run build` pass on the final commit.
- [ ] `npm run release:check` is clean. Review `git log -p` for anything private.
- [ ] No real `.env`/`.env.local` files, secret-bearing configuration, `data/private/`, real messages, or private photos tracked. The blank `.env.example` template is intentionally tracked.
- [ ] README states the actual provider, what's live-verified, and what isn't.
- [ ] Repo made public (it's private now) and the link works logged-out.
- [ ] Meta video (2–3 min): real faces and a genuine reply. Label synthetic context on screen. Record from the deployed HTTPS app.
- [ ] Visa continuation video or segment, if submitting to Visa, naming the provider and demo merchant.
- [ ] Devpost: tracks (Meta challenge; Oracle of the Deep as the one main track; Visa only if the sponsor confirms eligibility), Create-X checkbox, Notability screenshots.
- [ ] Registered at Expo.
