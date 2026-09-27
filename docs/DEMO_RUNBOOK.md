# Callback demo setup

Use [PHONE_PRACTICE.md](PHONE_PRACTICE.md) to rehearse and [PRESENTATION_NOTES.md](PRESENTATION_NOTES.md) to present. The chosen story is **War and Peace → Maya's writing ambition → invitation → real reply (M1)**, followed by **coffee → Maya's stated taste → buyer-chosen coffee gift → approved Stripe TEST checkout (V3)**. Two participants are enough.

## Software preparation

1. Run the app over HTTPS. The existing Supabase/Vercel setup is documented in [DEPLOYMENT.md](DEPLOYMENT.md).
2. Use the private **Alex** scanner and **Maya** recipient accounts. Check that the `maya` contact ID maps to the recipient account.
3. Confirm the eight labeled synthetic messages in `fixtures/synthetic-demo.json` are loaded. The `inspired` book link and `prefers` coffee taste are implemented. Context is explicitly imported; the prototype does not automatically read social or messaging accounts.
4. Switching imported stories needs an explicit account-scoped migration or a fresh demo account. Import currently upserts; **Reset demo updates** only removes temporary synthetic updates and does not replace the old imported story.
5. Wait for prepared memory, then run the two-phone and checkout steps in the phone guide. A CLI import in an open scanner session needs Refresh memory or a reload. A book-to-pen/notebook gift remains a separate proposal; it is not in the current catalog or demo path.

## Verified foundation

- Current hosted checks with synthetic rendered images and scripted replies found Maya for *War and Peace*, Sam for *Anna Karenina*, Maya's taste for coffee, and no connection for a bottle (4/4). Book and coffee hover passed 15/15 each; shopping passed 14/14. These checks do not measure physical-camera recognition or a human reply.
- A **$23.11 coffee gift Stripe TEST payment** completed, and the paid session, saved order, and webhook record were checked. Payment on a physical phone remains unverified. The earlier **$75.54** game payment is historical test coverage, not the selected demo purchase.
- The verified hosted demo used Meta muse-spark-1.1 for vision and muse-spark-1.3 for prepared memory. The coffee catalog and buyer-chosen taste gift are implemented. The book-to-pen/notebook gift is not.
- Native SMS opens the user's texting app and has no delivery confirmation in Callback. For the two-phone demo, use Callback's authenticated send/reply path and verify receipt on Maya's phone.

Keep historical technical measurements in [HOVER.md](HOVER.md) and [PROGRESS.md](PROGRESS.md), not in the spoken demo. Current work order: [NEXT_STEPS.md](NEXT_STEPS.md).
