import tempfile
import unittest
from pathlib import Path
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread
import json

from beacon import consume_events, poll, read_cursor, render_event, save_cursor


class FakeOutput:
    def __init__(self):
        self.calls = []

    def show(self, color, label):
        self.calls.append((color, label))


class BeaconTests(unittest.TestCase):
    def test_match_color_and_label(self):
        output = FakeOutput()
        self.assertTrue(render_event({"kind": "connection", "payload": {"relation": "gift", "person": "Maya", "item": "mug"}}, output))
        self.assertEqual(output.calls, [((0.65, 0, 1), "Maya: mug")])

    def test_current_relation_name_color(self):
        output = FakeOutput()
        self.assertTrue(render_event({"kind": "connection", "payload": {"relation": "asked_to_find", "person": "Maya", "item": "camera"}}, output))
        self.assertEqual(output.calls, [((1, 0.35, 0), "Maya: camera")])

    def test_other_event_has_no_effect(self):
        output = FakeOutput()
        self.assertFalse(render_event({"kind": "scan", "payload": {}}, output))
        self.assertEqual(output.calls, [])

    def test_cursor_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "cursor.json"
            self.assertEqual(read_cursor(path), 0)
            save_cursor(path, 42)
            self.assertEqual(read_cursor(path), 42)

    def test_http_poll_and_cursor_replay_protection(self):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append((self.path, self.headers.get("Authorization")))
                body = json.dumps({"events": [{"id": 8, "kind": "connection", "payload": {"relation": "gift", "person": "Maya", "item": "mug"}}], "cursor": 8}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            data = poll(f"http://127.0.0.1:{server.server_port}", "test-token", 7)
            self.assertEqual(seen, [("/api/device/events?after=7", "Bearer test-token")])
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "cursor.json"
                output = FakeOutput()
                self.assertEqual(consume_events(data, 7, output, path), 8)
                self.assertEqual(read_cursor(path), 8)
                self.assertEqual(len(output.calls), 1)
                with self.assertRaises(ValueError):
                    consume_events(data, 8, output, path)
                self.assertEqual(len(output.calls), 1)
        finally:
            server.shutdown()
            thread.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
