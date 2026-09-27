import { expect, it } from "vitest";
import { proximity } from "../src/lib/proximity";

const now = Date.parse("2026-09-26T12:00:00Z");
const scanner = { latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: "2026-09-26T11:59:30Z" };

it("uses conservative accuracy and distance gates for a same-place signal", () => {
  expect(proximity(scanner, { userId: "maya", latitude: 40.7412, longitude: -73.989, accuracy: 15, capturedAt: "2026-09-26T11:59:00Z", expiresAt: "2026-09-26T12:05:00Z" }, now)).toMatchObject({ status: "same_place", distanceBand: "within_75m" });
  expect(proximity(scanner, { userId: "maya", latitude: 40.7425, longitude: -73.989, accuracy: 80, capturedAt: "2026-09-26T11:59:00Z", expiresAt: "2026-09-26T12:05:00Z" }, now)).toMatchObject({ status: "nearby", distanceBand: "within_250m" });
});

it("returns nothing for expired, inaccurate, or distant presence", () => {
  expect(proximity(scanner, { userId: "maya", latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: "2026-09-26T11:50:00Z", expiresAt: "2026-09-26T11:59:59Z" }, now)).toBeUndefined();
  expect(proximity(scanner, { userId: "maya", latitude: 40.741, longitude: -73.989, accuracy: 300, capturedAt: "2026-09-26T11:59:00Z", expiresAt: "2026-09-26T12:05:00Z" }, now)).toBeUndefined();
  expect(proximity(scanner, { userId: "maya", latitude: 40.751, longitude: -73.989, accuracy: 20, capturedAt: "2026-09-26T11:59:00Z", expiresAt: "2026-09-26T12:05:00Z" }, now)).toBeUndefined();
});

it("does not use a stale location even while a presence row remains unexpired", () => {
  const presence = { userId: "maya", latitude: 40.741, longitude: -73.989, accuracy: 20, capturedAt: "2026-09-26T11:50:00Z", expiresAt: "2026-09-26T12:05:00Z" };
  expect(proximity(scanner, presence, now)).toBeUndefined();
  expect(proximity({ ...scanner, capturedAt: "2026-09-26T11:50:00Z" }, { ...presence, capturedAt: "2026-09-26T11:59:00Z" }, now)).toBeUndefined();
});
