# Phone practice: exact steps (M1 book + V3 coffee)

**Deadline: Sunday 8:00 a.m. (confirmed). Submit by 6:00 a.m.**
App: https://callback-khaki-phi.vercel.app · Logins: `data/private/DEMO_ACCESS.md` on Aditya's Mac. **Alex** is the one with the camera; **Maya** is the friend. Never show logins on camera.

The story, in one breath: *Alex sees War and Peace and remembers Maya said it inspired her to try writing a novel, so Alex asks how it's going and Maya replies (Meta). Later Alex sees coffee, remembers Maya likes light-roast whole beans, and chooses a gift matching that taste, approving a TEST payment (Visa).*

The live site runs Meta muse-spark-1.2 vision with prepared muse-spark-1.3 memory (`all-items-v9`). The earlier book/coffee story was checked with synthetic test images and scripted replies; the current soda fix has its own [hosted checks](SODA_SCAN_FIX.md). Real phones and a real person replying remain the rehearsal goal.

## What you need

- **Phone A (Alex)** and **Phone B (Maya)**, charged, on good Wi-Fi.
- **War and Peace.** Any edition: a library or bookstore copy, or the cover printed on paper. The title must be readable. Screen glare can hurt, so paper beats showing it on a laptop.
- **Coffee.** A bag of coffee beans (any brand) is best. A café paper cup that clearly says "coffee" is another candidate to test. A plain mug does not: the camera can't tell it holds coffee.
- **Optional decoys:** *Anna Karenina* (the app should find **Sam**, who recommended it), plus any unrelated object like a water bottle (it should find no one).

## Part 1: Setup (5 min)

1. Open the app on both phones. Phone A: sign in as **Alex**. Phone B: sign in as **Maya**, then tap **Inbox**.
2. Phone A: wait for **Memory ready** under the camera. Preserve the teammates' approved test messages, including Agarwal's Diet Coke/Coke Zero comparison and Alan's zero-sugar-soda preference. Do not use **Reset demo updates** on this shared corpus during practice: it removes the soda updates too. Use a separate rehearsal account for the cancellation/reset test. A stale ready label is not enough: the server will ask for a refresh before any scan.
3. The camera page should say **Powered by Meta · vision muse-spark-1.2 · memory muse-spark-1.3**.

## Part 2: The Meta demo, M1 (run it 5 times; ~20 min)

1. **Phone A:** tap **Start hover** and allow the camera.
2. Hold the book's cover about 30–50 cm (1–1.5 ft) away and **keep still for a second**. Start a stopwatch when you stop moving.
3. **Maya's** card should appear: "War and Peace inspired Maya to try writing a novel." Stop the stopwatch and write the time down. (An earlier deployment's synthetic uploads took 1.6–7.0 s overall; the book took 2.6–2.8 s. The current hosted shelf uploads took 6.473–7.980 s. Measure the real phone instead of promising either timing.)
4. Tap the card. Open **Read their words** to show her original message. Point out the **ruled-out** list: Priya (didn't like it), Jordan (his sister's wish, not his), Leo (only a general interest). That list is the "the AI actually understands" moment.
5. The draft says: "Saw War and Peace and remembered it inspired you to try writing a novel. How's it going? No pressure, just curious." Edit it if you like, then tap **Send to Maya**.
6. **Phone B:** the message appears on its own. Type a **real** reply (e.g. "Ha, still just chapter one in my head. Want to do a writing session Sunday?"), then tap **Reply**.
7. **Phone A:** answer and agree on a next step. Then tap **Scan something else**.

**Record one run.** On iPhone: swipe down from the top-right, tap Screen Recording, wait 3 seconds, do the run, then tap the red bar to stop. Better still, have a third phone film both screens.

## Part 3: The Visa demo, V3 (~10 min)

1. **Phone A:** hover over the **coffee**. Maya's card: "Maya told you they like 'light-roast whole beans'."
2. Open **"A gift Maya would actually like?"** The budget is prefilled at **$25**, including shipping and tax. Tap **Show options**.
3. Expected: **Best fit: Ethiopia Yirgacheffe ($23.11)**, "Fits what Maya said, 'light-roast whole beans': light roast, whole bean." Under **Not shown**: French Roast and Espresso Blend ("Maya said 'Dark roasts' isn't for them"), and the sampler (over budget).
4. Tap **Review test total**, then **Approve $23.11 and pay (test)**.
5. On Stripe's **test** page, use card **4242 4242 4242 4242**, any future date (12/34), any CVC (123), any ZIP. **Untick "Save my information".** Tap **Pay**.
6. You're back on the order page and it says paid (TEST). No real money moves.

Say this out loud: *"Alex chose the gift. Callback matched Maya's stated taste to product traits, and nothing is paid until Alex approves."*

## Part 4: Break-it tests (~15 min, once each; write down what happened)

| Test | How | Should happen |
|---|---|---|
| Different book | Hover over *Anna Karenina* (or any other book) | *Anna Karenina* → **Sam**, who recommended it. Any other book → no one (Leo is only a general interest). |
| Unrelated thing | Water bottle, phone, keys | No one: "I couldn't find a supported connection…" |
| Move around | Sweep the camera without stopping | Nothing until you hold still |
| Glare / dim / far | Shiny light on the cover; a dark corner; 1.5 m away | May ask you to get closer or take longer. Write down which. |
| **She gave up** | On an isolated rehearsal account: Demo controls → Person ID `maya` → message `Honestly I stopped writing the War and Peace novel. Not for me right now.` → **Add synthetic message** → wait for "Memory ready" (duration varies) → hover over the book | **No one**, with "Ruled out Maya: a newer message says that's off." |
| **Reset** | On that isolated rehearsal account only: **Reset demo updates** → wait for ready → hover over the book | Maya again. Do not reset the shared account’s approved teammate sources. |
| Soda shelf | If available, scan the original mixed soda display or a similar shelf with unreadable variants | Alan's zero-sugar taste may appear as a **related** reminder. Agarwal's Diet Coke evidence needs a confirmed Diet Coke label and should remain `needs_exact` on a broad shelf. Never claim an unconfirmed variant is pictured. |
| Camera blocked | Deny camera permission | **Take a photo** / upload still works |
| Cancel checkout | Start the coffee checkout, then go back on Stripe's page | No paid receipt, and trying again doesn't duplicate the order |

## Part 5: Photo check (~10 min)

1. With Phone A's normal camera, take 5–8 photos of the book (straight on, angled, dim, glare, partly covered), 2–3 of the coffee, and 2–3 of random objects.
2. Get them onto Aditya's Mac (AirDrop is fine; HEIC is fine).
3. **Rename by what they are:**
   - `book-1.jpg`, `book-dim.heic`, …
   - `coffee-1.jpg`, …
   - `anna-1.jpg` (if you have *Anna Karenina*)
   - `other-bottle.jpg`, …
   - `unclear-blurry.jpg` for a photo you know is unreadable
4. Put them in `callback/data/private/phone-photos/`. This folder is never uploaded to GitHub.
5. In Terminal, in the `callback` folder, run the command below. It prints what each photo *should* find; check that it looks right:

```bash
npm run photos:label
```

6. Review each expected result before running a model. Filename prefixes are labeling shortcuts, not truth: an unreadable cover may yield no match if the app cannot identify even its category. Correct the labels based on what the image actually supports. Then run the check itself:

```bash
npm run photos:check -- --provenance "Actual demo props photographed on our phone at the venue"
```

It prints ✓/✗ per photo with the time, plus totals. Keep the labels fixed after running. **Report every miss and the denominator**; camera-roll results still do not measure live hover, autofocus, or physical-phone messaging.

## Results

| Run | Seconds to Maya's card | Correct card + evidence? | Message arrived on B? | Real reply? | Next step agreed? |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

Coffee → gift → TEST payment on phone: ___ · Break-it tests: ___ · Photo check: book __/__, coffee __/__, others __/__

## Schedule

- **Saturday afternoon:** Parts 1–5; send the photos; fix what breaks.
- **Saturday evening:** 3–5 people outside the team try it ("Would you actually want this reminder?"); record the final video; write the Devpost.
- **Sunday by 6:00 a.m.:** submitted. Hard deadline 8:00 a.m.

## If something goes wrong

- **Memory never gets ready:** tap **Retry preparing**. Wait for the actual ready state before any manual or hover scan; preparation duration varies. The current 18-source cold hosted build took 28.56 s and one model call.
- **Card doesn't show for the book:** get closer so the title fills more of the view; hold still. If it still fails, take a photo of that exact view for the photo check.
- **Wrong or no card for coffee:** use the coffee bag, not a plain mug; make "coffee" visible.
- **Message doesn't arrive:** tap **Refresh** in the inbox, and check that Phone B is signed in as Maya.
- **Old test messages in Maya's inbox:** those are from automated checks; ignore them during rehearsal. Keep the approved source messages used for matching.
