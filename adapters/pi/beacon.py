#!/usr/bin/env python3
"""Callback connection beacon for a Raspberry Pi (or console replay)."""

import argparse
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

WISH, PLAN, RECOMMENDATION, SHARED = (1, 0.35, 0), (0, 0.7, 1), (0, 1, 0.2), (0.65, 0, 1)
COLORS = {
    "wanted": WISH,
    "asked_to_find": WISH,
    "planned_together": PLAN,
    "recommended": RECOMMENDATION,
    "gifted": SHARED,
    "experienced_together": SHARED,
    # Keep legacy names for events recorded before the relation rename.
    "wish": WISH,
    "shared_plan": PLAN,
    "recommendation": RECOMMENDATION,
    "gift": SHARED,
    "memory": SHARED,
}


class ConsoleOutput:
    def show(self, color, label):
        print(f"BEACON {label}: RGB {color}", flush=True)


class GpioOutput:
    def __init__(self, buzzer_pin=None):
        from gpiozero import RGBLED, Buzzer
        self.led = RGBLED(red=17, green=27, blue=22)
        self.buzzer = Buzzer(buzzer_pin) if buzzer_pin is not None else None

    def show(self, color, label):
        print(f"BEACON {label}", flush=True)
        for _ in range(3):
            self.led.color = color
            if self.buzzer:
                self.buzzer.on()
            time.sleep(0.18)
            self.led.off()
            if self.buzzer:
                self.buzzer.off()
            time.sleep(0.12)

    def close(self):
        self.led.close()
        if self.buzzer:
            self.buzzer.close()


def render_event(event, output):
    if event.get("kind") != "connection":
        return False
    payload = event.get("payload") or {}
    relation = payload.get("relation")
    if not isinstance(relation, str):
        relation = "connection"
    color = COLORS.get(relation, (1, 1, 1))
    person = payload.get("person")
    item = payload.get("item")
    label = f"{person}: {item}" if isinstance(person, str) and isinstance(item, str) else "Connection found"
    output.show(color, label)
    return True


def read_cursor(path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))["cursor"]
        return value if type(value) is int and value >= 0 else 0
    except (FileNotFoundError, ValueError, KeyError, TypeError):
        return 0


def save_cursor(path, cursor):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps({"cursor": cursor}), encoding="utf-8")
    temporary.replace(path)


def poll(base_url, token, cursor):
    url = base_url.rstrip("/") + "/api/device/events?" + urlencode({"after": cursor})
    request = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with urlopen(request, timeout=15) as response:
        return json.load(response)


def consume_events(data, cursor, output, state):
    for event in data["events"]:
        event_id = event["id"]
        if type(event_id) is not int or event_id <= cursor:
            raise ValueError("Invalid event order")
        render_event(event, output)
        cursor = event_id
        save_cursor(state, cursor)
    return cursor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--console", action="store_true", help="Print effects without GPIO")
    parser.add_argument("--replay", type=Path, help="Replay one JSON event offline")
    parser.add_argument("--buzzer-pin", type=int, help="Optional active buzzer BCM pin (for example 18)")
    parser.add_argument("--state", type=Path, default=Path.home() / ".callback-pi-cursor.json")
    args = parser.parse_args()
    output = ConsoleOutput() if args.console or args.replay else GpioOutput(args.buzzer_pin)
    if args.replay:
        render_event(json.loads(args.replay.read_text(encoding="utf-8")), output)
        return
    base_url = os.environ.get("CALLBACK_BASE_URL", "")
    token = os.environ.get("CALLBACK_PI_TOKEN", "")
    if not base_url.startswith("https://") or not token:
        parser.error("Set CALLBACK_BASE_URL to an HTTPS deployment and CALLBACK_PI_TOKEN to a Pi device token")
    cursor = read_cursor(args.state)
    try:
        while True:
            try:
                data = poll(base_url, token, cursor)
                cursor = consume_events(data, cursor, output, args.state)
                time.sleep(2)
            except (HTTPError, URLError, TimeoutError, ValueError, KeyError) as error:
                print(f"Beacon poll failed: {error}", flush=True)
                time.sleep(10)
    finally:
        if isinstance(output, GpioOutput):
            output.close()


if __name__ == "__main__":
    main()
