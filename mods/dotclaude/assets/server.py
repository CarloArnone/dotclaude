"""The companion's local server: 127.0.0.1 only, the files of one folder, nothing else.

Usage: server.py <port> <folder> <token>

- Answers only requests addressed to 127.0.0.1:<port> or localhost:<port> (403 otherwise),
  which keeps a page on another site from reaching it through DNS rebinding.
- Serves regular files under <folder>, never a directory listing, never a path outside it.
- GET /__token answers <token>, so the plugin can tell its own server from another program
  on the port.
- POST /__shutdown with the header X-Companion-Token: <token> stops the server, so a later
  session holding the same token can replace a server an earlier one left running. A page
  in a browser cannot send that header to another origin without a preflight, never answered.
- Every response forbids sniffing; views run sandboxed and may not connect anywhere, the
  shell page only to this server (it polls views/manifest.json and fetches the views it shows).
- A path that names no file (a NUL byte, an over-long name, a link loop) answers 404.
"""

import hmac
import http.server
import mimetypes
import os
import sys
import urllib.parse

PORT = int(sys.argv[1])
ROOT = os.path.realpath(sys.argv[2])
TOKEN = sys.argv[3]

ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
SHELL = os.path.join(ROOT, "index.html")
# A view opened on its own runs sandboxed too, and may neither connect, submit nor rebase its links.
VIEW_POLICY = (
    "default-src 'self' 'unsafe-inline' data:; connect-src 'none'; form-action 'none'; "
    "base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts"
)
SHELL_POLICY = "default-src 'self' 'unsafe-inline' data:; connect-src 'self'; frame-ancestors 'self'"


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "companion"

    def do_GET(self):
        self.respond(include_body=True)

    def do_HEAD(self):
        self.respond(include_body=False)

    def do_POST(self):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return self.send_text(403, "Forbidden", True)
        if urllib.parse.urlsplit(self.path).path != "/__shutdown":
            return self.send_text(404, "Not found", True)
        if not hmac.compare_digest(self.headers.get("X-Companion-Token", ""), TOKEN):
            return self.send_text(403, "Forbidden", True)
        self.send_text(200, "Stopping", True)
        self.wfile.flush()
        # Exiting at once frees the port well before a replacement's interpreter is up to bind it.
        os._exit(0)

    def respond(self, include_body):
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return self.send_text(403, "Forbidden", include_body)
        path = urllib.parse.urlsplit(self.path).path
        if path == "/__token":
            return self.send_text(200, TOKEN, include_body)
        file = self.resolve(path)
        if file is None:
            return self.send_text(404, "Not found", include_body)
        with open(file, "rb") as handle:
            body = handle.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_security_headers(SHELL_POLICY if file == SHELL else VIEW_POLICY)
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def resolve(self, path):
        """The regular file a URL path names inside ROOT, links resolved; None for anything else."""
        relative = urllib.parse.unquote(path).lstrip("/") or "index.html"
        try:
            candidate = os.path.realpath(os.path.join(ROOT, relative))
            if os.path.commonpath([candidate, ROOT]) != ROOT or not os.path.isfile(candidate):
                return None
        except (ValueError, OSError):
            # A NUL byte, an over-long name or a link loop names no file to serve.
            return None
        return candidate

    def send_text(self, status, text, include_body):
        body = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_security_headers(VIEW_POLICY)
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def send_security_headers(self, policy):
        self.send_header("Content-Security-Policy", policy)
        self.send_header("X-Content-Type-Options", "nosniff")

    def log_message(self, format, *args):
        # Requests are not worth a line each; errors still reach stderr through send_error.
        pass


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Serving HTTP on 127.0.0.1 port {PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
