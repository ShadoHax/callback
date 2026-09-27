// Fetch the attributed, real-world Wikimedia Commons photos used by the live browser scan check.
// Re-running this script refreshes the exact files listed below; no generated images are involved.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Keep downloaded photo bytes out of Git; the manifest and attribution remain in fixtures/.
const output = resolve("data/private/live/web-photo-fixtures");
const photos = [
  ["grocery-soda-shelf.jpg", "Soda bottle shelf.jpg"],
  ["grocery-diet-coke.png", "Diet Coke and Coca-Cola Zero bottles at Target (50871079092).png"],
  ["grocery-coffee-bags.jpg", "Supermarket Coffee Bags.jpg"],
  ["light-roast-coffee-pod.jpg", "Gold Emblem French Vanilla Light Roast Coffee Pod.jpg"],
  ["war-and-peace-book.JPG", "War and Peace book.JPG"],
  ["desk-stapler.jpg", "Staplerblack.jpg"],
];
const headers = { "User-Agent": "CallbackLivePhotoCheck/1.0 (real-world scan fixture retrieval)" };

await mkdir(output, { recursive: true });
for (const [name, title] of photos) {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [key, value] of Object.entries({ action: "query", format: "json", prop: "imageinfo", iiprop: "url", iiurlwidth: "1280", titles: `File:${title}` })) api.searchParams.set(key, value);
  const metadataResponse = await fetch(api, { headers });
  if (!metadataResponse.ok) throw new Error(`Commons metadata request failed (${metadataResponse.status}): ${title}`);
  const pages = Object.values((await metadataResponse.json()).query?.pages ?? {});
  const info = pages[0]?.imageinfo?.[0];
  if (!info?.thumburl && !info?.url) throw new Error(`Commons image missing: ${title}`);
  const response = await fetch(info.thumburl ?? info.url, { headers });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(`Commons image request failed (${response.status}): ${title}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(join(output, name), bytes);
  console.log(`${name}: ${bytes.length} bytes from ${info.descriptionurl}`);
}
