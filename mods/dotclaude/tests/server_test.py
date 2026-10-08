"""The companion server's headers and refusals. Run: python3 -m unittest tests/server_test.py"""

import http.client
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "server.py")
SHELL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "index.html")
TOKEN = "test-token"


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def directives(policy):
    """A CSP header as {directive: sources}."""
    parsed = {}
    for part in policy.split(";"):
        words = part.split()
        if words:
            parsed[words[0]] = words[1:]
    return parsed


def start_server(folder, port=None):
    port = port or free_port()
    server = subprocess.Popen(
        [sys.executable, "-u", SCRIPT, str(port), folder, TOKEN],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if "Serving HTTP" not in server.stdout.readline():
        raise RuntimeError("the server did not start: " + server.stderr.read())
    return server, port


def request(port, method, path, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    connection.request(method, path, headers={"Host": f"127.0.0.1:{port}", **(headers or {})})
    response = connection.getresponse()
    body = response.read()
    connection.close()
    return response, body


class CompanionServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.folder = tempfile.mkdtemp()
        os.makedirs(os.path.join(cls.folder, "views"))
        shutil.copy(SHELL, os.path.join(cls.folder, "index.html"))
        with open(os.path.join(cls.folder, "views", "demo.html"), "w") as handle:
            handle.write("<!doctype html><title>Demo</title><p>hello</p>")
        cls.server, cls.port = start_server(cls.folder)

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        cls.server.communicate(timeout=5)
        shutil.rmtree(cls.folder)

    def get(self, path, host=None):
        return request(self.port, "GET", path, {"Host": host} if host else None)

    def test_the_shell_may_fetch_views_from_this_server_and_frame_them(self):
        response, _ = self.get("/")
        policy = directives(response.getheader("Content-Security-Policy"))
        self.assertEqual(response.status, 200)
        self.assertEqual(policy["connect-src"], ["'self'"])
        self.assertNotIn("sandbox", policy)

    def test_a_view_is_sandboxed_and_cannot_make_requests(self):
        response, body = self.get("/views/demo.html")
        policy = directives(response.getheader("Content-Security-Policy"))
        self.assertEqual(response.status, 200)
        self.assertIn(b"hello", body)
        self.assertEqual(policy["sandbox"], ["allow-scripts"])
        self.assertEqual(policy["connect-src"], ["'none'"])
        self.assertEqual(policy["form-action"], ["'none'"])
        self.assertEqual(policy["base-uri"], ["'none'"])
        self.assertEqual(policy["frame-ancestors"], ["'self'"])
        self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")

    def test_the_shell_shows_views_through_srcdoc_under_a_no_request_policy(self):
        with open(SHELL) as handle:
            shell = handle.read()
        self.assertIn('sandbox="allow-scripts"', shell)
        self.assertIn("frame.srcdoc = withViewPolicy(html)", shell)
        self.assertIn("connect-src 'none'; form-action 'none'; base-uri 'none'", shell)

    def test_a_path_naming_no_file_answers_404_without_a_traceback(self):
        for path in ["/%00", "/views/%00.html", "/" + "a" * 5000, "/../../etc/passwd", "/views/"]:
            with self.subTest(path=path[:40]):
                response, body = self.get(path)
                self.assertEqual(response.status, 404)
                self.assertEqual(body, b"Not found")

    def test_another_host_is_refused(self):
        response, _ = self.get("/", host="evil.example:80")
        self.assertEqual(response.status, 403)

    def test_the_token_answers_at_its_path(self):
        response, body = self.get("/__token")
        self.assertEqual(body.decode(), TOKEN)

    def test_shutdown_needs_a_post_with_the_token_header(self):
        self.assertEqual(self.get("/__shutdown")[0].status, 404)
        self.assertEqual(request(self.port, "POST", "/__shutdown")[0].status, 403)
        self.assertEqual(request(self.port, "POST", "/__shutdown", {"X-Companion-Token": "wrong"})[0].status, 403)
        self.assertEqual(request(self.port, "POST", "/__shutdown?token=" + TOKEN)[0].status, 403)
        self.assertIsNone(self.server.poll())


class ShutdownTest(unittest.TestCase):
    def test_the_right_token_stops_the_server_and_frees_the_port(self):
        folder = tempfile.mkdtemp()
        try:
            server, port = start_server(folder)
            response, _ = request(port, "POST", "/__shutdown", {"X-Companion-Token": TOKEN})
            self.assertEqual(response.status, 200)
            self.assertEqual(server.wait(timeout=5), 0)
            replacement, _ = start_server(folder, port)
            replacement.terminate()
            replacement.communicate(timeout=5)
        finally:
            shutil.rmtree(folder)


if __name__ == "__main__":
    unittest.main()
