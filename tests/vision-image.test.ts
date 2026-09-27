import { afterEach, expect, it } from "vitest";
import sharp from "sharp";
import { prepareVisionImage } from "../src/lib/vision-image";

afterEach(() => { delete process.env.VISION_MAX_IMAGE_EDGE; });

it("bounds a phone photo, applies orientation, and strips location metadata", async () => {
  const bytes = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: "#ffaa00" } })
    .jpeg().withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: "private owner" } }).toBuffer();
  const result = await prepareVisionImage(new File([new Uint8Array(bytes)], "phone.jpg", { type: "image/jpeg" }));
  const metadata = await sharp(Buffer.from(result.url.split(",")[1], "base64")).metadata();
  expect([metadata.width, metadata.height]).toEqual([683, 1024]);
  expect(metadata.exif).toBeUndefined();
  expect(metadata.orientation).toBeUndefined();
  expect(result.metrics).toMatchObject({ originalBytes: bytes.length, width: 683, height: 1024, maxEdge: 1024 });
  expect(result.metrics.sentBytes).toBeLessThan(bytes.length);
});

it("does not enlarge small photos and rejects corrupt uploads before model calls", async () => {
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: "white" } }).png().toBuffer();
  const result = await prepareVisionImage(new File([new Uint8Array(bytes)], "small.png", { type: "image/png" }));
  expect(result.metrics).toMatchObject({ width: 80, height: 40 });
  await expect(prepareVisionImage(new File(["invalid"], "fake.jpg", { type: "image/jpeg" }))).rejects.toMatchObject({ status: 400 });
});

it("rejects an unbounded resize configuration", async () => {
  process.env.VISION_MAX_IMAGE_EDGE = "9000";
  await expect(prepareVisionImage(new File(["irrelevant"], "photo.jpg"))).rejects.toThrow(/512 to 1280/);
});
