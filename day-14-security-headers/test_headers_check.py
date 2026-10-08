"""Tests for headers_check.py.

Spins up tiny local HTTP servers with controlled headers so the grading
logic is tested deterministically - no real websites involved.
Run:  python3 test_headers_check.py
"""

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from headers_check import audit_url, grade_header


def make_server(headers):
    """Start a localhost server that always replies with `headers`."""
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            for k, v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(b"ok")

        def log_message(self, *args):  # keep test output clean
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


GOOD_HEADERS = {
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Content-Security-Policy": "default-src 'self'",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Set-Cookie": "session=abc; Secure; HttpOnly; SameSite=Lax; Path=/",
}

BAD_HEADERS = {
    "Server": "Apache/2.4.1",
    "X-Powered-By": "PHP/8.1.0",
    "Set-Cookie": "session=abc; Path=/",
}


def finding(result, check_id):
    return next(f for f in result["findings"] if f["id"] == check_id)


def test_good_site_gets_a_plus():
    server = make_server(GOOD_HEADERS)
    try:
        r = audit_url(f"http://127.0.0.1:{server.server_port}", timeout=5)
        assert r["error"] is None, r["error"]
        assert r["grade"] == "A+", f"expected A+, got {r['grade']} ({r['score']})"
        assert finding(r, "hsts")["status"] == "pass"
        assert finding(r, "csp")["status"] == "pass"
    finally:
        server.shutdown()


def test_bare_site_fails():
    server = make_server(BAD_HEADERS)
    try:
        r = audit_url(f"http://127.0.0.1:{server.server_port}", timeout=5)
        assert r["error"] is None, r["error"]
        assert r["grade"] == "F", f"expected F, got {r['grade']} ({r['score']})"
        assert finding(r, "hsts")["status"] == "fail"
        assert finding(r, "csp")["status"] == "fail"
        # info-disclosure findings are present
        ids = [f["id"] for f in r["findings"]]
        assert "info-disclosure" in ids
        # insecure cookie flagged
        cookie = finding(r, "cookie")
        assert cookie["status"] == "fail"
        assert "Secure" in cookie["detail"]
    finally:
        server.shutdown()


def test_csp_frame_ancestors_covers_xfo():
    headers = dict(GOOD_HEADERS)
    del headers["X-Frame-Options"]
    headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
    server = make_server(headers)
    try:
        r = audit_url(f"http://127.0.0.1:{server.server_port}", timeout=5)
        xfo = finding(r, "xfo")
        assert xfo["status"] == "pass", xfo
        assert "frame-ancestors" in xfo["detail"]
    finally:
        server.shutdown()


def test_weak_csp_warned():
    status, detail = grade_header("csp", "default-src 'self' 'unsafe-inline'")
    assert status == "warn", detail


def test_short_hsts_warned():
    status, detail = grade_header("hsts", "max-age=600")
    assert status == "warn", detail


def test_unreachable_host_reports_error():
    r = audit_url("http://127.0.0.1:1", timeout=2)  # nothing listens here
    assert r["error"] is not None
    assert r["grade"] == "F"


if __name__ == "__main__":
    test_good_site_gets_a_plus()
    test_bare_site_fails()
    test_csp_frame_ancestors_covers_xfo()
    test_weak_csp_warned()
    test_short_hsts_warned()
    test_unreachable_host_reports_error()
    print("All 6 tests passed.")
