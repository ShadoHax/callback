# Target-driven AR

## Contract

The matching system chooses the target. This module locates that physical object and follows it. It does not pick a person, reread messages, or replace the matching algorithm.

```tsx
import { TargetAR } from "@/components/ar/target-ar";

<TargetAR
  target="coffee"
  connection={{ personName: match.personName, reason: match.reason, onOpen: openExistingConnection }}
/>
```

`target` can change as the matcher updates; changing it immediately invalidates the previous detection. When used without the playground’s editable field, detection starts automatically when the image/camera is ready or the target changes. `initialImageUrl` optionally supplies an image already captured by the caller. `/glasses` is an independent camera/photo test page with an editable target field. No login or API key is needed for the local vision path.

## Actual implementation

- **Detection:** TensorFlow.js COCO-SSD `lite_mobilenet_v2`, running in the browser on WebGL with CPU fallback. The caller's target filters detections; coffee / coffee cup / coffee mug map to the model's `cup` class. This identifies the container, not proof that its liquid is coffee. It also supports the detector's other object classes, including books, bottles and laptops. Unknown concepts return unsupported; multiple matching cups return ambiguous rather than choosing arbitrarily. No coordinates are hard-coded for the example.
- **Tracking:** OpenCV.js 4.12 Lucas–Kanade optical flow. Seed up to 80 feature points inside the detected box; check forward/backward flow consistency; use robust translation from surviving points. Reject insufficient features, unstable motion, frame-size changes, and offscreen boxes. Lost targets have no highlight until redetected. This version follows translation; large rotation, zoom, occlusion and scene cuts need reacquisition.
- **Rendering:** The full camera frame/photo uses `object-fit: contain`. Normalized image coordinates are mapped through the exact aspect-ratio and letterbox offsets. The outline therefore follows the cup's location, including off-center positions. A small optional connection card is placed beside the resulting box.
- **Performance/privacy:** Detection runs on request, optical flow runs locally at up to 20 updates/second on frames capped at 640 pixels. Frames are never uploaded by this module. First use downloads the detector weights and OpenCV runtime; warm the page before the demo. No Meta or OpenAI calls are required for these steps. Existing matching can continue using Meta independently.
- **Distribution:** `predev` / `prebuild` copy OpenCV from the pinned npm package into ignored `public/vendor/opencv.js`; no runtime binary or user photo is committed. Model weights use the TensorFlow model's standard download URL.

## Verified example

The user's breakfast photo (`intro-1659471131.jpg`) is copied only into ignored `data/private/ar-target/coffee.jpg`. In development `/glasses/preview` loads it into the SAME target detector, not a recorded response or illustrated mock. Enter coffee or coffee cup and press Find target. Test motion pans the actual image through the same OpenCV tracker; it is explicitly labeled simulated camera motion. The preview route returns 404 in production.

Observed in the desktop browser: coffee selected the mug with a 98% detector score; the first measured inference after loading was 371 ms. A subsequent warm `coffee cup` inference measured 50 ms. One simulated-pan tracking update measured 6.9 ms. These are observed samples, not phone latency guarantees. Laptop correctly produced no detection on this photo. Browser rendering confirmed the outline matches the actual cup and handle.

## Before demo

1. Merge this isolated branch into the finished matcher branch; pass its chosen physical target and existing connection action into `TargetAR`.
2. On an HTTPS deployment, load the model once on each actual demo phone. Check rear camera permissions.
3. Rehearse coffee/cup detection, slow panning, a lost-target/reacquisition case, and an absent object.
4. Use a supported physical class as the visual target (e.g. `book`), retaining exact title/person/evidence in the matching result. The local model cannot identify arbitrary product editions or landmarks.

References: [TensorFlow.js COCO-SSD](https://github.com/tensorflow/tfjs-models/tree/master/coco-ssd), [OpenCV.js optical flow](https://docs.opencv.org/4.x/db/d7f/tutorial_js_lucas_kanade.html).

## Anchored connection and shopping cards

Saved object scans now have an **AR view** link (`/glasses?scan=<uuid>`).
The authenticated scan endpoint supplies the photo, observed object, and actual
friend/reason. Unsupported detector classes produce an explicit explanation.
`TargetAR` accepts `connection` and optional `shopping: ArShoppingState` so the
matcher can reuse the overlay without owning any tracking code.

`containImageRect` computes the actual visible image, including letterboxing.
`layoutAnchoredCards` stacks the cards beside the tracked box, tries right, left,
below, then above, and shrinks/scrolls content when no full stack fits. Labels
never use the black letterbox area as available image space. At extreme sizes
they may overlap the object rather than leave the frame. Cards vanish on tracking
loss. This is 2D image tracking, not depth-aware or world-anchored spatial AR.

Shopping uses the discovery endpoint and ranking from `origin/codex/native-sms-only`.
The client fetches once per saved scan/purpose, independently of tracking frames;
old requests are aborted and stale responses ignored. Wishes/preferences use a
gift purpose, shared plans use together. Inspiration alone never triggers a sale.
`?shop=self` explicitly enables shopping for yourself. Ownership/current-context
checks stay on the server. The first ranked offer is a **top match**, not a claim
of the cheapest or best product on the internet. Links may lead to comparison
pages; verify exact variant, price and availability there.

Configure SEARCHAPI_API_KEY or SERPAPI_API_KEY for priced live search (optional
Best Buy/Kroger providers remain available in the imported service). Without a
provider, show an honest Google Shopping search link, never a fabricated price.
No provider credentials are included in browser code. The development-only
`/glasses/preview` uses the private coffee photo with clearly labeled synthetic
friend context and a search link, not a claimed live merchant offer.
