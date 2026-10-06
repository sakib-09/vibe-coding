#!/usr/bin/env python3
"""
Cert Watch -- SSL/TLS certificate expiry checker.

Why this exists: expired (or about-to-expire) certificates are one of the
most common -- and most avoidable -- causes of production outages. Monitoring
certs proactively is bread-and-butter work for IT support / systems admin /
app-support roles.

What it does: connects to each host over TLS, reads the server's certificate,
and reports how many days are left until it expires.

Usage:
    python3 cert_checker.py example.com www.example.com:8443
    python3 cert_checker.py --file hosts.txt
    python3 cert_checker.py --file hosts.txt --json report.json
    python3 cert_checker.py --file hosts.txt --csv report.csv --warn 60 --crit 14
    python3 cert_checker.py --file hosts.txt --proxy http://proxy.corp:8080
    python3 cert_checker.py intranet.corp --cafile /etc/ssl/corp-ca.pem

Exit code: 0 = all OK, 1 = at least one WARNING or worse, 2 = usage error.

Only the Python standard library is used (socket, ssl, datetime, argparse).
"""

import argparse
import csv
import http.client
import json
import os
import socket
import ssl
import sys
from datetime import datetime, timezone
from urllib.parse import urlparse

DEFAULT_PORT = 443
DEFAULT_TIMEOUT = 10

# Statuses, in increasing order of severity.
STATUS_OK = "OK"
STATUS_WARNING = "WARNING"      # expiring soon
STATUS_CRITICAL = "CRITICAL"    # expiring very soon
STATUS_EXPIRED = "EXPIRED"      # already past its expiry date
STATUS_ERROR = "ERROR"          # could not check the host at all


def parse_host_arg(arg):
    """Turn 'host', 'host:port' or 'https://host:port/path' into (host, port).

    >>> parse_host_arg("example.com")
    ('example.com', 443)
    >>> parse_host_arg("example.com:8443")
    ('example.com', 8443)
    >>> parse_host_arg("https://www.example.com:8443/path")
    ('www.example.com', 8443)
    """
    arg = arg.strip()
    # Drop a scheme or path if someone pastes a full URL.
    if "://" in arg:
        arg = arg.split("://", 1)[1]
    arg = arg.split("/", 1)[0]
    # Split host and optional port. rsplit handles IPv6-style [::1]:8443.
    if arg.startswith("["):
        host, _, rest = arg.partition("]:")
        return host[1:], int(rest) if rest else DEFAULT_PORT
    if ":" in arg:
        host, _, port = arg.rpartition(":")
        return host or arg, int(port)
    return arg, DEFAULT_PORT


def pick_proxy(host, explicit=None):
    """Decide which HTTPS proxy (if any) to use for this host.

    Many offices route web traffic through a proxy. We respect the usual
    HTTPS_PROXY environment variable (and skip hosts listed in NO_PROXY),
    while --proxy overrides everything and --no-proxy forces a direct run.
    """
    if explicit is not None:
        return explicit  # --proxy URL given on the command line
    no_proxy = (os.environ.get("no_proxy") or os.environ.get("NO_PROXY") or "")
    for entry in (e.strip().lstrip(".") for e in no_proxy.split(",")):
        if entry and (host == entry or host.endswith("." + entry)):
            return None
    return (os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY")
            or None)


def _handshake(host, port, timeout, proxy, verify, cafile=None):
    """Do the raw TLS handshake.

    Returns the peer's parsed certificate dict when verify=True, or the raw
    DER bytes when verify=False. (Python's getpeercert() only returns the
    parsed dict for verified handshakes; the DER bytes are always available,
    so we parse the expiry date ourselves in that case.)
    """
    if verify:
        # create_default_context() verifies cert chain + hostname, like a
        # browser. cafile lets you add an internal/corporate CA on top of
        # the system trust store.
        context = ssl.create_default_context(cafile=cafile)
        context.check_hostname = True
    else:
        # Unverified context: ONLY used to *read* a failing certificate's
        # expiry date. Never used to trust the connection.
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    if proxy:
        # Talk TLS to the real server through the proxy with an HTTP CONNECT
        # tunnel -- the handshake stays end-to-end with the target host.
        parts = urlparse(proxy if "://" in proxy else f"http://{proxy}")
        conn = http.client.HTTPSConnection(parts.hostname,
                                           parts.port or 8080,
                                           timeout=timeout,
                                           context=context)
        conn.set_tunnel(host, port)  # SNI travels inside the TLS handshake
        try:
            conn.connect()
            return (conn.sock.getpeercert() if verify
                    else conn.sock.getpeercert(binary_form=True))
        finally:
            conn.close()

    # SNI: server_hostname lets the server pick the right certificate,
    # exactly like a browser does. Without it, shared-hosting servers
    # return the wrong (often default) certificate.
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with context.wrap_socket(sock, server_hostname=host) as tls_sock:
            return (tls_sock.getpeercert() if verify
                    else tls_sock.getpeercert(binary_form=True))


def fetch_certificate(host, port, timeout, proxy=None, cafile=None):
    """Return (payload, verified) for a TLS handshake.

    payload is the parsed certificate dict when the handshake verified, or
    the raw DER bytes when verification failed but the certificate was
    still readable. A fully verified handshake is tried first; if the
    certificate fails verification we reconnect *without* verification
    purely to read the certificate -- this lets us report EXPIRED instead
    of a generic error, and still tell a hostname mismatch apart from a
    merely old cert.
    """
    try:
        return (_handshake(host, port, timeout, proxy, verify=True,
                           cafile=cafile), True)
    except ssl.SSLCertVerificationError as first_error:
        try:
            cert = _handshake(host, port, timeout, proxy, verify=False,
                              cafile=cafile)
        except Exception:
            raise first_error  # unreadable: keep the original error
        return cert, False


def parse_expiry(cert):
    """Return the certificate's expiry as an aware datetime (UTC).

    Python gives us cert['notAfter'] like 'Nov 12 12:00:00 2026 GMT'.
    """
    return datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z") \
        .replace(tzinfo=timezone.utc)


def _read_tlv(data, offset):
    """Read one DER tag-length-value triple.

    Returns (tag, value_bytes, next_offset). Lengths use DER's short form
    (one byte) or long form (first byte 0x8n -> n length bytes follow).
    """
    tag = data[offset]
    first = data[offset + 1]
    if first & 0x80 == 0:
        length, header = first, 2
    else:
        n = first & 0x7F
        length = int.from_bytes(data[offset + 2:offset + 2 + n], "big")
        header = 2 + n
    start = offset + header
    return tag, data[start:start + length], start + length


def parse_der_expiry(der):
    """Pull notAfter out of raw DER certificate bytes (no verification).

    Walks Certificate -> tbsCertificate -> validity -> notAfter, then reads
    the time: UTCTime (tag 0x17, 'YYMMDDHHMMSSZ') or GeneralizedTime
    (tag 0x18, 'YYYYMMDDHHMMSSZ'). Years < 50 mean 20xx, else 19xx --
    that's the X.509 rule for two-digit years.
    """
    _, cert_body, _ = _read_tlv(der, 0)       # Certificate SEQUENCE
    _, tbs_body, _ = _read_tlv(cert_body, 0)  # tbsCertificate SEQUENCE
    offset = 0
    if tbs_body[0] == 0xA0:                   # optional [0] version field
        _, _, offset = _read_tlv(tbs_body, 0)
    for _ in range(3):                        # serial, signature, issuer
        _, _, offset = _read_tlv(tbs_body, offset)
    _, validity_body, _ = _read_tlv(tbs_body, offset)  # validity SEQUENCE
    _, _, offset = _read_tlv(validity_body, 0)         # skip notBefore
    tag, raw, _ = _read_tlv(validity_body, offset)     # notAfter
    text = raw.decode("ascii").rstrip("Z")
    if tag == 0x17:                           # UTCTime
        year = int(text[:2])
        stamp = f"{year + (2000 if year < 50 else 1900)}{text[2:]}"
    else:                                     # GeneralizedTime
        stamp = text
    return datetime.strptime(stamp[:14], "%Y%m%d%H%M%S") \
        .replace(tzinfo=timezone.utc)


def days_until(expiry):
    """Whole days left until expiry; negative if already expired."""
    now = datetime.now(timezone.utc)
    return (expiry - now).days


def grade(days_left, warn_days, crit_days):
    """Classify urgency. Thresholds come from the CLI flags."""
    if days_left < 0:
        return STATUS_EXPIRED
    if days_left <= crit_days:
        return STATUS_CRITICAL
    if days_left <= warn_days:
        return STATUS_WARNING
    return STATUS_OK


def describe_cert(cert):
    """Pull human-friendly bits out of the certificate dict."""
    subject = dict(pair[0] for pair in cert.get("subject", ()))
    issuer = dict(pair[0] for pair in cert.get("issuer", ()))
    return subject.get("commonName", "?"), issuer.get("organizationName", "?")


def classify_error(exc):
    """Map low-level exceptions to the labels a support report would show."""
    if isinstance(exc, socket.timeout):
        return "TIMEOUT"
    if isinstance(exc, socket.gaierror):
        return "DNS_LOOKUP_FAILED"
    if isinstance(exc, ConnectionRefusedError):
        return "CONNECTION_REFUSED"
    if isinstance(exc, ssl.SSLCertVerificationError):
        return "CERT_VERIFICATION_FAILED"
    if isinstance(exc, ssl.SSLError):
        return "TLS_HANDSHAKE_FAILED"
    if isinstance(exc, http.client.HTTPException):
        return "PROXY_ERROR"
    return type(exc).__name__


def check_host(host, port, timeout, warn_days, crit_days, proxy=None,
             cafile=None):
    """Run the full check for one host; return a result dict."""
    result = {"host": host, "port": port}
    try:
        payload, verified = fetch_certificate(host, port, timeout,
                                              proxy, cafile)
    except Exception as exc:  # keep every failure as a data row, not a crash
        result.update(status=STATUS_ERROR, error=classify_error(exc),
                      details=str(exc)[:120], days_left=None,
                      expires=None, subject=None, issuer=None)
        return result
    if verified:
        expiry = parse_expiry(payload)
        subject, issuer = describe_cert(payload)
    else:
        # payload is raw DER bytes: parse the dates by hand.
        expiry = parse_der_expiry(payload)
        subject, issuer = "?", "?"
    left = days_until(expiry)
    status = grade(left, warn_days, crit_days)
    if not verified and status != STATUS_EXPIRED:
        # Certificate read fine but hostname/chain didn't verify -- that's a
        # real problem even if the date is OK (e.g. wrong.host.badssl.com).
        status, error = STATUS_ERROR, "CERT_VERIFICATION_FAILED"
    elif not verified:
        error = "CERT_EXPIRED"
    else:
        error = None
    result.update(status=status, error=error, details=None, days_left=left,
                  expires=expiry.strftime("%Y-%m-%d"),
                  subject=subject, issuer=issuer)
    return result


def print_table(results):
    """Fixed-width table a human can scan at a glance."""
    widths = {"status": 10, "host": 30, "days": 10, "expires": 12, "issuer": 24}
    header = (f"{'STATUS':<{widths['status']}} {'HOST':<{widths['host']}} "
              f"{'DAYS LEFT':>{widths['days']}} {'EXPIRES':<{widths['expires']}} "
              f"{'ISSUER':<{widths['issuer']}} NOTE")
    print(header)
    print("-" * len(header))
    for r in results:
        host = r["host"] if r["port"] == DEFAULT_PORT \
            else f"{r['host']}:{r['port']}"
        days = str(r["days_left"]) if r["days_left"] is not None else "-"
        expires = r["expires"] or "-"
        issuer = (r["issuer"] or "-")[:widths["issuer"]]
        note = r["details"] if r["status"] == STATUS_ERROR else ""
        print(f"{r['status']:<{widths['status']}} {host:<{widths['host']}} "
              f"{days:>{widths['days']}} {expires:<{widths['expires']}} "
              f"{issuer:<{widths['issuer']}} {note}")
    print()
    counts = {}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    summary = ", ".join(f"{counts[s]} {s.lower()}" for s in
                        (STATUS_OK, STATUS_WARNING, STATUS_CRITICAL,
                         STATUS_EXPIRED, STATUS_ERROR) if s in counts)
    print(f"Checked {len(results)} host(s): {summary}")


def write_json(results, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2)
    print(f"JSON report written to {path}")


def write_csv(results, path):
    fields = ["status", "host", "port", "days_left", "expires",
              "subject", "issuer", "error", "details"]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for r in results:
            writer.writerow({f: r.get(f, "") for f in fields})
    print(f"CSV report written to {path}")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Check SSL/TLS certificate expiry dates for one or more hosts.")
    parser.add_argument("hosts", nargs="*",
                        help="hosts to check (host, host:port, or full URL)")
    parser.add_argument("--file", "-f",
                        help="read hosts from a file (one per line, # = comment)")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT,
                        help=f"seconds per connection (default {DEFAULT_TIMEOUT})")
    parser.add_argument("--warn", type=int, default=30,
                        help="warn when fewer than N days remain (default 30)")
    parser.add_argument("--crit", type=int, default=14,
                        help="critical when fewer than N days remain (default 14)")
    parser.add_argument("--json", metavar="PATH", help="write JSON report")
    parser.add_argument("--csv", metavar="PATH", help="write CSV report")
    proxy_group = parser.add_mutually_exclusive_group()
    proxy_group.add_argument("--proxy", metavar="URL",
                             help="route through this HTTPS proxy "
                                  "(default: respect HTTPS_PROXY env var)")
    proxy_group.add_argument("--no-proxy", action="store_true",
                             help="connect directly, ignoring proxy env vars")
    parser.add_argument("--cafile", metavar="PATH",
                        help="extra CA bundle for internal/corporate CAs")
    args = parser.parse_args(argv)

    targets = list(args.hosts)
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            targets.extend(line.split("#", 1)[0].strip()
                           for line in fh if line.split("#", 1)[0].strip())
    if not targets:
        parser.error("give at least one host, or --file hosts.txt")

    results = []
    for raw in targets:
        host, port = parse_host_arg(raw)
        proxy = None if args.no_proxy else pick_proxy(host, args.proxy)
        results.append(check_host(host, port, args.timeout,
                                  args.warn, args.crit, proxy,
                                  args.cafile))

    print_table(results)
    if args.json:
        write_json(results, args.json)
    if args.csv:
        write_csv(results, args.csv)

    # Non-zero exit when anything needs attention -- handy for cron/CI.
    return 1 if any(r["status"] != STATUS_OK for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
