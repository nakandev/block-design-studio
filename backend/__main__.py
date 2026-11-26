from __future__ import annotations

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .rtl import GenerationError, generate_bundle, validate_rtl


MAX_REQUEST_BYTES = 16 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/api/health":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def do_POST(self) -> None:
        if self.path not in ("/api/rtl/generate", "/api/rtl/validate"):
            self.send_error(404)
            return
        raw_length = self.headers.get("Content-Length", "")
        try:
            length = int(raw_length)
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return
        if length < 1 or length > MAX_REQUEST_BYTES:
            self.send_error(413, "Request body is too large or empty")
            return
        try:
            payload = json.loads(self.rfile.read(length))
            if self.path == "/api/rtl/validate":
                self.send_json(200, {"issues": validate_rtl(payload)})
                return
            archive = generate_bundle(payload)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            self.send_json(400, {"error": f"Invalid JSON: {error}"})
            return
        except GenerationError as error:
            self.send_json(400, {"error": str(error)})
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", 'attachment; filename="rtl-output.zip"')
        self.send_header("Content-Length", str(len(archive)))
        self.end_headers()
        self.wfile.write(archive)

    def send_json(self, status: int, value: dict) -> None:
        body = json.dumps(value).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    host = os.environ.get("RTL_BACKEND_HOST", "127.0.0.1")
    port = int(os.environ.get("RTL_BACKEND_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"RTL backend listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
