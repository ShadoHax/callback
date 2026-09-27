import { expect, it } from "vitest";
import { verifyLocation } from "../src/lib/location-proof";

const now = Date.parse("2026-09-26T12:00:00Z");

it("verifies a fresh, accurate device position", () => {
  expect(verifyLocation({ latitude: 40.741, longitude: -73.989, accuracy: 24, capturedAt: "2026-09-26T11:59:30Z" }, now)?.verified).toBe(true);
});

it("does not verify stale or low-accuracy positions", () => {
  expect(verifyLocation({ latitude: 40.741, longitude: -73.989, accuracy: 24, capturedAt: "2026-09-26T11:50:00Z" }, now)?.verified).toBe(false);
  expect(verifyLocation({ latitude: 40.741, longitude: -73.989, accuracy: 300, capturedAt: "2026-09-26T11:59:30Z" }, now)?.verified).toBe(false);
});
