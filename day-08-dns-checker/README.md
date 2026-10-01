# Day 08 — DNS Health Checker

A Node.js CLI (standard library only — no npm packages) that audits a domain's
DNS configuration and reports the problems an IT support or network admin would
actually care about:

- **A / AAAA records** — does the domain resolve to an IP?
- **MX records** — can it receive email, and does each mail server resolve?
- **SPF (TXT)** — is email spoofing guarded?
- **DMARC (`_dmarc.<domain>`)** — is a DMARC policy published?
- **Nameservers** — at least two, and each one must resolve (single NS = single point of failure)
- **Reverse DNS (PTR)** — does the main IP reverse-resolve? (mail servers and some firewalls require it)
- **Wildcard DNS** — warns when `*.domain` resolves, which is often unintentional

Each check gets a status (`PASS` / `WARN` / `FAIL` / `INFO`) and an overall
verdict per domain. Exit code is `1` when any check fails, so it can run in CI
or a monitoring script. Reports can be written to JSON or CSV.

## How to run

```bash
node dns-checker.js example.com github.com
node dns-checker.js --file domains.txt        # one domain per line, # = comment
node dns-checker.js example.com --json report.json
node dns-checker.js example.com --csv report.csv
node dns-checker.js --help
```

Run the unit tests (pure helpers, no network needed):

```bash
node test.js
```

## Example output

```
$ node dns-checker.js example.com

=== example.com  [WARN] ===
  [✓ PASS] A record: resolves to 93.184.216.34
  [· INFO] AAAA record: no IPv6 address (optional)
  [! WARN] MX records: no mail servers (ENODATA) — domain cannot receive email
  [! WARN] SPF record: no SPF record — anyone can spoof this domain in email
  [· INFO] DMARC record: no DMARC record at _dmarc.<domain> (recommended for email domains)
  [✓ PASS] Nameserver count: 2: a.iana-servers.net, b.iana-servers.net
  [✓ PASS] Nameserver a.iana-servers.net: resolves to 199.43.135.53
  [✓ PASS] Nameserver b.iana-servers.net: resolves to 199.43.133.53
  [✓ PASS] Reverse DNS (PTR): 93.184.216.34 -> example.com
  [✓ PASS] Wildcard DNS: random subdomain does not resolve (good)

--- Summary ---
  [WARN] example.com

All domains healthy (no failures).
```

*(Sample above shows a real-world-shaped result. The automated tests were run in
a sandboxed environment whose stub DNS resolver answers with test addresses, so
`test.js` covers all the pure logic while the live queries were verified to
classify resolver errors correctly.)*

## How it works

- `dns/promises` (built into Node) does the actual lookups: `resolve4`,
  `resolve6`, `resolveMx`, `resolveNs`, `resolveTxt`, plus `dns.reverse` for PTR.
- Every query goes through `withTimeout()` (`Promise.race` against a timer)
  because DNS libraries don't always time out on their own — a dead resolver
  would otherwise hang the tool.
- Each check returns the same `{ name, status, detail }` shape, so the console,
  JSON, and CSV outputs are all generated from one data structure.
- `scoreAudit()` computes the verdict: one `FAIL` beats any number of `WARN`s.
- Domains are audited in batches of 4 so the local resolver isn't flooded.
