# Relationship profiles + photo classifier (branch `claude/profiles-classifier`)

**Why:** 8–20 demo messages can't show what Callback is for. Real friendships are hundreds of messages over months. With that much history, the question changes from "which message names this product?" to "**given everything you know about each friend, who does this thing remind you of, and how sure are you?**" People answer that intuitively; computers find it hard.

## Dataset

[LoCoMo](https://github.com/snap-research/locomo) (Maharana et al., *Evaluating Very Long-Term Conversational Memory of LLM Agents*, ACL 2024, Snap Research), `data/locomo10.json`, CC BY-NC 4.0. It has 10 long two-person conversations: **5,882 turns**, 19–32 sessions each, spanning 6–12 months, with about 900 shared photos (URL plus BLIP caption). Its personas derive from Meta FAIR's Multi-Session Chat. We treat each conversation as one friendship: one speaker is the friend, the other plays "you". The file lives only in `data/private/datasets/` and is never committed or deployed.

## Pipeline

1. **Offline preparation** (`npm run profiles:build -- data/private/datasets/locomo10.json --write`)
   - Meta **muse-spark-1.3** reads every session once (301 batches, checkpointed so reruns are free).
   - It extracts typed, verbatim-grounded relations about each friend: `enjoys` (hobbies they do), `pursuing` (ongoing goals), `planned_together`, `owns`, `dislikes`, `recommended`, and the rest.
   - Each relation carries an **AI-made topic** ("pottery"), **visual cues** ("clay bowl, pottery wheel, kiln"), and **importance** (0–1).
   - Entries not in the friend's own words are dropped (e.g. a friend congratulating you on *your* adoption plans).
   - Repeats merge, and importance grows with repetition.
   - **Only the quoted evidence messages** plus the prepared memory are written to the backend, for the dataset owner account. The other ~5,500 messages stay offline.
2. **At scan time** (unchanged flow, one vision call)
   - Meta **muse-spark-1.1** identifies the object *and* classifies it into the memory's topics, each with a confidence.
   - It receives only topic names and cues, never messages or people's names.
3. **Propose → verify.** Existing rules exclude invalid reasons first. Every remaining friend then gets a **score**, and the best must clear `MATCH_THRESHOLD` (0.45). If the winner was reached through a topic (not an exact title) and scored below 0.70, a second fast Meta call checks, using the friend's quoted words, that *this specific thing* would genuinely remind someone of them. If it wouldn't, the answer is **no one**. The app shows "Recognized as …", each friend's confidence bar, and the check's one-line reason.

## What makes a match (all measured on this dataset)

- **Topic match:** the fast model's confidence that the photo belongs to a topic ("clay bowl" → pottery 0.95).
  - Halved when it flags the object as *generic* rather than iconic (a stapler → "career").
  - Reduced when many friends share the topic, like IDF weighting (walking is held by 4 friends; pottery by 1).
- **Same-category word matches** ("a book" vs. someone's "fantasy books") count as weak evidence (0.5). **Exact title matches** (*War and Peace*) are certain and skip the check.
- **Score** = match × kind of reason (plan 1.0 … enjoys 0.8 … owns 0.6) × importance to the friend × recency × caveat penalty.

## Results (September 26, fast vision `muse-spark-1.1`, memory `muse-spark-1.3`)

Profile build: 301 calls, about 21 minutes, 1.1M input / 0.9M output tokens. The result is **352 relations across 238 topics** for 10 friends, citing **535 evidence messages**.
- 426 extracted entries were dropped for not citing the friend's own words.
- The verification pass removed about 85 more that described the other speaker.

**Evaluation** (`npm run profiles:eval -- --split … --judge`). Each case is a photo a friend shared, as its caption (these captions were excluded from preparation), labeled with that friend. Unrelated everyday objects should match no one. The labels are a proxy: a painting Melanie shared might equally remind you of Sam, who planned a painting session. So an independent Meta 1.3 judge also rates whether each shown suggestion is sensible.

| Split | Right friend | Accuracy when it answers | In top 3 | Unrelated objects matched | Judged sensible | Keyword baseline (right / accuracy when it answers) |
|---|---|---|---|---|---|---|
| Dev (tuned on) | 45% (36/80) | 57% | 64% | 2/12 | 75% | 15% / 23% |
| Test, first look | 43% (34/80) | 56% | 59% | 1/12 | 76% | 16% / 23% |
| Test, after later fixes | 48% (38/80) | 66% | 64% | 0/12 | 72% | 15% / 21% |
| **Final (untouched, run once)** | **42% (31/73)** | **58%** | **55%** | **1/12** (judged sensible) | **74%** | 11% / 20% |

Read it as: about **4× the keyword approach**, and **about 3 in 4 suggestions are sensible** to an independent judge. Only about **1 in 12** everyday objects triggers anything, and that one was judged reasonable. The hardest cases are friends who share interests: James's dogs and video games overlap with three other friends. Photos of people or generic scenes usually (correctly) get no one.

**What we changed while testing, and why:**
- The classifier kept picking "photography" because captions say "a photo of…". It now classifies the subject, not the medium.
- Category word matches had full confidence and overrode the classifier ("a book" → every book Tim ever mentioned). They're now weak evidence.
- Entries that described the other speaker ("How did you get into watercolor?") got a verification pass.
- The merge step kept only the latest quote ("I sold my car") and misrepresented long passions. It now keeps the strongest quote plus the latest.
- One ungrounded quote made the whole memory invalid. The builder now runs the app's own quote check before writing.
- Rate limits (HTTP 429) caused errors. The model client now waits before retrying.

**Live app path** (real images through `/api/scans` as the dataset owner, local server, two rounds):
- Wingspan → Tim (board games) / Andrew (the birdwatching you planned)
- Scythe → James (strategy games)
- *War and Peace* and *Anna Karenina* → Tim (books)
- Coffee bag → Jolene (your coffee date plan)
- Water bottle → Sam (health routine) / no one

Time per scan: **2.3–3.8 s** without the check, **4.5–9.5 s** with it (the check adds 1.2–4.6 s). Meta's response time varies a lot between runs. These are manufacturer/synthetic images on a laptop, not phone captures.

## Try it

1. `npm run profiles:build -- data/private/datasets/locomo10.json --write` rebuilds from checkpoints (about 10 verification calls) and loads the dataset owner account.
2. Sign in as the dataset owner (`DEMO_ADVISOR_EMAIL`, logins in `data/private/DEMO_ACCESS.md`) and hover over things: a board game, a book, coffee, a guitar amp, running shoes, a dog toy…
3. Or run `npm run profiles:live -- --app http://localhost:3001 photo.jpg …` for scores and timings.

## Limits

- Captions stand in for photos in the evaluation. The live image path is checked on a handful of images, not a benchmark.
- LoCoMo conversations are LLM-generated; real chats are messier.
- Scores and weights are hand-set and calibrated on this dataset, not learned.
- The second check is a fast model's judgment. It rejects most loose matches but can also reject good ones.
