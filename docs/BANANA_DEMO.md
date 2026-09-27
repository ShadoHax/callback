# Banana bread demo

**Superseded frontend:** the camera now supports banana and coffee at `/ar`, with a compact reminder. See [PHONE_AR.md](PHONE_AR.md). The measurements below describe the earlier banana-only build.

Open `/demo/banana` on an HTTPS phone browser. The phone camera acts as the glasses view: point it at a real banana and wait for the banana outline and Alan card. If a physical banana is unavailable, copy a supplied banana photo from the computer's Downloads to the phone's Photos or Files, then tap **Photo** to choose it. The first tap, **See prepared ingredient cart**, opens the recipe and itemized cart. Wait for **VISION CONFIRMED**; the second tap, **Place test order**, creates a Stripe **TEST** payment and shows the test receipt. No shipment is created.

## Before the pitch

1. Run the branch with `MODEL_PROVIDER=meta`, a working `MODEL_API_KEY`, and `STRIPE_SECRET_KEY=sk_test_…` in the app environment. The banana endpoints require that test key even for preparation because it signs short-lived demo tokens. `npm run dev` works for desktop rehearsal; a phone camera needs an HTTPS deployment or tunnel. Use the intended branch deployment URL explicitly.
2. On each demo phone, open `https://callback-khaki-phi.vercel.app/demo/banana` **after this branch is deployed**. Grant rear-camera access and let the local detector load. Keep a banana in good light against a contrasting surface. Move slowly enough for the outline to reacquire it. The **Photo** button is the fallback if camera permission, focus, or connection fails.
3. Rehearse the exact image and server before going on stage. From the repo root, run:

   ```sh
   node --import tsx scripts/banana-check.ts --app https://callback-khaki-phi.vercel.app
   ```

   The command reads all four original user images directly from `~/Downloads`, calls `/api/demo/banana/prepare` once and `/api/demo/banana/scan` for each image, then checks an unrelated synthetic water-bottle image if present. It prints recognition, Alan/banana-bread memory match, recipe/cart checks, and client/server time per photo. It exits nonzero unless **all four** pass. It prints the fastest passing photo to choose for the stage fallback. The images are not copied into Git. Use `--dir PATH` if the photos are elsewhere. This command makes real model calls and creates no order.
4. If a TEST payment rehearsal is wanted, add `--order-test`. This calls the order endpoint twice with the same confirmed scan token, verifies that both return the same Stripe TEST PaymentIntent, and confirms `livemode: false` and `shipment: not_created`. Each fresh run can create one new test payment. Never use a live Stripe key.

The on-screen Alan message is a **labeled synthetic demo memory** dated September 12: “We should make banana bread together sometime.” Preparation uses AI to turn that quoted plan into a connection and recipe. The camera view first uses local COCO banana detection to surface the card quickly; the order button enables only after the uploaded frame passes server-side Meta vision. The ingredient catalog, prices, tax, shipping amount, and “Demo home” are fixed demo data. The Stripe TEST PaymentIntent is real test-mode API traffic, but there is no real charge, merchant fulfillment, address submission, or delivery.

The CLI checks still images through the real server scan endpoint. A passing CLI run does not prove a phone's camera permission, frame timing, AR tracking, or network latency. Rehearse the full two-tap path on the actual phone and deployment that will be used for judging.

## A 45-second pitch

“Alan said we should make banana bread together. Two weeks later, I see a banana. Callback remembers the plan and makes it easy to follow through: a recipe, the ingredients we still need, and a cart ready to approve. The goal is to spend time together. Shopping takes two taps so the errand doesn't get in the way.”

If asked about the tech: Meta 1.3 prepares the cited memory and recipe before scanning. COCO-SSD detects the banana locally and OpenCV tracks it in the phone's camera view; a focused Meta 1.1 call confirms the fruit. The signed preparation travels with the scan, so a fresh server does not reread the conversation or regenerate the recipe. The server prices the fixed demo cart, and Stripe test idempotency makes a repeated approval return the same payment.

## Verified on September 26, 2026

Build `bfe8505` was deployed to the URL above. All four supplied banana photos passed the hosted Meta scan → Alan memory → recipe → cart check. End-to-end request times were 2.757, 1.887, 1.957, and 2.130 seconds respectively. The water-bottle negative produced no cart session. The Stripe TEST order succeeded and repeating the same session returned the same payment. Separately, all four photos were detected and tracked in the browser AR view. The full offline suite passed 460 tests, lint, TypeScript, production build, and the release secrets check.

An earlier local request timed out at Meta; its repeat passed. Retry AI vision is available. These measurements use uploaded images and a desktop browser; actual phone-camera permission, hand motion, venue lighting, and mobile network behavior still need one rehearsal on the team's phones.
