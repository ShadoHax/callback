# Callback presentation notes

**Current guide:** [JUDGE_NOTES.md](JUDGE_NOTES.md) covers the profile branch, rubric, technical wording, and demo finish line. The script below describes the earlier small-memory setup; do not mix its one-call claims with the new conditional verification path.

**Story (implemented; hosted checks use synthetic images and scripted replies):** Alex sees *War and Peace* and remembers Maya said it inspired her to try writing a novel. Alex asks how it's going, and Maya replies (**Meta, M1**). Later Alex sees coffee, remembers Maya likes light-roast whole beans, and chooses a gift matching that taste with an explicitly approved TEST payment (**Visa, V3**). The real two-phone exchange still needs rehearsal.

Live checks used synthetic images, fictional messages, and scripted replies: book → Maya in about 1.6 s, coffee → Maya, *Anna Karenina* → Sam, water bottle → no one, and a coffee TEST payment paid and verified with Stripe. **Real phones and a real human reply still need to be recorded** ([PHONE_PRACTICE.md](PHONE_PRACTICE.md)).

## Three team roles

- **Presenter:** tells the human story and keeps time.
- **Phone A (Alex):** points the camera, shows the evidence, sends, and approves the gift.
- **Phone B (Maya):** receives it and types a real reply.

## Meta: about 2 minutes

| Time | Say / show |
|---|---|
| 0:00–0:20 | "My friend Maya told me War and Peace made her want to write a novel. I meant to follow up. Then it got buried in the chat, like everything does." |
| 0:20–0:40 | Hold the book up and keep still. Wait for the actual card: *"War and Peace inspired Maya to try writing a novel."* "I didn't scan a barcode or tag anything. It recognized the book and remembered what it means to Maya." |
| 0:40–1:00 | Tap the card. Show Maya's own words, then the **ruled-out** list: Priya (didn't like it), Jordan (his sister's wish, not his), Leo (only a general interest). "It knows who this book matters to, and who it doesn't." |
| 1:00–1:20 | Send the suggested note: "Saw War and Peace and remembered it inspired you to try writing a novel. How's it going?" "I choose the words and whether to send. Nothing is automatic." |
| 1:20–1:50 | Maya replies for real on Phone B. Agree on a writing session. **Give this moment the most time.** |
| 1:50–2:00 | "The AI remembered what mattered to Maya. The conversation is entirely ours." |

Optional live proof it isn't a trick: hold up *Anna Karenina* and it finds **Sam**, who recommended it. Or add Maya's "I stopped writing it" in demo controls, and the book finds no one ("a newer message says that's off").

## Visa: about 1 minute

| Time | Say / show |
|---|---|
| 0:00–0:15 | Hold up the coffee. Card: *"Maya told you they like 'light-roast whole beans'."* |
| 0:15–0:40 | Open **"A gift Maya would actually like?"** with a $25 budget, including shipping and tax. Best fit: Ethiopia Yirgacheffe, $23.11, "Fits what Maya said: light roast, whole bean." Dark roasts are excluded *in her words*, and the sampler is over budget. |
| 0:40–1:00 | Review the full total, **Approve $23.11 and pay (test)**, use card 4242, and show the paid TEST receipt. "I chose the gift. Callback matched the traits Maya mentioned and kept the purchase within my budget. Nothing is paid until I approve." |

Say **demo merchant, demo prices, Stripe test mode**. This is Stripe TEST checkout, not a Visa Intelligent Commerce integration.

## Why AI is essential (the 30-second technical answer)

"Meta muse-spark-1.3 extracts relationships from approved messages ahead of time, with source citations. When you point the camera, muse-spark-1.1 identifies the image; code checks the prepared relationships, later updates, and whose words they are. A warm hover scan needs no model call to reread the chats. You can inspect the evidence and choose whether to reach out. Our demo catalog has explicit product traits; the AI extracts the friend's preferences from informal language."

Numbers, model table, and research framing: [AI_TECHNICAL_STORY.md](AI_TECHNICAL_STORY.md).

## Judge questions

- **Who is it for?** People who care about their friends' plans and ambitions but forget to follow up.
- **Does it message people for me?** No. It drafts; you edit and send. The friend's reply is theirs.
- **Privacy?** Only messages you import are used; memory is private to your account; vision sees only the photo, never your chats.
- **What if the AI is wrong?** Suggestions show original evidence. Code checks citations and item words, but the model can still misclassify or omit a relationship. The user reviews the source, edits, and decides whether to send.
- **Why phones, not glasses?** Phones let us demonstrate steady-view capture, a confirmed person chip, evidence review, and a real reply. Glasses are a possible later interface, not a verified feature.

## Practical limits and fallback

- Timing varies by image and request; earlier synthetic-image runs were about 1.6s for the book and 3.3–5.4s for coffee. Quote the recorded results for the demonstrated build. Phone timing remains to be measured; do not claim "instant" or "faster than a QR code."
- If Wi-Fi or recognition fails live, use a **labeled** recording of a successful rehearsal. Never imply a failed beat worked.
- The chats are fictional and labeled as such. The receipt is a TEST payment.
- Preserve the approved shared context; **Reset demo updates** also deletes teammate test sources. Clear only isolated rehearsal data you intended to remove.
