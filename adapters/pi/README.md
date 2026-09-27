# Raspberry Pi connection beacon

When an AI glasses scan finds a match, the database queues a short event. This client polls with a receive-only Pi token, flashes an RGB LED three times, and can chirp an active buzzer. The event contains only the person, observed item, and relation; no photo or source excerpt reaches the Pi.

1. Apply the latest `supabase/schema.sql` to the configured Supabase project and deploy the Callback server.
2. On `/devices`, pair a **Raspberry Pi beacon** and copy its 24-hour token. Renew it when it expires.
3. Wire a common-cathode RGB LED: red to BCM 17, green to BCM 27, blue to BCM 22, **each through its own current-limiting resistor**; common leg to ground. Optionally connect an active buzzer signal to BCM 18 and ground. Check component voltage/current ratings before wiring.
4. On Raspberry Pi OS, install Python 3 and `gpiozero`. Set `CALLBACK_BASE_URL` to your HTTPS deployment and `CALLBACK_PI_TOKEN` to the paired token, then run `python3 beacon.py --buzzer-pin 18` (omit the flag if there is no buzzer).

The client stores its last event ID in `~/.callback-pi-cursor.json` so restarts do not replay old effects. A revoked or expired token stops receiving events. To check the effect without a Pi or server, run `python3 beacon.py --replay sample-event.json`; use `--console` for live polling without GPIO.
