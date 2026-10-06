# Cert Watch — SSL/TLS Certificate Expiry Checker

Day 12 of the vibe-coding series. A Python CLI (standard library only) that
checks when HTTPS certificates expire for a list of hosts and flags the ones
about to run out — the kind of proactive monitoring IT support and systems
admin teams run to prevent outages.

## Why this matters

Expired certificates are one of the most common *avoidable* production
outages: one forgotten renewal and every user sees a scary browser warning.
Support teams track certificate expiry dates and renew them weeks ahead. This
tool does exactly that check automatically, in a form that can run from cron.

## Run it

Needs Python 3 (no packages to install) and internet access.

```bash
# Check a few hosts directly
python3 cert_checker.py example.com github.com example.com:8443

# Check a list of hosts from a file (one per line, # = comment)
python3 cert_checker.py --file hosts.txt

# Custom warning thresholds: warn under 60 days, critical under 7
python3 cert_checker.py --file hosts.txt --warn 60 --crit 7

# Save JSON / CSV reports alongside the table
python3 cert_checker.py --file hosts.txt --json report.json --csv report.csv

# Offices behind a proxy: HTTPS_PROXY is picked up automatically;
# --proxy overrides it, --no-proxy forces a direct connection
python3 cert_checker.py --file hosts.txt --proxy http://proxy.corp:8080

# Internal servers with a corporate CA
python3 cert_checker.py intranet.corp --cafile /etc/ssl/corp-ca.pem
```

`hosts.txt` in this folder has sample entries, including two
[badssl.com](https://badssl.com) hosts that deliberately demonstrate the
error handling on a normal network: `expired.badssl.com` shows an EXPIRED
cert and `wrong.host.badssl.com` fails hostname verification.

## Example output

```
STATUS     HOST                           DAYS LEFT EXPIRES      ISSUER                   NOTE
------------------------------------------------------------------------------------------------
OK         github.com                            62 2026-12-07   DigiCert Inc.
OK         example.com                           62 2026-12-07   DigiCert Inc.
EXPIRED    expired.badssl.com                    -6 2026-09-30   COMODO CA Limited
ERROR      wrong.host.badssl.com                  - -            -                          CERT_VERIFICATION_FAILED: ...

Checked 4 host(s): 2 ok, 1 expired, 1 error
```

Exit code is `1` when anything is not OK, so it plays well with cron or CI:
an expired cert can page someone *before* users notice.

## How it works

1. Opens a TCP connection to the host's TLS port (default 443), then runs a
   TLS handshake with `ssl.create_default_context()` — the same verification
   a browser does, including hostname checking.
2. Sends **SNI** (`server_hostname`), so servers hosting many sites on one IP
   return the right certificate. If an `HTTPS_PROXY` is set, the handshake is
   tunnelled through it with HTTP CONNECT — still end-to-end with the target.
3. **Two-phase verification:** if the certificate fails verification, the
   tool reconnects *without* verifying, purely to read the certificate. An
   unverified handshake doesn't hand back the parsed cert dict, so the tool
   walks the raw DER bytes itself (`parse_der_expiry`) to find `notAfter`.
   This is what lets it report EXPIRED instead of a generic error, while
   still flagging a hostname mismatch as `CERT_VERIFICATION_FAILED`.
4. Grades the result: **OK** / **WARNING** (under `--warn` days) /
   **CRITICAL** (under `--crit` days) / **EXPIRED**, or **ERROR** with a
   specific label (`TIMEOUT`, `DNS_LOOKUP_FAILED`, `CONNECTION_REFUSED`,
   `CERT_VERIFICATION_FAILED`, `TLS_HANDSHAKE_FAILED`, `PROXY_ERROR`) when
   the check itself fails.

## Test it

```bash
python3 test_cert_checker.py
```

21 offline assertions (host parsing, expiry math, grading, error labels,
proxy picking), an offline DER-parsing check, a live handshake against
`github.com`, and three end-to-end scenarios against a local TLS server with
a throwaway test CA: an expired cert (must report EXPIRED), a hostname
mismatch (must report CERT_VERIFICATION_FAILED), and a healthy cert (must
report OK and verify). The live check skips gracefully if there's no
internet.
