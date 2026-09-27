# Personal messaging: what works and what remains

The native share sheet is the recommended demo path: **scan → review/edit → choose personal app → select your friend → send → friend replies in that app**. The recipient does not need Callback. Choosing an app does not prove a message was sent, delivered, or read.

## Three paths

| Path | What it does | Setup and limits |
|---|---|---|
| Choose a personal app | Passes only the edited message to the device share sheet; copies it if sharing is unavailable | No provider credentials or recipient Callback account. Available apps depend on the device and whether they accept text. Photo and source quote are not attached. Replies remain external. |
| Text from my number | Authorizes the current scan/contact, then opens the phone's native Messages composer addressed to that person | Requires a private owner-scoped phone mapping and currently a linked contact account. iPhone copies the draft for manual paste; if clipboard is denied, manually copy the visible draft. Android may prefill text. Callback never sends it; you review it and press Send in Messages. |

The personal app chooser is not an Instagram/WhatsApp API integration. It does not choose a social recipient or import replies. Callback's existing inbox remains available for its photo/evidence/reply flow. The external options currently appear in the individual composer, not the group composer or an already-open Callback conversation.

## Private setup for addressed SMS

In ignored .env.local and server-only hosting settings, set SMS_RECIPIENTS_JSON to a nested object: scanner account UUID → person ID → E.164 mobile number. Use the exact scanner and contact IDs from the private demo setup. Do not use a global map keyed only by a name such as “friend”; different owners can use the same person ID.

Redeploy after changing hosting settings. The compose route checks authentication, ownership, a matched scan, current context revision, and current contact mapping before returning a phone number. A changed story requires a fresh scan. There is no server SMS provider: the app only constructs a native `sms:` link. The ordinary personal-app chooser does not need this mapping at all.

## Two-phone proof

1. Use the deployed HTTPS site on the scanner phone. Open a fresh match and edit the draft into your own words.
2. Choose a personal app. Select the consenting teammate and verify the destination and exact text before pressing Send yourself.
3. On the other phone, receive it and type a natural reply. Show the reply in the messaging app; do not claim it appeared in Callback.
4. Cancel the share sheet once. Callback must not claim delivery. Try the copy fallback too.
5. For addressed SMS, verify the right number. On iPhone, test paste, clipboard denial, and returning to Callback; on Android, check the actual messaging app's prefill behavior.
6. Change the demo context and try the old scan's addressed SMS control: it must require a new scan. Test an unconfigured contact: no phone number is exposed.

Desktop/unit tests can exercise authorization, URLs, and state changes. They cannot establish which share targets are installed or actual phone-to-phone delivery. No real SMS or social message was sent during the code review.

References: [Apple SMS URL documentation](https://developer.apple.com/library/archive/featuredarticles/iPhoneURLScheme_Reference/SMSLinks/SMSLinks.html), [Web Share API behavior and activation requirements](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).
