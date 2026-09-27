# Hosted real-photo scan check — September 26, 2026

The deployed scanner at `https://callback-khaki-phi.vercel.app/` was tested with six real photos from Wikimedia Commons. [Fixture credits and labels](../fixtures/web-live-photos/README.md) record each source and license. A signed-in, headless Chrome session uploaded each file through the page's actual file input. Chrome DevTools Protocol `Network` events measured the browser phases, and the saved scan supplied server stage timings. This was a desktop browser run using photos of physical objects; it was not an Android camera or cellular-network benchmark.

| Photo | Hosted result | Browser scan request | Vision stage | File upload |
| --- | --- | ---: | ---: | ---: |
| Diet Coke and Coke Zero on a Target shelf | Agarwal / prefers / observed | 4.116 s | 3.584 s | 64 ms |
| Mixed soda store shelf | Alan / prefers / related | 8.582 s | 8.076 s | 40 ms |
| Grocery coffee bags | Maya / prefers / related | 5.826 s | 5.470 s | 2 ms |
| Light-roast ground-coffee pod | Maya / prefers / related | 4.548 s | 4.080 s | 54 ms |
| Physical *War and Peace* book | Maya / inspired | 6.789 s | 6.401 s | 1 ms |
| Black desk stapler | No match | 3.639 s | 3.081 s | 3 ms |

All six requests returned HTTP 200 and a terminal scan result. The median browser scan request was **5.187 s** (range 3.639–8.582 s). The median vision stage was **4.775 s** (range 3.081–8.076 s), averaging **91%** of request duration. Browser work between selecting the image and starting the request took 101–216 ms. Chrome's upload phase took 1–64 ms. The browser received the streaming response headers in 152–362 ms, then waited 3.277–8.297 s for the remaining stream. The vision stage includes provider/network wait and cannot be separated into model inference and provider queue time by this instrumentation.

The coffee cases were initially labeled `no_match`, then reviewed against the app's intended category-level connection policy. Their saved results have `preferenceMatch: "related"`, and the UI says the photographed variety is not confirmed to match Maya's whole-bean pour-over taste. The regraded result is **6/6 passing** under that explicit related-taste contract; the first report with the initial labels remains in the ignored `data/private/live/` folder. This is a label review of saved scans, with no additional model calls.

The mixed soda shelf also returned a **related** zero-sugar-soda memory, not a confirmed product match. This is relevant to grocery browsing: the current hover controller waits for a steady view, has a 3-second cooldown between different views, and caps a session at 12 automatic checks before an explicit resume. It remembers visual frames, so a different angle of the same product can still trigger another scan. Hover scan results do not trigger the app's vibration alert; incoming messages use that alert. Product-level notification frequency across different views is not tested or implemented here.

To reproduce, fetch the real photos and run the browser check as described in [the fixture README](../fixtures/web-live-photos/README.md). The detailed local reports are `data/private/live/browser-perf-2026-09-26T20-35-32-193Z.json` (initial labels) and `data/private/live/browser-perf-regraded-2026-09-26T20-39-03-624Z.json` (reviewed labels). Neither report contains credentials, cookies, images, or quoted messages.
