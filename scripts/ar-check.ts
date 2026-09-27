// Authenticated generic AR rehearsal. Images and credentials stay outside Git.
// The active shopping action discovers live listings; checkout happens at the merchant.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { MIME, need, session, type Session } from "./lib/live";

type Action = "recipe" | "shop" | "nearby" | "plan";
type Args = { action: Action; url: string; images: string[]; order: boolean; expectPerson?: string };
function args(argv: string[]): Args {
  let url = process.env.APP_ORIGIN ?? "http://localhost:3000";
  let expectPerson: string | undefined;
  let order = false;
  let action: Action = "shop";
  const images: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--url" || arg === "--app") url = argv[++index] ?? "";
    else if (arg === "--image") images.push(argv[++index] ?? "");
    else if (arg === "--images") images.push(...(argv[++index] ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    else if (arg === "--order" || arg === "--order-test") order = true;
    else if (arg === "--action") {
      const value = argv[++index];
      if (!["recipe", "shop", "nearby", "plan"].includes(value)) throw new Error("--action must be recipe, shop, nearby, or plan.");
      action = value as Action;
    }
    else if (arg === "--expect-person") expectPerson = argv[++index] ?? "";
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (order) throw new Error("AR shopping now discovers live merchant listings; use the merchant checkout instead of --order.");
  if (!images.length || images.some((image) => !image)) throw new Error("Pass at least one --image path (repeat it), or --images path1,path2.");
  if (expectPerson === "") throw new Error("--expect-person needs a name.");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("--url must be an HTTP or HTTPS app URL."); }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))
    throw new Error("Use HTTPS, or HTTP only for localhost.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("--url must be a plain app origin.");
  return { url: parsed.origin, images, order, expectPerson, action };
}

type Scan = { error?: string; detected?: boolean; matched?: boolean; connectionToken?: string;
  identification?: { item?: string; title?: string; category?: string }; memory?: { personName?: string; sourceIds?: string[]; shortLabel?: string; suggestedActions?: {kind:Action; label:string}[] };
  timingMs?: number; visionDiagnostics?: { model?: string } };
type Activity = { action?: Action; nearby?: {query:string; url:string; usedFallback?:boolean; places?:{name:string;url:string}[]}; supported?: boolean; reason?: string; plan?: { title: string; supportSourceIds: string[] };
  shopping?: {ingredients: {query:string; offers:unknown[];status:string}[]};
  cart?: { totalCents: number; items: { name: string }[] }; checkoutToken?: string; shoppingNote?: string; timingMs?: number; error?: string };
type Order = { status?: string; orderId?: string; receipt?: { amountCents: number; livemode: boolean; shipment: string }; error?: string };

async function postJson<T>(user: Session, path: string, body: object, timeoutMs: number): Promise<T> {
  const response = await user.call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  assert.ok(response.ok, `${path}: HTTP ${response.status}: ${payload.error ?? "request failed"}`);
  return payload;
}

async function scanFile(user: Session, path: string) {
  const type = MIME[extname(path).toLowerCase()];
  if (!type) throw new Error(`${basename(path)}: use JPG, PNG, or WebP.`);
  const fileStat = await stat(path);
  if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > 8 * 1024 * 1024)
    throw new Error(`${basename(path)}: photo must be a nonempty file under 8 MB.`);
  const form = new FormData();
  form.set("image", new File([await readFile(path)], basename(path), { type }));
  const started = Date.now();
  const response = await user.call("/api/demo/ar/scan", { method: "POST", body: form, signal: AbortSignal.timeout(65_000) });
  const payload = await response.json().catch(() => ({})) as Scan;
  assert.ok(response.ok, `${basename(path)}: scan HTTP ${response.status}: ${payload.error ?? "request failed"}`);
  return { payload, roundTripMs: Date.now() - started };
}

async function main() {
  const config = args(process.argv.slice(2));
  const user = await session(config.url, need("DEMO_SCANNER_EMAIL"), need("DEMO_SCANNER_PASSWORD"))
    .catch(() => { throw new Error("Demo scanner sign-in failed; check the account configuration."); });
  const prepareStarted = Date.now();
  const prepared = await postJson<{ ready?: boolean; modelCalls?: number; error?: string }>(user, "/api/context/prepare", {}, 150_000);
  assert.equal(prepared.ready, true, `Prepared memory unavailable: ${prepared.error ?? "unknown reason"}`);
  console.log(`Memory prepared in ${Date.now() - prepareStarted} ms (${prepared.modelCalls ?? 0} model calls).`);

  let failures = 0, matched = 0, orders = 0;
  const times: number[] = [];
  for (const imagePath of config.images) {
    const label = basename(imagePath);
    try {
      const { payload: scan, roundTripMs } = await scanFile(user, imagePath);
      times.push(roundTripMs);
      const item = scan.identification?.title || scan.identification?.item || "unidentified";
      const sourceIds = scan.memory?.sourceIds ?? [];
      console.log(`${label}: item=${JSON.stringify(item)} detected=${scan.detected === true} matched=${scan.matched === true} sources=${sourceIds.join(",") || "none"} label=${JSON.stringify(scan.memory?.shortLabel ?? "")} actions=${scan.memory?.suggestedActions?.map(a=>a.kind).join(",") ?? ""} model=${scan.visionDiagnostics?.model ?? "unknown"} roundTrip=${roundTripMs}ms server=${scan.timingMs ?? "?"}ms`);
      if (config.expectPerson) {
        assert.equal(scan.matched, true, `${label}: no connection for expected person.`);
        assert.equal(scan.memory?.personName?.toLowerCase(), config.expectPerson.toLowerCase(), `${label}: matched a different person.`);
      }
      if (!scan.matched) continue;
      matched++;
      assert.ok(scan.connectionToken, `${label}: matched scan has no signed connection token.`);
      assert.ok(sourceIds.length, `${label}: matched scan has no cited source IDs.`);
      const activity = await postJson<Activity>(user, "/api/ar/activity", { connectionToken: scan.connectionToken, action: config.action }, 90_000);
      assert.equal(activity.action, config.action, "Activity response must identify the chosen action.");
      if (config.action !== "shop") { assert.equal(activity.cart, undefined); assert.equal(activity.checkoutToken, undefined); }
      if (activity.nearby) {
        const maps = new URL(activity.nearby.url);
        assert.equal(maps.origin, "https://www.google.com");
        assert.equal(maps.pathname, "/maps/search/");
        assert.equal(maps.searchParams.get("api"), "1");
        assert.ok(maps.searchParams.get("query"));
        console.log(`  nearby query=${JSON.stringify(activity.nearby.query)} places=${activity.nearby.places?.length ?? 0} fallback=${activity.nearby.usedFallback === true}`);
        assert.ok(activity.nearby.places?.length, "Nearby action must return search-grounded places.");
      }
      if (activity.shopping) {
        assert.equal(activity.cart, undefined); assert.equal(activity.checkoutToken, undefined);
        assert.ok(activity.shopping.ingredients.length);
        console.log(`  shopping ingredients=${activity.shopping.ingredients.length} withOffers=${activity.shopping.ingredients.filter(i=>i.offers.length).length} statuses=${[...new Set(activity.shopping.ingredients.map(i=>i.status))].join(",")}`);
      }
      console.log(`  action=${config.action} activity=${activity.supported === true ? JSON.stringify(activity.plan?.title ?? "plan") : "unsupported"} sources=${activity.plan?.supportSourceIds.join(",") || "none"} cart=${activity.cart ? `${activity.cart.items.length} items / $${(activity.cart.totalCents / 100).toFixed(2)} TEST` : "none"} planServer=${activity.timingMs ?? "?"}ms${activity.shoppingNote ? ` note=${activity.shoppingNote}` : ""}`);
      if (!config.order || !activity.supported || !activity.cart || !activity.checkoutToken) continue;
      const request = { checkoutToken: activity.checkoutToken, expectedTotalCents: activity.cart.totalCents };
      const first = await postJson<Order>(user, "/api/ar/activity/order", request, 35_000);
      const repeat = await postJson<Order>(user, "/api/ar/activity/order", request, 35_000);
      assert.equal(first.status, "paid_test");
      assert.equal(first.receipt?.livemode, false);
      assert.equal(first.receipt?.shipment, "not_created");
      assert.equal(first.receipt?.amountCents, activity.cart.totalCents);
      assert.equal(repeat.orderId, first.orderId, "Idempotent retry created a different payment.");
      orders++;
      console.log(`  TEST order=${first.orderId} amount=$${(activity.cart.totalCents / 100).toFixed(2)} retry=same`);
    } catch (error) { failures++; console.error(`${label}: FAIL ${error instanceof Error ? error.message : String(error)}`); }
  }
  times.sort((a, b) => a - b);
  const median = times.length ? Math.round((times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2) : null;
  console.log(`Result: ${config.images.length - failures}/${config.images.length} images checked; ${matched} matched; ${orders} TEST orders; median scan round trip ${median ?? "n/a"} ms.`);
  if (config.order && !orders) throw new Error("--order requested, but no supported plan produced a TEST cart.");
  assert.equal(failures, 0, `${failures} image checks failed.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
