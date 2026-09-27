# Day 04 — QA Link Checker

A command-line link checker for QA and website maintenance. Hand it a list of
URLs and it reports which ones are alive, which redirect, and which are broken
— with response times, redirect chains, and a JSON/CSV report. Exits non-zero
when any link is broken, so it can run inside a CI pipeline.

No dependencies: pure Node.js standard library (`http`, `https`, `fs`).

## What it checks

- **HTTP status** for every URL (tries cheap `HEAD` first, falls back to `GET`
  when a server rejects `HEAD` with 405)
- **Redirect chains** — follows up to 5 redirects and records every hop
- **Response time** in milliseconds for each final response
- **Failure reasons** classified as `timeout`, `dns-error`, `connection-error`,
  `ssl-error`, `broken` (4xx/5xx), or `too-many-redirects`

## How to run

```bash
node link-checker.js urls.example.txt
node link-checker.js https://example.com https://example.com/nope
node link-checker.js urls.txt --timeout 8 --concurrency 5 --out report.json --csv
```

The URL file is one URL per line; lines starting with `#` are ignored, and
`https://` is added when missing.

Options:

| Flag | Default | Meaning |
|------|---------|---------|
| `--timeout N` | 10 | seconds before a URL counts as timed out |
| `--concurrency N` | 5 | how many URLs to check in parallel |
| `--out FILE` | — | write a JSON report to FILE |
| `--csv` | off | also write a CSV report next to the JSON one |

Exit code: `0` = all links fine, `1` = at least one broken, `2` = usage error.

## Example output

```
[1/5] OK    https://example.com  (200 in 432ms)
[2/5] FAIL  https://example.com/this-page-does-not-exist  (broken)
[3/5] OK    https://github.com  (200 in 527ms)
[4/5] REDIR http://github.com  (200 in 420ms)
[5/5] FAIL  https://this-domain-should-not-exist-xyz123.com  (connection-error)

----- Summary -----
Checked : 5
ok                  : 2
broken              : 1
redirect-ok         : 1
connection-error    : 1

Broken links:
  - https://example.com/this-page-does-not-exist  [broken] 404
  - https://this-domain-should-not-exist-xyz123.com  [connection-error] ECONNRESET: socket hang up
```

## Concepts it uses

- `http`/`https` request/response lifecycle and status code families
- HEAD vs GET, redirect status codes (301/302/307/308), relative `Location`
  headers resolved with the `URL` constructor
- Concurrency limiting with a simple worker-pool pattern (`Promise.all` over
  N workers sharing one index)
- Timeouts via `req.setTimeout` and error classification from Node error codes
  (`ENOTFOUND`, `ECONNREFUSED`, …)
