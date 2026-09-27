import type { LocationProof } from "./location-proof";

export async function captureLocation(): Promise<LocationProof> {
  if (!navigator.geolocation) throw new Error("Location is unavailable on this device.");
  const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 }));
  return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() };
}
