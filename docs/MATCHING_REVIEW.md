# Review of Claude's profile matching work

September 26, 2026. Reviewed `050603d`, `3789d08`, and `a77baf4` on `claude/profiles-classifier`. Scope: a credible hackathon demonstration and accurate technical explanation. Presentation guide: [JUDGE_NOTES.md](JUDGE_NOTES.md).

## Verdict

Keep the profile architecture. It gives the project a stronger semantic connection story than matching only product names. Freeze the evaluation effort for now and prove the chosen human interaction. The pasted Claude transcript predates the final fixes and evaluation.

The branch is separate from `main`; production still reports Meta 1.2 vision / 1.3 memory, while the branch's recorded profile image experiments used 1.1 vision. Do not assume the open Vercel tab contains this work. The profile index format is `profile-v10`, versus the live older format; prepare the correct account only on the matching build.

## Independently verified facts

| Item | Saved evidence |
|---|---|
| Corpus | 5,882 synthetic turns across 10 conversation pairs |
| Extraction checkpoints | 301 batches; not proof of exactly 301 total paid calls |
| Final prepared profile | 352 relations, 238 topics, 535 evidence messages |
| Final caption evaluation | 73 positive cases + 12 curated negatives; zero recorded errors |
| Correct labeled friend | 31/73 (42.5%); keyword baseline 8/73 (11.0%) |
| Correct among answered positives | 31/53 (58.5%); 22 wrong-label answers, 20 abstentions |
| Negative suggestions | 1/12; too few cases for a general false-positive estimate |
| Separate model's sensible rating | 40/54 suggestions (74.1%); not human validation |

The earlier 390-entry/265-topic counts are not the current saved artifact. The old 18 rate-limit failures were real, but the final artifact has none. Backoff is implemented: the model client waits 1.5 seconds before its 429 retry, and the evaluation has additional bounded waits.

The topic limit is now 300, which includes the current 238 topics; the earlier 150-topic truncation is no longer present.

## Findings and disposition

1. **Fixed: broad topic bypassed exact identity.** Root reproduced an unidentified generic book producing a specific War and Peace recommendation at score 0.81, high enough to skip the second check. Topic-derived exact-title memories now require a confirmed matching primary or secondary title. Regressions cover books, Diet Coke recommendations/preferences, and correctly visible secondary products. Broad hobby/goal reminders remain available.
2. **Clarified: scores and rejected suggestions.** The UI displayed hand-weighted scores as percentages, and a verifier rejection incorrectly said nobody cleared the score threshold. It now labels match scores out of 100 and explains when the extra check held a suggestion back or was unavailable.
3. **Known builder issue, deferred.** Consolidation groups by person/relation/topic, so distinct exact titles sharing a topic can collapse into the latest entry. Do not rebuild the large profile as a demo preparation step without reviewing this. Keep verified hero evidence intact. This is a retention bug, not a reason to replace the architecture.
4. **Known verifier tradeoff.** If the second model call errors, the original scored suggestion is still shown. This is now explicit in the card. Do not claim every displayed suggestion passed verification. A rejected winner also does not trigger checks of every runner-up.
5. **Timing/accounting nuance.** Profile verification adds another call using selected quotes. `relationsMs: 0` only means no full relationship extraction; it does not mean no text is processed. The extra time is in `result.verification.ms`; current browser logging does not provide that second call's full provider/token breakdown. Existing one-call/photo-only pitch language does not describe every profile scan.

## How far to trust the evaluation

The evaluator classifies descriptions, not pixels. Captions are withheld from profile extraction, but the surrounding conversation text remains available. All splits reuse the same ten friendships; split image indices differ, but a few caption strings repeat. One friend has only one final positive case. The exact label is the friend who shared a photo, which is a useful proxy but not the only plausible social association.

The baseline counts literal overlap with stored item mentions, whereas the proposed pipeline has model-generated topics and cues. The improvement is useful evidence against that simple baseline, not a claim to outperform a strong retrieval system. The separate judge is another Meta model that sees the chosen reason and evidence; calling it independent human evaluation would be wrong.

No full paid evaluation or corpus rebuild was run during this review. Reported metrics belong to Claude's saved pre-review run, not to the newly patched guard. Verification after the patch: 415 tests across 57 files passed, along with lint, TypeScript, the production build, and the release secrets check. Root independently reproduced the identity bug before the fix.

Private evidence (not committed): `data/private/profiles/profile.json`, `data/private/profiles/eval-final-2026-09-26T21-43-58-404Z.json`, and the raw checkpoint directory. Public data provenance: [LoCoMo repository](https://github.com/snap-research/locomo).

## Demo acceptance gate

Use one specific social story, one optional purchase story, and one negative object. Do three full camera → evidence → send → real reply runs on the selected account/build, record one, and stop adding features. If the new profile branch does not pass that gate, use the verified small-memory build for the live interaction and show the profile work as a labeled technical experiment.
