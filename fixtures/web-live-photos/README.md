# Real-world live-scan photos

These are photos of physical objects, downloaded as 1280-pixel Wikimedia Commons thumbnails on 2026-09-26 by `node scripts/fetch-web-photo-fixtures.mjs`. The downloaded bytes go to ignored `data/private/live/web-photo-fixtures/`; this folder holds only the manifest and credits. The photos were visually inspected before labeling. They are not AI-generated and were not altered locally. Wikimedia's thumbnail service resized the source photos. No people, messages, or credentials are in these files.

| Fixture | Subject and test intent | Credit and license |
| --- | --- | --- |
| `grocery-diet-coke.png` | Diet Coke and Coca-Cola Zero on a Target shelf; Diet Coke should connect to Agarwal's stated preference | [Ben Schumin, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Diet_Coke_and_Coca-Cola_Zero_bottles_at_Target_(50871079092).png), [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |
| `grocery-soda-shelf.jpg` | Mixed soda shelf with Coca-Cola and Coca-Cola Light; exploratory because the product name varies by market | [Anselm Schüler, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Soda_bottle_shelf.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `grocery-coffee-bags.jpg` | Store coffee packages marked for cafetière grind; a related coffee memory is allowed, but the exact preference is not confirmed | [Jmcronald, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Supermarket_Coffee_Bags.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `light-roast-coffee-pod.jpg` | A light-roast flavored ground-coffee pod; a related coffee memory is allowed, but the exact whole-bean preference is not confirmed | [TaurusEmerald, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Gold_Emblem_French_Vanilla_Light_Roast_Coffee_Pod.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `war-and-peace-book.JPG` | A photographed copy of *War and Peace*; should connect to Maya's writing ambition | [Liannadavis, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:War_and_Peace_book.JPG), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `desk-stapler.jpg` | A plain desk stapler; should find no connection | [DifrancoBarnes, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Staplerblack.jpg), [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |

Run the actual Chrome upload and DevTools Network timing check with a provisioned demo scanner account:

```powershell
node scripts/fetch-web-photo-fixtures.mjs
node scripts/live-browser-perf.mjs --dir data/private/live/web-photo-fixtures --cases fixtures/web-live-photos/cases.json --provenance "Wikimedia Commons real-world photos; credits in fixtures/web-live-photos/README.md"
```

Set `DEMO_SCANNER_EMAIL` and `DEMO_SCANNER_PASSWORD` in the process environment before running. The check makes actual saved scans on the hosted site and writes a sanitized local timing report under `data/private/live/`. It does not send messages or make purchases.
It uses Chrome DevTools Protocol with the standard Windows Chrome path; set `CHROME_PATH` if Chrome is elsewhere.

The coffee examples were initially labeled `no_match`. After the live run, we checked the scanner's intended `related` preference behavior and relabeled them as related matches. The UI explicitly says the photographed product is **not** confirmed to fit Maya's taste. The original run report remains in `data/private/live/`; the regraded report records this label review without new model calls.
