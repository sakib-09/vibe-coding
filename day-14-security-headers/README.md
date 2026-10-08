# HTTP Security Header Checker

A command-line tool that audits a website's HTTP security headers and grades
it **A+ to F** — the same kind of check that security scanners and QA
reviews run against web apps.

## What it does

Point it at a URL and it fetches the response headers, then checks:

| Check | What it defends against |
|-------|------------------------|
| `Strict-Transport-Security` (HSTS) | Attackers downgrading visitors to plain HTTP (SSL-stripping) |
| `Content-Security-Policy` (CSP) | Cross-site scripting (XSS) turning into stolen sessions |
| `X-Frame-Options` / CSP `frame-ancestors` | Clickjacking via invisible iframes |
| `X-Content-Type-Options: nosniff` | MIME-sniffing attacks on uploaded files |
| `Referrer-Policy` | Leaking private URLs/session tokens to other sites |
| `Permissions-Policy` | Abused camera/mic/geolocation access |
| `Cross-Origin-Opener/Embedder-Policy` | Cross-origin data theft between tabs |
| `Server` / `X-Powered-By` banners | Advertising software versions to attackers |
| `Set-Cookie` flags | Session cookies missing `Secure` / `HttpOnly` / `SameSite` |
| HTTP → HTTPS redirect | Visitors stuck on unencrypted HTTP |

Each finding explains **why it matters** in plain language. A missing core
header (HSTS, CSP, X-Frame-Options, nosniff) caps the grade at D, because in
real security reviews those are the findings that actually get flagged.

Standard library only — no dependencies to install.

## How to run

```bash
# Audit one site
python3 headers_check.py https://example.com

# Audit several sites, save machine-readable reports
python3 headers_check.py https://a.com https://b.com --json report.json --csv report.csv

# Read URLs from a file (one per line, # comments allowed)
python3 headers_check.py -f urls.txt --timeout 5
```

Exit code is `1` when any site fails outright — drop it into a cron job or CI
pipeline to catch regressions.

Run the tests (local servers, no network needed):

```bash
python3 test_headers_check.py
```

## Example output

```
$ python3 headers_check.py https://github.com

== https://github.com
   grade: C  (score 79/100)
   [+] hsts            max-age=31536000, includeSubDomains, preload
   [!] csp             present but allows 'unsafe-inline'/'unsafe-eval'
        why it matters: Tells the browser which sources of scripts/styles are allowed. The main defence against cross-site scripting (XSS) turning into stolen sessions.
   [+] xfo             DENY
   [+] nosniff         nosniff
   [+] referrer        origin-when-cross-origin, strict-origin-when-cross-origin
   [!] permissions     header missing - all features allowed by default
   [!] coop            header missing - no cross-origin isolation
   [!] coep            header missing - no cross-origin isolation
   [!] info-disclosure Server: github.com - advertises server software/version to attackers
   [!] cookie          cookie '_octo': missing HttpOnly (readable by JavaScript/XSS)
```

## Files

- `headers_check.py` — the checker (stdlib only)
- `test_headers_check.py` — 6 tests using local HTTP servers with controlled headers
- `urls.txt` — sample URL list for the `-f` option

## Notes

- Uses `GET` (not `HEAD`) because some servers block HEAD requests; it stops
  reading the body immediately, so it's still lightweight.
- Cookie flags are parsed with `http.cookies.SimpleCookie` from the stdlib.
- Grades: A+ ≥95, A ≥90, B ≥80, C ≥70, D ≥60, F <60.
