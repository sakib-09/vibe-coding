#!/usr/bin/env python3
"""Lightweight self-test for cert_checker.py.

Tests two things:
  1. Pure logic (no network): host parsing, expiry parsing, grading, error labels.
  2. Live handshake against github.com (needs internet): end-to-end proof the
     TLS connection + certificate reading works.

Run:  python3 test_cert_checker.py
"""
import base64
import os
import socket
import ssl
import subprocess
import tempfile
import threading
from datetime import datetime, timezone, timedelta

import cert_checker as cc

_passed = 0


def check(name, actual, expected):
    global _passed
    if actual != expected:
        raise AssertionError(f"{name}: expected {expected!r}, got {actual!r}")
    _passed += 1
    print(f"  ok: {name}")


print("--- host parsing ---")
check("bare host", cc.parse_host_arg("example.com"), ("example.com", 443))
check("host:port", cc.parse_host_arg("example.com:8443"), ("example.com", 8443))
check("full URL", cc.parse_host_arg("https://www.example.com:8443/a/b"),
      ("www.example.com", 8443))
check("URL without port", cc.parse_host_arg("http://example.com/x"),
      ("example.com", 443))
check("whitespace", cc.parse_host_arg("  example.com  "), ("example.com", 443))

print("--- expiry parsing / days math ---")
cert = {"notAfter": "Nov 12 12:00:00 2030 GMT"}
expiry = cc.parse_expiry(cert)
check("parses year", expiry.year, 2030)
check("parses month", expiry.month, 11)
check("is UTC-aware", expiry.tzinfo, timezone.utc)
check("days_until far future", cc.days_until(expiry) > 1000, True)
past = datetime.now(timezone.utc) - timedelta(days=5)
check("days_until past is negative", cc.days_until(past) < 0, True)

print("--- grading ---")
check("100 days -> OK", cc.grade(100, 30, 14), "OK")
check("30 days -> WARNING", cc.grade(30, 30, 14), "WARNING")
check("14 days -> CRITICAL", cc.grade(14, 30, 14), "CRITICAL")
check("expired -> EXPIRED", cc.grade(-1, 30, 14), "EXPIRED")
check("custom thresholds", cc.grade(45, 60, 7), "WARNING")

print("--- error classification ---")
check("timeout", cc.classify_error(socket.timeout()), "TIMEOUT")
check("dns", cc.classify_error(socket.gaierror(8, "x")), "DNS_LOOKUP_FAILED")
check("refused", cc.classify_error(ConnectionRefusedError()), "CONNECTION_REFUSED")
check("tls", cc.classify_error(ssl.SSLError("boom")), "TLS_HANDSHAKE_FAILED")

print("--- proxy picking ---")
check("explicit proxy wins", cc.pick_proxy("example.com", "http://p:8080"),
      "http://p:8080")
_saved = os.environ.pop("https_proxy", None)  # don't touch the real env yet
os.environ["https_proxy"] = "https://proxy.example:3128"
try:
    check("env proxy used", cc.pick_proxy("example.com"),
          "https://proxy.example:3128")
finally:
    del os.environ["https_proxy"]
    if _saved is not None:
        os.environ["https_proxy"] = _saved

print(f"\n{_passed} offline assertions passed.")

print("--- DER expiry parsing (offline) ---")
# Build a real DER cert with openssl and parse it back without any network.
der_tmp = tempfile.mkdtemp(prefix="certwatch-der-")
subprocess.run(
    ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
     "-keyout", os.path.join(der_tmp, "k"),
     "-out", os.path.join(der_tmp, "c.pem"),
     "-days", "45", "-subj", "/CN=der-test"],
    check=True, capture_output=True)
with open(os.path.join(der_tmp, "c.pem"), "rb") as fh:
    pem = fh.read()
der = base64.b64decode(
    b"".join(line for line in pem.splitlines()
             if not line.startswith(b"-----")))
expiry = cc.parse_der_expiry(der)
check("DER notAfter is ~45 days out",
      40 <= cc.days_until(expiry) <= 45, True)
print(f"  DER parsed: expires {expiry.date()}")

print("\n--- live handshake (github.com) ---")
proxy = cc.pick_proxy("github.com")
try:
    cert, verified = cc.fetch_certificate("github.com", 443,
                                          timeout=15, proxy=proxy)
except Exception as exc:  # no internet? skip gracefully instead of failing
    print(f"  SKIP: live test unreachable ({cc.classify_error(exc)}: {exc})")
else:
    left = cc.days_until(cc.parse_expiry(cert))
    subject, issuer = cc.describe_cert(cert)
    check("github cert verified", verified, True)
    check("github cert not expired", left > 0, True)
    print(f"  github.com expires in {left} days (issuer: {issuer})")
    print("  LIVE HANDSHAKE OK")

print("\n--- local TLS server: expired / wrong-host / valid certs ---")


def run(cmd):
    subprocess.run(cmd, check=True, capture_output=True)


def gen_ca(tmpdir):
    """Self-signed test CA; returns (ca.crt, ca.key)."""
    key = os.path.join(tmpdir, "ca.key")
    crt = os.path.join(tmpdir, "ca.crt")
    run(["openssl", "genrsa", "-out", key, "2048"])
    run(["openssl", "req", "-x509", "-new", "-key", key, "-out", crt,
         "-days", "2", "-subj", "/CN=CertWatch-Test-CA"])
    # openssl ca needs its little database files; create them once.
    open(os.path.join(tmpdir, "index.txt"), "a").close()
    with open(os.path.join(tmpdir, "serial"), "w") as fh:
        fh.write("01")
    return crt, key


def gen_server(tmpdir, ca_crt, ca_key, name, startdate, enddate, cn, san):
    """Issue a server cert from the test CA with exact validity dates."""
    key = os.path.join(tmpdir, name + ".key")
    csr = os.path.join(tmpdir, name + ".csr")
    crt = os.path.join(tmpdir, name + ".crt")
    run(["openssl", "genrsa", "-out", key, "2048"])
    run(["openssl", "req", "-new", "-key", key, "-out", csr,
         "-subj", f"/CN={cn}"])
    cfg = os.path.join(tmpdir, name + ".cnf")
    with open(cfg, "w") as fh:
        fh.write("[ ca ]\ndefault_ca = testca\n"
                 "[ testca ]\ndatabase = " + tmpdir + "/index.txt\n"
                 "new_certs_dir = " + tmpdir + "\n"
                 "certificate = " + ca_crt + "\n"
                 "private_key = " + ca_key + "\n"
                 "serial = " + tmpdir + "/serial\n"
                 "default_md = sha256\npolicy = policy_any\n"
                 "unique_subject = no\n"
                 "[ policy_any ]\ncommonName = supplied\n"
                 "[ san_ext ]\nsubjectAltName = " + san + "\n")
    run(["openssl", "ca", "-batch", "-config", cfg, "-in", csr,
         "-out", crt, "-startdate", startdate, "-enddate", enddate,
         "-extensions", "san_ext"])
    return crt, key


def serve_once(certfile, keyfile):
    """Serve TLS handshakes on 127.0.0.1 for a few seconds; return the port."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile, keyfile)
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    srv.settimeout(8)
    port = srv.getsockname()[1]

    def run_server():
        try:
            while True:  # the tool may connect twice (verified + fallback)
                conn, _ = srv.accept()
                try:
                    with ctx.wrap_socket(conn, server_side=True) as tls:
                        try:
                            tls.recv(1)  # client closes after the handshake
                        except ssl.SSLError:
                            pass
                except Exception:
                    pass
        except socket.timeout:
            pass
        finally:
            srv.close()

    threading.Thread(target=run_server, daemon=True).start()
    return port


tmpdir = tempfile.mkdtemp(prefix="certwatch-test-")
ca_crt, ca_key = gen_ca(tmpdir)

# 1. Expired certificate -> EXPIRED (verified handshake fails on the date,
#    fallback re-reads the cert to report the real problem).
cert, key = gen_server(tmpdir, ca_crt, ca_key, "expired",
                       "20200101000000Z", "20210101000000Z",
                       "127.0.0.1", "IP:127.0.0.1")
r = cc.check_host("127.0.0.1", serve_once(cert, key), 10, 30, 14,
                  proxy=None, cafile=ca_crt)
check("expired cert -> EXPIRED", r["status"], "EXPIRED")
check("expired cert error label", r["error"], "CERT_EXPIRED")
print(f"  expired cert: {r['status']} ({r['days_left']} days left)")

# 2. Hostname mismatch (CN=example.com, connecting to 127.0.0.1).
cert, key = gen_server(tmpdir, ca_crt, ca_key, "wronghost",
                       "20260101000000Z", "20270101000000Z",
                       "example.com", "DNS:example.com")
r = cc.check_host("127.0.0.1", serve_once(cert, key), 10, 30, 14,
                  proxy=None, cafile=ca_crt)
check("wrong hostname -> ERROR", r["status"], "ERROR")
check("wrong hostname error label", r["error"], "CERT_VERIFICATION_FAILED")
print(f"  wrong-host cert: {r['status']} ({r['error']})")

# 3. Healthy certificate -> OK and verified against the test CA.
cert, key = gen_server(tmpdir, ca_crt, ca_key, "valid",
                       "20260101000000Z", "20270101000000Z",
                       "127.0.0.1", "IP:127.0.0.1")
r = cc.check_host("127.0.0.1", serve_once(cert, key), 10, 30, 14,
                  proxy=None, cafile=ca_crt)
check("valid cert -> OK", r["status"], "OK")
check("valid cert days sane", r["days_left"] > 20, True)
print(f"  valid cert: {r['status']} ({r['days_left']} days left)")

print("  LOCAL TLS TESTS OK")

print("\nAll tests passed.")
