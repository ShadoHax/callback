# Phone AR rehearsal

Open `/ar` on the phone (for the hosted app, `https://callback-khaki-phi.vercel.app/ar`). The older `/demo/banana` URL redirects there. Sign in as the scanner before rehearsing a conversation. The camera can identify an object without an account, but a connection needs that owner's imported messages and a current prepared memory index.

## Set up the messages

The editable [rehearsal source bundle](../fixtures/shared-activity-rehearsal.json) contains **synthetic** messages and labels them as such. It is sample material for a public demo, not a copy of anyone's inbox. Edit it for the story you want to show, then import it for the scanner owner's UUID from `DEMO_OWNER_ID` in `.env.local`:

```sh
npm run import:sources -- fixtures/shared-activity-rehearsal.json <scanner-owner-uuid>
```

For approved personal messages, make a separate private JSON bundle with the same `label` and `sources` shape and set `is_synthetic` accurately. Keep private bundles out of Git. The import command accepts optional `<person-id> <recipient-user-uuid>` pairs when you want to map a person to the app's inbox. The phone AR message link opens the phone's SMS composer; the user chooses whether to send.

Prepare memory after importing or changing messages. The `/ar` page asks `/api/context/prepare` on load, and the home page also provides memory preparation. A changed source corpus invalidates older connection and cart tokens; scan again after an import.

## Rehearse on the phone

1. Sign in, open `/ar` over HTTPS, allow the rear camera, and wait for memory preparation. Set up the desired objects under the same light you will use in the presentation.
2. Hold the camera steady on one object. The live video remains visible while a frame is checked. A verified connection gets a compact overlay with the person and a short activity label; an outline appears when the object can be localized. Tap the overlay for its saved message and suggested questions.
3. Opening the details drawer only reveals the cited message and suggested action buttons. No recipe, cart, or model request is triggered by opening it. Tap a suggested question to ask Muse for that specific help. Recipe requests produce steps; shopping requests produce supplies; nearby-place requests ask for location and use Muse web search for cited places; planning requests produce general steps.
4. Selecting a shopping question asks Muse for ingredient or supply requirements, then searches the live shopping providers from `codex/native-sms-only`. The drawer shows public offers and their source links. Purchases happen at the merchant; this discovery API does not provide a unified cart or checkout. Without a configured provider key, each requirement has a product-search link instead of invented prices.
5. Look away to clear the cue, or close the drawer to resume scanning. **Check view** retries the current scene; **Photo** is a fallback for a saved image.

The app uses the camera frames to identify visible objects across categories. It only shows high confidence identities; that threshold is not an accuracy guarantee. Connections come from the signed-in owner's current prepared index and cited source messages. A loose match is checked before the person's name appears. An unrelated object can still be recognized without inventing a memory, plan, or cart.

## Replay a recorded video in the real interface

Tap **Video**, choose a local MOV/MP4, and use **Play**, **Pause**, or **Replay**. The video stays on the device; the app sends individual JPEG frames through the same recognition callback as the live camera. Only one recognition request is in flight. The final frame remains visible for inspection. Pausing playback lets you inspect a connection without rushing a short clip.

Camera and video share the handheld-motion gate, blue tracked outline, smoothed box, and compact memory chip. Brief tracking loss has an 850 ms grace period; sustained scene changes clear the connection. A late API result is discarded when its captured view has changed substantially. This uses image differences, not perfect semantic tracking, so still rehearse on the physical phone.

The local files `IMG_3339.mov` and `IMG_3340.mov` are excluded from Git and deployment. They are not public sample assets. Recognition may take longer than a short pan; keep the object visible until the card arrives. No object-specific story is selected in the active AR flow: edited or removed messages change the available connections.

## Check images before filming

The checker uses the existing scanner account credentials from `.env.local`, prepares that account's index, and sends the supplied files sequentially through `/api/demo/ar/scan`. It logs image basenames, item identity, match status, cited source IDs, and timings. It does not embed expected objects or people. Pass one or more JPG, PNG, or WebP images under 8 MB:

```sh
npm run ar:check -- --url http://localhost:3000 --image data/private/phone-photos/first.jpg --image data/private/phone-photos/second.jpg
```

Use `--expect-person "Display Name"` when every supplied image should match that person. `--images path1,path2` is an alternative to repeated `--image`. Select `--action recipe`, `--action shop`, or `--action nearby` to exercise each action. The checker reports shopping provider availability and nearby place counts. The active AR shopping flow no longer uses `--order`; purchases happen at the linked merchant.

These are image uploads through the scan API, not measurements of the live camera tracker. Do the final pass on a physical phone with the rear camera and presentation lighting.

## Record the demo

For a shareable video, use the labeled synthetic bundle. Start a phone screen recording before opening `/ar`, then show the live camera, a visible object, the compact overlay, the cited message, and the suggested activity. For shopping, show the generated ingredient requirements and a returned listing or fallback product search. For nearby, show location consent or the Klaus fallback, then a cited venue. Capture the actual phone screen; an uploaded photo demonstrates recognition but does not prove live AR tracking. Avoid recording credentials or private message bundles.

Live AR shopping uses SearchApi (preferred) or SerpApi for public Google Shopping listings. Add the server-only `SEARCHAPI_API_KEY` or `SERPAPI_API_KEY` to `.env.local` and Vercel Production. Results have observed prices, not guaranteed availability; verify package size and checkout at the merchant. The older TEST catalog/order code remains for historical flows, but the active AR shopping action no longer returns its cart.

## Historical verification — September 26, 2026 (before live shopping)

- Both supplied MOVs were loaded through the deployed Video picker at a 390×844 viewport. The baking clip showed the actual saved plan and completed a generated eight-item Stripe TEST cart in the browser.
- The cup clip pans off the object quickly. With playback paused on the cup, the real saved catch-up message appeared; the successful browser request took 3.3 s (including a 0.95 s verification call). An earlier uncertain attempt was withheld and retried. Hold the prop in view until the card appears during the physical demo.
- A separate hosted Diet Coke photo recognized the named variant and its own saved connection; it offered no shared-activity cart. There is no banana/coffee scenario selector in the active AR response.
- Browser start/end logs showed maximum one recognition request in flight across six logged requests. Logged timings include request ID, server duration, verifier duration, and model transport diagnostics; no source quotes are logged.
- The generic planner now uses configurable `AR_ACTIVITY_MODEL`, defaulting to the faster Meta Muse Spark 1.1. A live baking-plan call took 3.5 s and supplied measured steps, baking temperature/time, and eight matching merchant SKUs. This is one measured call, not a latency guarantee.
- Source messages are editable synthetic rehearsal data imported into the account. Merchant SKUs/prices are TEST inventory data; neither is an object-to-story code branch. Original clips, private frames, and credentials are excluded from Git and deployment.

## Suggested actions and prepared labels

The prepared index now stores an AI-written short label and suggested questions for each cited connection, alongside its topic and visual cues. These are generated from the messages before scanning, not selected by checking whether the object is a banana or coffee cup. The compact card uses that short label; original quotes and synthetic-source disclosure remain in its expanded view.

Selecting a question calls Muse with the signed connection and an explicit action (`recipe`, `shop`, `nearby`, or `plan`). Actions do not produce checkout tokens in the current AR interface. A nearby tap requests device geolocation (8-second timeout); denied, missing, or timed-out permission uses Klaus Advanced Computing Building, Georgia Tech, Atlanta. Only a grounded venue query and approximate coordinates (rounded to three decimal places on the server) go to [Meta Responses web search](https://dev.meta.ai/docs/cookbook/search-grounding); the external venue lookup does not receive private conversation text. Results link to search sources, with an explicit-location Google Maps search alongside them. No opening-hours or distance guarantee is made.

Use `npm run ar:check -- --image <photo> --action recipe` (or `shop`, `nearby`, `plan`) to verify each requested output separately. The checker rejects `--order` because live discovery has no checkout API.

### Action-flow verification

- The latest prepared index produced **Alan / Banana Bread** with recipe and shopping questions, and **Alan / Catch up** for the social meeting. Labels and questions are model output from the cited messages, not object-name branches.
- With sampled frames from the supplied clips, Muse matched the baking plan in 3.6–4.4 s and the catch-up plan in 4.2 s. Selected recipe, shopping, and nearby calls took 2.5–3.5 s in these runs. These are individual measurements, not guaranteed latency.
- Recipe requests returned steps with no cart; a shopping request produced eight TEST items; a nearby request produced a Maps search with no checkout token. Memory preparation is separate from scanning and took 24 s for the current 24-source rehearsal corpus across three model calls.
- 508 automated tests, lint, TypeScript, and the tracked-file secrets check passed. Tests cover no activity call on drawer open, selected-action routing, cart isolation, retries, and stale requests.
- Deployed browser verification at 390×844: the compact chip showed **Alan / Banana Bread**. Opening it showed the source and two question buttons, with zero activity-start log entries. Clicking recipe produced steps without checkout (2.8 s browser round trip); clicking shopping separately produced the eight-item TEST cart (4.2 s).
- The deployed cup video, paused on the cup, showed **Alan / Catch up**. Its nearby question called Muse and returned a Google Maps coffee-shop search in 3.0 s, without a recipe or cart.

## Current live-shopping and location changes

- Text, compact cards, source panels, and buttons are larger for phone readability.
- Nearby asks permission only on the nearby action. Coordinates are not saved to a database or logged; only approximate coordinates are sent to Muse for this lookup. Permission refusal falls back to the named Klaus building.
- Shopping imports the gift-query improvements from `origin/codex/native-sms-only` at `9e80c4f`, reuses its SearchApi/SerpApi adapters, and adds bounded per-ingredient searches. Only public product terms go to shopping providers.
- The local live-model check created nine requirements from the baking message in 4.9 s; no shopping-provider keys were configured at that check, so all nine correctly reported `provider_unavailable` with search links. This does not count as verified live merchant pricing.
- Root verification: **534 tests passed**, plus lint and TypeScript. A real scanned cup → cited memory → Klaus web search returned two places in 6.2 s for the action (separate from 5.6 s recognition). A direct coordinate-based search returned two source-backed places in 3.9 s. These samples verify the paths, not exact proximity or search reliability.
- Search uses `muse-spark-1.1` on Meta Responses with `web_search` and `include: ["web_search_call.results"]`. Results require a completed search and venue-name evidence in returned citations or search titles. Unsupported addresses and summaries are withheld. A failed or ungrounded lookup shows an error with retry rather than invented places.
- Hosted browser verification at 390×844 confirmed the larger compact card, source panel, and action buttons. Location was unavailable in the in-app browser, so the eight-second client deadline selected Klaus; Muse returned two cited venues and an explicit Klaus Maps search. The full browser action took 15.8 s including location wait. A real device permission grant still needs a phone rehearsal; granted/denied/stale callback paths are covered by UI tests, and the coordinate-backed server call was run live.
- Hosted shopping UI generated ingredient queries and working product-search links with zero invented offers or prices. Internal source UUIDs are stripped from generated display text; citations remain in the structured evidence fields.

### SearchApi activation — September 27

Configured the supplied SearchApi credential only in ignored local environment settings and Vercel Production Secrets, then redeployed. Live API authentication returned 40 flour listings; individual ingredient checks returned three offers each for bananas, baking soda, and flour. The first complete local plan returned offers for six of nine requirements. A valid flour request exceeded the old 5.5-second deadline, so provider requests now have a bounded 12-second timeout. Missing matches still get search links; no offers or prices are fabricated.

Production testing also exposed package-word queries returning empty containers. The planner now labels ingredients versus equipment, food queries drop trailing package nouns, and ingredient results filter empty vessels/accessories before selecting three listings. Original query and required quantities remain in the response. Direct live checks of salt and vanilla extract returned three actual food listings each in 5.5 s combined. Equipment searches retain their exact terms.

### Single-grocer Stripe test checkout

The AR shopping action now retains up to 30 matching listings per ingredient,
looks for a complete basket from one recognized grocer, and searches missing
items at the two best-covered grocers if necessary. It never mixes sellers into
one claimed grocer basket or invents missing prices. Ingredient form checks
exclude plants, empty packaging, flavored substitutes, and similar bad matches.
The model still generates the ingredient requirements from the actual memory;
there is no banana-specific checkout cart or fixed price catalog.

Expand **Review all groceries** to inspect listing links, quantities and listed
prices, then choose **Buy all · Stripe test checkout**. Server-signed quotes bind
the exact USD subtotal and all items to the signed-in account for ten minutes.
Stripe receives individual line items and an idempotency key. The return notice
checks the session with Stripe before confirming a completed test payment.
These are simulated payments: no grocer order or delivery is placed. Tax and
delivery are not included; listing availability and package sizes need review.

Verification on September 27: live SearchApi queries produced eight ingredient
lines at Hy-Vee totaling $21.69 (including three individual bananas). This was
an observed test result, not a fixed app price. Later searches returned HTTP 429:
the SearchApi monthly allowance was exhausted. Fresh searches require renewed
credits; the app does not fabricate a cart when the provider is unavailable.

Saved price fallback: `data/grocery-price-cache.json` now stores the eight
observed Hy-Vee listings with source URLs, cents, and checked timestamps. The
shopping helper uses these saved listings first for reviewed ingredient aliases;
other ingredients still use live search. It does not substitute baking powder
for baking soda, salted for unsalted butter, or claim newly checked availability.
The UI labels saved prices and dates. Cached cart preparation takes at least one
second, with the ordinary preparing state; no fake search progress is emitted.
The saved eight-line basket therefore works without additional SearchApi credits.

The single-grocer basket covers grocery ingredients. Any separately suggested
kitchen equipment is labeled separately and does not prevent ingredient checkout.
The cooking planner asks for grocery requirements and mentions ordinary kitchen
gear in recipe steps unless the source messages specifically request buying it.

A subsequent one-time refresh with the replacement SearchApi credential ran
eight searches and updated all eight stored listings. The refreshed basket is
$25.60 with three individual bananas; quantities chosen for another recipe can
change the subtotal. The cache file preserves each returned source URL and
actual checked timestamp. Credentials remain only in ignored local environment
settings, not the repository.
