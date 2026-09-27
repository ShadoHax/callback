import { z } from "zod";

export const LocationProof = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().max(10_000),
  capturedAt: z.string().datetime({ offset: true }),
});
export type LocationProof = z.infer<typeof LocationProof>;
export type LocationVerification = Pick<LocationProof, "accuracy" | "capturedAt"> & { verified: boolean };

// This only checks that a client-supplied position is recent and claims useful accuracy. Clients can
// spoof coordinates, and GPS alone cannot identify a photographed venue.
export function verifyLocation(proof: LocationProof | undefined, now = Date.now()) {
  if (!proof) return undefined;
  const age = Math.abs(now - Date.parse(proof.capturedAt));
  return { ...proof, verified: proof.accuracy <= 150 && age <= 2 * 60_000 };
}

export function publicLocation(proof: ReturnType<typeof verifyLocation>): LocationVerification | undefined {
  return proof && { accuracy: proof.accuracy, capturedAt: proof.capturedAt, verified: proof.verified };
}
