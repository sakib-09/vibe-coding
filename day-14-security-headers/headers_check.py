#!/usr/bin/env python3
"""
headers_check.py - HTTP Security Header Checker

Point it at a website and it tells you which security headers the site is
missing, what each missing header leaves you exposed to, and gives the site
an overall grade from A+ to F.

Why this exists: when a web app misbehaves, app-support engineers often look
at HTTP responses first. Missing security headers (no clickjacking
protection, no MIME-sniffing guard, cookies without Secure/HttpOnly) are
real findings in QA and security reviews, and "the site sends X-Powered-By"
is the kind of thing a support ticket about a security scan will mention.

Standard library only. No dependencies to install.

Usage:
    python3 headers_check.py https://example.com
    python3 headers_check.py https://a.com https://b.com --json report.json
    python3 headers_check.py -f urls.txt --csv report.csv
    python3 headers_check.py https://example.com --timeout 5
"""

import argparse
import csv
import json
import sys
import urllib.request
import urllib.error
from http.cookies import SimpleCookie

# ---------------------------------------------------------------------------
# What we check, and why. Each entry describes one header, the attack it
# defends against, and how to grade the value we find.
# ---------------------------------------------------------------------------

CHECKS = [
    {
        "id": "hsts",
        "header": "Strict-Transport-Security",
        "why": "Forces browsers to use HTTPS only. Without it, attackers on "
               "the network can downgrade visitors to plain HTTP and steal "
               "sessions (SSL-stripping).",
        "weight": 20,
    },
    {
        "id": "csp",
        "header": "Content-Security-Policy",
        "why": "Tells the browser which sources of scripts/styles are "
               "allowed. The main defence against cross-site scripting (XSS) "
               "turning into stolen sessions.",
        "weight": 20,
    },
    {
        "id": "xfo",
        "header": "X-Frame-Options",
        "why": "Stops other sites embedding this page in an iframe. Without "
               "it, the page can be used in clickjacking attacks (invisible "
               "frames tricking users into clicking things). A CSP "
               "'frame-ancestors' directive covers this too.",
        "weight": 15,
    },
    {
        "id": "nosniff",
        "header": "X-Content-Type-Options",
        "why": "With 'nosniff', browsers won't guess a file's type. Without "
               "it, an uploaded text file can be treated as HTML/JS and run "
               "scripts (MIME-sniffing attacks).",
        "weight": 15,
    },
    {
        "id": "referrer",
        "header": "Referrer-Policy",
        "why": "Controls how much of the URL leaks to other sites in the "
               "Referer header. A lax policy can leak session tokens or "
               "private paths embedded in URLs.",
        "weight": 5,
    },
    {
        "id": "permissions",
        "header": "Permissions-Policy",
        "why": "Restricts which browser features (camera, microphone, "
               "geolocation) the page and its iframes may use. Limits damage "
               "if the page is compromised.",
        "weight": 5,
    },
    {
        "id": "coop",
        "header": "Cross-Origin-Opener-Policy",
        "why": "Isolates the page from other origins at the process level, "
               "blocking cross-origin attacks like Spectre-style data theft "
               "between tabs.",
        "weight": 5,
    },
    {
        "id": "coep",
        "header": "Cross-Origin-Embedder-Policy",
        "why": "Requires cross-origin resources to opt in to being loaded. "
               "Works with COOP to enable full cross-origin isolation.",
        "weight": 5,
    },
]


def grade_header(check_id, value):
    """Return (status, detail) for one header value.

    status is one of "pass", "warn", "fail".
    """
    v = (value or "").strip()

    if check_id == "hsts":
        if not v:
            return "fail", "header missing - site can be downgraded to HTTP"
        parts = [p.strip().lower() for p in v.split(";")]
        max_age = 0
        for p in parts:
            if p.startswith("max-age="):
                try:
                    max_age = int(p.split("=", 1)[1])
                except ValueError:
                    pass
        if max_age < 31536000:
            return "warn", f"max-age={max_age} is under one year (31536000)"
        detail = f"max-age={max_age}"
        if "includesubdomains" in parts:
            detail += ", includeSubDomains"
        if "preload" in parts:
            detail += ", preload"
        return "pass", detail

    if check_id == "csp":
        if not v:
            return "fail", "header missing - no XSS content restrictions"
        low = v.lower()
        if "'unsafe-inline'" in low or "'unsafe-eval'" in low:
            return "warn", "present but allows 'unsafe-inline'/'unsafe-eval'"
        return "pass", "present"

    if check_id == "xfo":
        if not v:
            # frame-ancestors in CSP is the modern replacement
            return "fail", "header missing - page can be iframed (clickjacking)"
        if v.upper() not in ("DENY", "SAMEORIGIN"):
            return "warn", f"unusual value: {v}"
        return "pass", v.upper()

    if check_id == "nosniff":
        if v.lower() == "nosniff":
            return "pass", "nosniff"
        if not v:
            return "fail", "header missing - MIME sniffing possible"
        return "warn", f"unexpected value: {v}"

    if check_id == "referrer":
        if not v:
            return "warn", "header missing - browser default policy applies"
        weak = {"unsafe-url", "no-referrer-when-downgrade"}
        if v.lower() in weak:
            return "warn", f"{v} leaks full URLs to other sites"
        return "pass", v

    if check_id == "permissions":
        if not v:
            return "warn", "header missing - all features allowed by default"
        return "pass", "present"

    if check_id in ("coop", "coep"):
        if not v:
            return "warn", "header missing - no cross-origin isolation"
        return "pass", v

    return "warn", "unknown check"


def check_cookies(headers):
    """Inspect Set-Cookie headers for missing Secure/HttpOnly/SameSite flags.

    Returns a list of finding dicts.
    """
    findings = []
    set_cookies = headers.get_all("Set-Cookie") or []
    for raw in set_cookies:
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:  # malformed cookie line; note it and move on
            findings.append({
                "id": "cookie-malformed",
                "status": "warn",
                "detail": f"could not parse Set-Cookie: {raw[:60]}",
                "why": "Malformed cookies can behave unpredictably across browsers.",
            })
            continue
        for name, morsel in jar.items():
            issues = []
            if not morsel.get("secure"):
                issues.append("missing Secure (cookie sent over plain HTTP)")
            if not morsel.get("httponly"):
                issues.append("missing HttpOnly (readable by JavaScript/XSS)")
            samesite = (morsel.get("samesite") or "").lower()
            if samesite not in ("lax", "strict", "none"):
                issues.append("missing SameSite (CSRF protection)")
            if issues:
                findings.append({
                    "id": "cookie",
                    "status": "fail" if not morsel.get("secure") else "warn",
                    "detail": f"cookie '{name}': " + "; ".join(issues),
                    "why": "Secure/HttpOnly/SameSite are the three flags that "
                           "keep session cookies from being stolen or forged.",
                })
    return findings


def check_info_disclosure(headers):
    """Flag headers that advertise server software versions."""
    findings = []
    for header, attack in (
        ("Server", "advertises server software/version to attackers"),
        ("X-Powered-By", "advertises app framework/version to attackers"),
        ("X-AspNet-Version", "advertises ASP.NET version to attackers"),
    ):
        value = headers.get(header)
        if value:
            findings.append({
                "id": "info-disclosure",
                "status": "warn",
                "detail": f"{header}: {value} - {attack}",
                "why": "Version banners help attackers pick known exploits. "
                       "Hide them in server config.",
            })
    return findings


def check_https_redirect(url, final_url):
    """If the user gave an http:// URL, did the site push us to https?"""
    if url.lower().startswith("http://") and final_url.lower().startswith("https://"):
        return {"id": "https-redirect", "status": "pass",
                "detail": "http:// redirects to https://",
                "why": "Every visitor gets upgraded to an encrypted connection."}
    if url.lower().startswith("http://"):
        return {"id": "https-redirect", "status": "fail",
                "detail": "http:// does NOT redirect to https://",
                "why": "Visitors can stay on unencrypted HTTP; credentials and "
                       "sessions travel in cleartext."}
    return None


def fetch_headers(url, timeout):
    """GET the URL (some servers block HEAD) and return (headers, final_url).

    Raises URLError / HTTPError / socket.timeout etc. on failure.
    """
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "headers-check/1.0 (security header audit)"},
        method="GET",
    )
    # We only need headers; abort reading the body right away.
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        final_url = resp.geturl()
        headers = resp.headers
        try:
            resp.read(1)
        except Exception:
            pass
    return headers, final_url


def audit_url(url, timeout=10):
    """Audit one URL. Returns a result dict with findings and a score."""
    result = {"url": url, "error": None, "findings": [],
              "score": 0, "grade": "F", "final_url": url}
    try:
        headers, final_url = fetch_headers(url, timeout)
    except Exception as exc:  # network/DNS/TLS failure - report, don't crash
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result

    result["final_url"] = final_url
    csp_value = headers.get("Content-Security-Policy", "")

    for check in CHECKS:
        # X-Frame-Options is covered if CSP already has frame-ancestors.
        if (check["id"] == "xfo" and not headers.get("X-Frame-Options")
                and "frame-ancestors" in csp_value.lower()):
            result["findings"].append({
                "id": "xfo", "status": "pass",
                "detail": "covered by CSP frame-ancestors",
                "why": CHECKS[2]["why"],
            })
            result["score"] += check["weight"]
            continue
        status, detail = grade_header(check["id"], headers.get(check["header"]))
        result["findings"].append({
            "id": check["id"], "status": status, "detail": detail,
            "why": check["why"],
        })
        if status == "pass":
            result["score"] += check["weight"]
        elif status == "warn":
            result["score"] += check["weight"] // 2

    redirect = check_https_redirect(url, final_url)
    if redirect:
        result["findings"].append(redirect)

    result["findings"].extend(check_info_disclosure(headers))
    result["findings"].extend(check_cookies(headers))

    # Extra penalty: any outright failure on a heavyweight header drops the grade.
    fails = sum(1 for f in result["findings"]
                if f["status"] == "fail" and f["id"] in ("hsts", "csp", "xfo", "nosniff"))
    total_weight = sum(c["weight"] for c in CHECKS)
    score = round(result["score"] * 100 / total_weight)
    if fails:
        score = min(score, 59)  # cap at D when a core header fails outright

    if score >= 95:
        grade = "A+"
    elif score >= 90:
        grade = "A"
    elif score >= 80:
        grade = "B"
    elif score >= 70:
        grade = "C"
    elif score >= 60:
        grade = "D"
    else:
        grade = "F"
    result["score"] = score
    result["grade"] = grade
    return result


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

STATUS_ICON = {"pass": "[+]", "warn": "[!]", "fail": "[-]"}


def print_report(result):
    print(f"\n== {result['url']}")
    if result["error"]:
        print(f"   ERROR: {result['error']}")
        return
    if result["final_url"] != result["url"]:
        print(f"   final URL: {result['final_url']}")
    print(f"   grade: {result['grade']}  (score {result['score']}/100)")
    for f in result["findings"]:
        icon = STATUS_ICON.get(f["status"], "[?]")
        print(f"   {icon} {f['id']:15} {f['detail']}")
        if f["status"] != "pass":
            print(f"        why it matters: {f['why']}")


def write_json(results, path):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2)
    print(f"\nJSON report written to {path}")


def write_csv(results, path):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["url", "grade", "score", "check", "status", "detail"])
        for r in results:
            if r["error"]:
                w.writerow([r["url"], "ERROR", "", "", "", r["error"]])
                continue
            for f in r["findings"]:
                w.writerow([r["url"], r["grade"], r["score"],
                            f["id"], f["status"], f["detail"]])
    print(f"\nCSV report written to {path}")


def load_urls(args):
    urls = list(args.url)
    if args.file:
        with open(args.file, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#"):
                    urls.append(line)
    # Add a scheme when the user types a bare domain.
    fixed = []
    for u in urls:
        if "://" not in u:
            u = "https://" + u
        fixed.append(u)
    return fixed


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Audit a website's HTTP security headers and grade it A+ to F.")
    parser.add_argument("url", nargs="*", help="URL(s) to audit")
    parser.add_argument("-f", "--file", help="file with one URL per line")
    parser.add_argument("--timeout", type=float, default=10,
                        help="request timeout in seconds (default 10)")
    parser.add_argument("--json", metavar="PATH", help="write JSON report to PATH")
    parser.add_argument("--csv", metavar="PATH", help="write CSV report to PATH")
    args = parser.parse_args(argv)

    urls = load_urls(args)
    if not urls:
        parser.error("give at least one URL (or -f urls.txt)")

    results = []
    for url in urls:
        print(f"Checking {url} ...", file=sys.stderr)
        result = audit_url(url, timeout=args.timeout)
        results.append(result)
        print_report(result)

    if args.json:
        write_json(results, args.json)
    if args.csv:
        write_csv(results, args.csv)

    # Exit non-zero when any site fails outright: handy for CI / cron jobs.
    broken = any(r["error"] or any(f["status"] == "fail" for f in r["findings"])
                 for r in results)
    return 1 if broken else 0


if __name__ == "__main__":
    sys.exit(main())
