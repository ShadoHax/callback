// Incoming-message alert. Browsers only allow sound after a user gesture, so call unlockAlerts() from a tap first.
// navigator.vibrate works on Android Chrome; iOS Safari ignores it, so the chime and on-screen card carry the moment there.
let audio: AudioContext | null = null;

export function unlockAlerts() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return true;
  } catch { return false; }
}

export function alertIncoming() {
  try { navigator.vibrate?.([180, 90, 180]); } catch { /* unsupported */ }
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  for (const [offset, frequency] of [[0, 880], [0.14, 1320]] as const) {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(now + offset); oscillator.stop(now + offset + 0.4);
  }
}
