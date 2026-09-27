# Demo video: one cut for Meta + Visa (3:00)

Meta asked for about 30 s each on (1) the problem and how AI brings people closer, (2) how AI is integrated, and (3) the tools, harnesses, and models used, plus about **90 s of working product**. Visa wants shopping that is **intuitive, personalized, and frictionless**. That fits inside the 90-second demo, so one video covers both.

**Order:** problem (30 s) → **live demo (90 s)** → how the AI works (30 s) → tools and models (30 s). Put the demo early, while attention is highest.

---

## 0:00–0:30 · The problem: why this brings people closer

**On screen:** a phone chat thread scrolling past; stop on Alan's message: *"We should make banana bread together sometime."* (labeled "synthetic demo message"). Then cut to a hand picking up a banana.

**Voiceover:**
> "Friends tell us what they want to do together all the time. 'We should make banana bread sometime.' 'Let's catch up over coffee.' We mean it, and then it gets buried in the chat.
> Callback turns the things you see into reasons to reconnect. When you notice something, it remembers the plan you made with someone and helps you follow through.
> The point isn't more screen time. It's the conversation and the afternoon together that would otherwise never happen."

---

## 0:30–2:00 · Live demo (90 s): phone camera, mirrored to the laptop

Record the iPhone's screen live, mirrored to the Mac with QuickTime. **Don't cut or speed up the recognition moment**: judges trust real timing.

### 0:30–1:15 · Meta beat: a banana becomes a plan with Alan

| Time | On screen | Voiceover |
|---|---|---|
| 0:30 | `/ar` is open; hold up the banana and keep still | "No scanning, no typing. I'm just looking at a banana." |
| 0:35 | The blue box locks onto the banana; about 2 s later the card appears: **Alan**, with his quote and date | "Callback recognizes it and remembers why it matters: Alan said we should make banana bread together." |
| 0:45 | Tap the card: Alan's exact words, date, and a short recipe | "Every suggestion shows the friend's own words. It never makes up a reason." |
| 0:55 | **Send** the invitation, e.g. "Saw bananas and remembered our banana bread plan. Saturday?" | "I decide what to say and whether to send it." |
| 1:05 | Alan's phone (or the inbox) shows a **real typed reply**, e.g. "Yes! I'll bring chocolate chips." | "And now it's a plan again. That's the whole point: two people actually spending time together." |

### 1:15–2:00 · Visa beat: from "we should" to everything ready, in two taps

| Time | On screen | Voiceover |
|---|---|---|
| 1:15 | On the banana card, tap **See the ingredient cart**: recipe ingredients, fixed demo prices, and the full total including tax and shipping | "Following through usually dies at the errand. Here, the plan becomes a cart: exactly what the recipe needs, with the full price up front." |
| 1:28 | Tap **Place test order** → **TEST receipt** | "Two taps, and I approve the total myself. Nothing is ever bought automatically, and pressing twice can't charge twice." |
| 1:38 | Hold up the coffee cup → card: **Alan · "Let's catch up over coffee this weekend."** | "Same camera, different memory." |
| 1:45 | Open the gift option: best fit **Light-roast whole-bean coffee**, citing Alan's words "I like light-roast whole-bean coffee"; medium-roast ground ranked below it | "It's personal: Alan told me what he likes, so the best fit is light-roast whole bean, and it shows me why. No searching, no guessing." |
| 1:55 | Approve → TEST receipt | "Intuitive, personalized, and one tap from done." |

**Required caption for the whole segment:** *"Synthetic demo messages · Stripe TEST mode · demo catalog and prices."*

---

## 2:00–2:30 · How AI is integrated

**On screen:** the laptop "judge view" beside the phone mirror, or a simple diagram: *chats → memory (ahead of time) → camera frame → recognition → friend ranking → second check → card.*

**Voiceover:**
> "AI does three jobs.
> **Ahead of time**, Meta's Muse Spark 1.3 reads your conversations and builds a private, structured memory: plans, preferences, and goals, each with the friend's exact quote.
> **In the moment**, an on-device detector keeps the box on the object. One steady frame goes to Muse Spark 1.1, which identifies it and matches it to the topics in your memory. Code scores every friend on how well the photo fits, the kind of relationship, how much it matters to them, and how recent it is. Weaker matches get a second AI check, and only confident results are shown.
> **For shopping**, AI turns 'I like light-roast whole beans' into shopping constraints, and code prices and ranks the options. You approve every payment."

---

## 2:30–3:00 · Tools, harnesses, and models

**On screen:** logos or a simple list, plus the evaluation table from [PROFILES.md](PROFILES.md).

**Voiceover:**
> "**Models:** Meta Muse Spark 1.3 for memory, and Muse Spark 1.1 for vision. We measured 1.1 as about 2.8 times faster with the same accuracy on our images. Object detection and tracking run on the phone with TensorFlow.js COCO-SSD and OpenCV.js.
> **Stack:** Next.js on Vercel, Supabase for private storage and realtime replies, and Stripe in test mode.
> **How we built it:** AI coding agents, Claude Code and GPT-6, wrote and reviewed code under our direction, with hundreds of automated tests and live checks against the deployed app. To test matching at real scale, we ran it on LoCoMo, a 5,882-message long-conversation dataset. It picks the right friend about four times as often as keyword matching, and an independent AI judge rated three in four suggestions as sensible.
> **Callback remembers what matters to the people you care about, so you actually follow through.**"

---

## Before recording (all must be true)

- [ ] **The `/ar` card can send the invitation** (or the take cuts to the scanner's **Send** screen), and a second phone is signed in as the recipient to type a real reply. The Meta judges need to see a person reply.
- [ ] Alan's messages come from the account's saved conversations (GPT-6 is removing the hard-coded story now). Open `/ar` about a minute early so memory preparation finishes (about 10 s).
- [ ] Real banana and a coffee cup, in good light, against a plain background. Hold each still for about a second.
- [ ] Stripe is in **TEST** mode; the receipt says TEST.
- [ ] iPhone: Do Not Disturb on, Auto-Lock off, portrait lock on, charging. Mirror with QuickTime over USB-C: **File → New Movie Recording → ⌄ → iPhone**.
- [ ] Do at least 3 full takes and keep the best. Record the voiceover separately in a quiet room if the venue is loud.

## What not to say

- "Instant", "faster than a QR code", or "never wrong". Say "about two seconds" only if the recorded take shows it.
- That we integrated Visa's APIs. The payment is **Stripe TEST**, not Visa Intelligent Commerce.
- That the messages are real. They're labeled synthetic.
- That it runs on Meta glasses. Say it's *designed for a glance* and demoed on a phone.

## If Visa wants a separate short clip

Cut **1:15–2:00** on its own: plan → personalized cart → two-tap TEST checkout. It stands alone.
