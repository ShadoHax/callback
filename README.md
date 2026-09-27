# Callback
## Inspiration

Our conversations contain countless small promises and personal details: “we should bake this,” “this book inspired me to write,” or “let's catch up over coffee.” We care, but those moments get buried in old chats. Callback started with one question: what if seeing an object could bring back the right shared memory at the right time?

## What it does

Callback connects objects in the camera view to source-backed memories from past conversations with friends to help reconnect. Callback recognizes an object, checks it against prepared relationship memories, and attaches a small card to the object. Tapping the card reveals the person, the original message, and relevant actions.

For example, bananas can recall a plan to bake banana bread with a friend, while a coffee cup can recall a plan to catch up. The user can then request a recipe, create a plan, find nearby places, or search for supplies.

## How we built it

Meta Muse Spark prepares structured relationship memories from approved messages, including topics, visual cues, plans, preferences, cancellations, and source citations. A faster Muse Spark vision model identifies objects during the live camera experience.

OpenCV.js and TensorFlow.js help track objects and stabilize the AR overlay. Motion gating waits for a steady frame, requests run one at a time, and late results are discarded if the camera has moved.

The app is built with Next.js, React, TypeScript, Supabase, PostgreSQL, and Tailwind CSS, and is deployed on Vercel. Nearby suggestions use grounded Meta web search. Shopping uses public SearchApi listings, while Stripe Checkout runs in test mode to simulate transactions.

## Challenges we ran into

The hardest problem was not recognizing an object, it was deciding whether that object was truly relevant to a specific person. Messages can describe somebody else's wish, an outdated plan, or an exact item that the camera cannot confirm. We combined AI interpretation with strict evidence rules to avoid overclaiming.

Live AR created another challenge: the user may move while inference is running. We added frame comparison, serialized requests, object tracking, smoothing, and stale-result rejection so an old answer is never attached to a new scene.

## Accomplishments that we're proud of

We built a working AR experience that connects the physical world to meaningful moments from real relationships. Instead of simply identifying what the camera sees, Callback understands why an object might matter and gives the user a natural way to act on that connection.

## What's next for callback.

The next step is integrating Callback with Meta's glasses and broader ecosystem. Instead of pulling out a phone, users could receive subtle, context-aware reminders as they naturally move through the world, making meaningful reconnection even more seamless.

