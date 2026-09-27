import type { LocationProof } from "./location-proof";

export type Presence = LocationProof & { userId: string; expiresAt: string };
export type Proximity = { status: "same_place" | "nearby"; distanceBand: "within_75m" | "within_250m"; checkedAt: string };

function meters(a: Pick<LocationProof, "latitude" | "longitude">, b: Pick<LocationProof, "latitude" | "longitude">) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude), lat2 = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function proximity(scanner: LocationProof, presence: Presence, now = Date.now()): Proximity | undefined {
  const fresh = (capturedAt: string) => Math.abs(now - Date.parse(capturedAt)) <= 2 * 60_000;
  if (Date.parse(presence.expiresAt) <= now || !fresh(scanner.capturedAt) || !fresh(presence.capturedAt) || scanner.accuracy > 150 || presence.accuracy > 150) return undefined;
  const distance = meters(scanner, presence);
  // “Same place” is intentionally conservative. GPS cannot prove a building boundary, so both fixes must be
  // high quality and close; UI copy says “may be here” rather than claiming certainty.
  if (scanner.accuracy <= 50 && presence.accuracy <= 50 && distance <= 75) return { status: "same_place", distanceBand: "within_75m", checkedAt: new Date(now).toISOString() };
  if (distance <= 250) return { status: "nearby", distanceBand: "within_250m", checkedAt: new Date(now).toISOString() };
}
