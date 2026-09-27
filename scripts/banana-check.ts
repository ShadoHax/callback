// Real endpoint rehearsal for the banana bread demo. User photos stay in Downloads.
// node --import tsx scripts/banana-check.ts --app http://localhost:3000
// Add --order-test only to exercise the Stripe TEST endpoint; never use a live key.
import { access, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { flags } from "./lib/live";

const PHOTOS = [
  "images (1).jpeg",
  "one-ripe-yellow-banana-is-placed-on-a-wooden-table-free-photo.jpeg",
  "360_F_74173350_rmkw8P8ApVTGfkQpGyTExeLAUgUnH4Cz.jpg",
  "banana-on-the-kitchen-table.jpg",
];
const DEFAULT_NEGATIVE = resolve("data/private/test-images/story/water-bottle.png");
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 150_000;

type Memory = { personName?: string; quote?: string; sourceAt?: string; synthetic?: boolean; connection?: unknown };
type Recipe = { title?: string; steps?: unknown; timeMinutes?: number; servings?: number };
type Cart = { items?: unknown; subtotalCents?: number; shippingCents?: number; taxCents?: number; totalCents?: number; currency?: string; merchant?: string; mode?: string };
type Prepared = { ready?: boolean; prepareToken?: string; memory?: Memory; recipe?: Recipe; cart?: Cart; timingMs?: number; error?: string };
type Scanned = { bananaDetected?: boolean; identification?: { item?: string; category?: string; confidence?: number }; timingMs?: number; sessionId?: string; memory?: Memory; recipe?: Recipe; cart?: Cart; error?: string };
type Ordered = { status?: string; orderId?: string; receipt?: { paymentIntentId?: string; amountCents?: number; currency?: string; livemode?: boolean; mode?: string; shipment?: string }; error?: string };
type Row = { file: string; banana: boolean; story: boolean; recipe: boolean; cart: boolean; http: number; clientMs: number; serverMs?: number; item?: string; confidence?: number; sessionId?: string; pass: boolean };

function argument(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  return value;
}

function storyPass(memory: Memory | undefined, friend: string): boolean {
  // Require attributed, dated, explicitly synthetic demo evidence. Never print its private text.
  return Boolean(memory && memory.personName?.trim().toLowerCase() === friend.toLowerCase()
    && /banana\s*bread/i.test(memory.quote ?? "")
    && /\b(we|us|our|together|you and i|let's)\b/i.test(memory.quote ?? "")
    && memory.sourceAt && !Number.isNaN(Date.parse(memory.sourceAt))
    && memory.synthetic === true && memory.connection);
}

function recipePass(recipe: Recipe | undefined): boolean {
  return Boolean(recipe && /banana\s*bread/i.test(recipe.title ?? "")
    && Array.isArray(recipe.steps) && recipe.steps.length > 0);
}

function cartPass(cart: Cart | undefined): boolean {
  return Boolean(cart && Array.isArray(cart.items) && cart.items.length > 0
    && Number.isInteger(cart.totalCents) && cart.totalCents! > 0
    && cart.currency?.toUpperCase() === "USD");
}

async function checkedImage(path: string): Promise<File> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > MAX_IMAGE_BYTES)
    throw new Error(`${basename(path)} must be a nonempty image under 8 MB.`);
  const type = extname(path).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  if (!/\.(png|jpe?g)$/i.test(path)) throw new Error(`${basename(path)} must be JPG or PNG.`);
  return new File([await readFile(path)], basename(path), { type });
}

async function postJson<T>(app: string, path: string, body: object): Promise<{ status: number; data: T }> {
  const response = await fetch(`${app}${path}`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
  return { status: response.status, data: await response.json().catch(() => ({})) as T };
}

async function scan(app: string, image: File, prepareToken: string): Promise<{ status: number; data: Scanned; ms: number }> {
  const form = new FormData();
  form.set("image", image);
  form.set("prepareToken", prepareToken);
  const started = Date.now();
  const response = await fetch(`${app}/api/demo/banana/scan`, { method: "POST", body: form, signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
  const data = await response.json().catch(() => ({})) as Scanned;
  return { status: response.status, data, ms: Date.now() - started };
}

async function main() {
  const { read, has } = flags(process.argv.slice(2));
  if (has("help")) {
    console.log("Usage: node --import tsx scripts/banana-check.ts --app URL [--dir Downloads] [--friend Alan] [--negative path] [--order-test]");
    return;
  }
  const app = argument("--app", read("app")).replace(/\/$/, "");
  const dir = resolve(argument("--dir", read("dir") ?? join(process.env.HOME ?? "", "Downloads")));
  const friend = argument("--friend", read("friend") ?? "Alan");
  const negativePath = resolve(argument("--negative", read("negative") ?? DEFAULT_NEGATIVE));
  const orderTest = has("order-test");
  const url = new URL(app);
  if (!/^https?:$/.test(url.protocol)) throw new Error("--app must be an HTTP(S) URL.");
  if (orderTest && process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.startsWith("sk_test_"))
    throw new Error("Refusing --order-test: local STRIPE_SECRET_KEY is not a Stripe TEST key.");
  // Preflight before any endpoint or model call.
  for (const file of PHOTOS) await checkedImage(join(dir, file));
  const hasNegative = await access(negativePath).then(() => true, () => false);
  if (hasNegative) await checkedImage(negativePath);
  const preparationStarted = Date.now();
  const preparation = await postJson<Prepared>(app, "/api/demo/banana/prepare", {});
  const prepareMs = Date.now() - preparationStarted;
  if (!preparation.status.toString().startsWith("2") || !preparation.data.ready || !preparation.data.prepareToken)
    throw new Error(`Banana preparation failed (HTTP ${preparation.status}; ${preparation.data.error ?? "not ready"}).`);
  const preparedStory = storyPass(preparation.data.memory, friend);
  const preparedRecipe = recipePass(preparation.data.recipe);
  const preparedCart = cartPass(preparation.data.cart);
  console.log(`Prepare: ${prepareMs} ms; ${preparedStory ? "friend plan ✓" : "friend plan ✗"}; ${preparedRecipe ? "recipe ✓" : "recipe ✗"}; ${preparedCart ? "cart ✓" : "cart ✗"}.`);

  const rows: Row[] = [];
  for (const file of PHOTOS) {
    const result = await scan(app, await checkedImage(join(dir, file)), preparation.data.prepareToken);
    const data = result.data;
    const recognized = data.bananaDetected === true && data.identification?.category === "banana" && (data.identification?.confidence ?? 0) >= 0.7;
    const row: Row = { file, banana: recognized, story: storyPass(data.memory, friend),
      recipe: recipePass(data.recipe), cart: cartPass(data.cart), http: result.status, clientMs: result.ms,
      serverMs: data.timingMs, item: data.identification?.item, confidence: data.identification?.confidence, sessionId: data.sessionId,
      pass: result.status === 200 && recognized && storyPass(data.memory, friend)
        && recipePass(data.recipe) && cartPass(data.cart) && Boolean(data.sessionId) };
    rows.push(row);
    console.log(`${row.pass ? "✓" : "✗"} ${file}: vision ${row.item ?? "?"} (${row.confidence === undefined ? "?" : `${Math.round(row.confidence * 100)}%`}), banana ${row.banana}, friend plan ${row.story}, recipe ${row.recipe}, cart ${row.cart}; HTTP ${row.http}; ${row.clientMs} ms client / ${row.serverMs ?? "?"} ms server${data.error ? `; ${data.error}` : ""}.`);
  }

  let negativePass = true;
  if (hasNegative) {
    const negative = await scan(app, await checkedImage(negativePath), preparation.data.prepareToken);
    negativePass = negative.status === 200 && negative.data.bananaDetected === false && !negative.data.sessionId;
    console.log(`${negativePass ? "✓" : "✗"} Negative (${basename(negativePath)}): no banana and no cart session; HTTP ${negative.status}.`);
  } else console.log("Negative photo absent; negative case skipped.");

  const winners = rows.filter((row) => row.pass).sort((a, b) => a.clientMs - b.clientMs);
  if (winners.length) console.log(`Best rehearsed photo: ${winners[0].file} (${winners[0].clientMs} ms). ${winners.length}/${rows.length} supplied photos passed.`);
  else console.log(`0/${rows.length} supplied photos passed.`);

  if (orderTest) {
    if (!winners.length) throw new Error("Refusing TEST order: no photo passed the full demo story.");
    const payload = { sessionId: winners[0].sessionId };
    const first = await postJson<Ordered>(app, "/api/demo/banana/order", payload);
    const again = await postJson<Ordered>(app, "/api/demo/banana/order", payload);
    const valid = (value: Ordered) => value.status === "paid_test" && Boolean(value.orderId && value.receipt?.paymentIntentId)
      && value.receipt?.livemode === false && value.receipt.mode === "stripe_test"
      && value.receipt.shipment === "not_created" && value.receipt.amountCents === preparation.data.cart?.totalCents;
    const orderPass = first.status === 200 && again.status === 200 && valid(first.data) && valid(again.data)
      && first.data.orderId === again.data.orderId && first.data.receipt?.paymentIntentId === again.data.receipt?.paymentIntentId;
    console.log(`${orderPass ? "✓" : "✗"} Stripe TEST order and same-session retry ${orderPass ? "idempotent" : "failed"}; no shipment created.`);
    if (!orderPass) process.exitCode = 1;
  }
  if (!preparedStory || !preparedRecipe || !preparedCart || winners.length !== rows.length || !negativePass) process.exitCode = 1;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
