# Callback: judge notes and the demo to finish

September 26. Use this as the current presentation guide; the reviewed profile work is on `claude/profiles-classifier`, not yet merged into the live site's main branch. Pick and rehearse one build before presenting. Review details: [MATCHING_REVIEW.md](MATCHING_REVIEW.md).

## The pitch

**“Callback turns an everyday sight into a reason to reconnect.”**

“My friend told me this book made them want to write a novel. Weeks later, I see a copy in a store. Callback recalls that conversation and helps me ask how the writing is going. That little moment becomes a conversation we would otherwise have missed.”

The product outcome to show is **a specific, welcome message followed by a real person replying**. Let that person suggest a writing session or share an update. Give the reply time on screen. Use an anecdote your teammate volunteers, or label the prepared story as fictional.

## What each judging criterion sees

| Criterion (team-provided approximate weight) | Evidence in the demo | Useful line |
|---|---|---|
| Human connection (~1/3) | An individual goal recalled, a gentle question, a human reply and possible shared activity | “We help someone follow through on something their friend cared enough to tell them.” |
| AI essentialness/integration (~1/4) | Informal chat becomes structured memory; a camera view retrieves a relevant personal story | “AI interprets the conversation and what you see. The evidence and decision rules keep the suggestion grounded.” |
| Originality (~1/5) | Physical-world cues retrieve personal reasons to act, with history and source evidence | “The same object can mean a different conversation for each person.” |
| Execution (~1/5) | Two phones, readable evidence, explicit send, live reply; optional personalized checkout | “Here is the original message, and here is the conversation it started.” |

This is enough scope for a strong hackathon prototype. Do not spend the remaining time building more infrastructure just to describe it.

## The two-minute Meta demo

1. **0:00–0:20 — Establish the person.** “My friend wanted to write a novel after reading War and Peace. I meant to check in.” Show the prepared source briefly if needed.
2. **0:20–0:45 — Point the camera at the book.** A physical cover or clearly identified printed cover is enough. While it runs: “Their conversation was processed beforehand; now we only need to recognize what I'm looking at.” Wait for the actual result; do not promise a fixed latency.
3. **0:45–1:05 — Open the evidence.** Read the friend's own words. Explain one meaningful distinction, such as a shared ambition versus someone else's wish. Do not narrate every diagnostic row.
4. **1:05–1:40 — Send and receive.** “Saw this and remembered you wanted to write. How's it going?” The recipient types a real answer, ideally an invitation or concrete update. A normal human response is stronger than a rehearsed slogan.
5. **1:40–2:00 — Explain the architecture.** Use the short answer below. End with: “The useful result is this conversation.”

Have three clean runs on the exact phones and prop before calling the setup ready. Record one as a labeled backup. Keep the shared source corpus intact; a broad demo reset deletes teammate updates too.

## The technical answer (25–35 seconds)

“We use Meta to prepare a source-backed memory of each friend's interests, goals, and shared plans. It learns topic labels and visual cues from the conversations. At scan time, a vision-language model identifies the scene and matches it to that personal topic vocabulary. We rank the relevant memories using visual fit, the kind of relationship, importance, recency, and how distinctive the topic is among friends. Exact product claims still need exact visual evidence. We can run a second check on weaker suggestions, then show the original words so the user decides whether to reach out.”

If this exceeds the demo slot, shorten to: **“We move conversation understanding ahead of the camera moment. A glance retrieves a relevant memory, and the user turns it into a real conversation.”**

## Technical details worth discussing when asked

| Term | What we actually implemented | Why it matters |
|---|---|---|
| Ahead-of-time semantic memory | Meta extracts typed, cited relations; checkpoints reuse completed offline batches | The camera does not need to process thousands of messages from scratch |
| Personalized topic vocabulary | Topic names and visual cues come from the imported conversations | Recognition can connect an object to a hobby without an exact keyword match |
| Multimodal retrieval | The live model sees the photo plus topic/cue labels; code retrieves the associated source-backed relations | The visual cue and the remembered conversation can use different words |
| Hybrid reasoning | Model interpretation followed by code for citations, identity, attribution, and updates | A broad book topic must not become a claim about a particular title |
| Distinctiveness weighting | Topics shared by more friends receive a smaller weight | A common interest is less useful for choosing whom to contact; this is IDF-inspired, not a learned retriever |
| Selective verification | A second model checks the winning suggestion when it was topic-derived and scores below 0.70 | Extra reasoning is spent on weaker candidates rather than every exact match |
| Incremental preparation | Valid derived facts can be reused; changed context triggers preparation | Separates the preparation cost from the live interaction |

These terms explain real mechanisms. No vector database, model training, fine-tuning, formal knowledge-graph engine, or custom foundation model is necessary to tell this story. Scores are hand-weighted ranking scores, not calibrated probabilities.

One important nuance: the profile vision call **does receive memory-derived topic labels**, so do not claim it is completely independent of context. It does not receive the raw chat history or the names of friends. The optional verification call receives selected quotes. Some scans therefore use **two calls**, not one.

## Evidence for the technical follow-up

“We also tried the memory builder on 5,882 turns from ten synthetic long-conversation friendships, producing 352 cited relationship entries over 238 topics.”

That is the cleanest scale statement. The saved profile retains 535 evidence messages; it is not an online full-history import. There are 301 extraction batch checkpoints, with additional verification/retry calls, so avoid calling 301 the total API usage.

If asked about evaluation: “Our final caption-based proxy test selected the sharing friend in 31 of 73 cases, compared with 8 of 73 for a simple keyword baseline. It suggested someone for one of twelve deliberately unrelated descriptions. We still evaluate actual camera behavior separately.” These are development results from before the review's new exact-title guard; they have not been rerun for that change.

Keep the score table in backup material. **74% judged sensible means 40/54 suggestions were approved by another model**, not 74% human satisfaction or camera accuracy. It is useful diagnostic evidence, not the opening claim.

Research connection: [LoCoMo](https://github.com/snap-research/locomo), from the ACL 2024 long-term conversational-memory work, supplied the conversation data. We constructed our own caption-to-friend task on it; we did not achieve a published LoCoMo benchmark score. Its repository documents agent-generated conversations and image captions.

## Visa continuation (45–60 seconds)

Use the separate **coffee taste → suitable gift** path. “They told me they like light-roast whole beans. That context helps me find a gift they'll actually use.” Show a suitable option, a rejected mismatch, the full total, and explicit approval of the existing Stripe TEST checkout.

Frame it as **discovery from personal context → easier comparison → fewer steps to act**. The coffee in the camera can be a reminder to find a better-fitting gift; it need not itself match the preference. Explain that distinction naturally. Keep the purchase optional so Meta's story remains centered on the person.

Only claim the commerce integration that is present: the existing demo merchant/Stripe TEST flow. Do not imply a Visa-specific API integration or a real charge. Book-to-pen gifting remains an idea, not this implemented purchase flow.

## What to finish, then stop building

- Choose the exact build and account. The small social demo and the large LoCoMo profile account are different setups; the large account is not automatically wired to ten real inboxes.
- Verify the two core stories on actual phones: writing follow-up + reply, and coffee gift + TEST receipt.
- Add one clearly unrelated prop as a negative check. Use a profile-based semantic example only after it works repeatedly on the chosen build; do not improvise a random-object accuracy contest.
- Keep the evidence readable, the draft natural, and the recipient ready. Show console timings only if a judge asks about latency.
- Record the successful run, prepare the write-up below, and freeze the demo setup. Defer extra profile rebuilding, threshold sweeps, new hardware, and more tracks.

## Submission write-up

**Who it is for.** Callback is for people who care about their friends' goals and interests but lose small opportunities to follow up as conversations accumulate.

**How it strengthens connection.** Seeing an object can bring back a specific thing a friend said—a plan, an ambition, or a shared interest. Callback surfaces that memory with its source and helps the user start a relevant conversation. The user chooses the message; the recipient responds as themselves. Our demonstration follows a forgotten writing ambition through to a real exchange.

**Why AI is essential.** Friends describe meaningful things in informal language, and the objects we encounter need not repeat the same words. AI prepares structured relationship memory and interprets visual cues against it. Retrieval and explicit rules connect those interpretations to the original evidence, supporting a useful suggestion without requiring the user to pre-tag every object and conversation.
