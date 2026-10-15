# Day 21 — DecodeX: Error Code Decoder

A single-file web app (zero dependencies) that turns any error code into a
plain-English diagnosis a support agent can act on — and paste straight into
a ticket.

## What it does

Paste an error code and DecodeX returns:

- **Plain-English meaning** — what the code actually says, without jargon
- **Severity badge** — INFO / WARNING / ERROR / CRITICAL
- **Likely causes** — the usual suspects, support-desk style
- **Troubleshooting steps** — ordered, concrete next actions
- **Copy ticket summary** — a one-click, paste-ready summary for the ticket

It also **decodes Windows HRESULTs bit-by-bit** (severity / facility / code),
so even codes *not* in the database get a useful partial diagnosis. For
`FACILITY_WIN32` codes (e.g. `0x80070005`) it automatically maps the low
16 bits back to the underlying Win32 error (e.g. Win32 `5` — Access is denied).

### Code families covered (~100 entries)

| Family | Examples |
|---|---|
| HTTP status codes | 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504 … |
| Windows HRESULT | 0x80070005, 0x80070002, 0x80004005, 0xC0000005, 0x80070643 … |
| Windows Win32 codes | 5, 53, 67, 1326, 1327, 1909, 1058, 1067 … |
| POSIX / Node errno | EACCES, ENOENT, ECONNREFUSED, ETIMEDOUT, ENOSPC, EADDRINUSE … |
| SMTP mail codes | 421, 450, 550, 552, 554 … |
| DNS & browser network | NXDOMAIN, SERVFAIL, ERR_NAME_NOT_RESOLVED, ERR_SSL_PROTOCOL_ERROR … |
| Browser & JavaScript | Failed to fetch, CORS error, "…is not a function", "Cannot read properties of null", QuotaExceededError … |

Unknown codes get a support-desk playbook instead of a dead end:
search tips, `net helpmsg` (Windows), `errno` (Linux), and where to look in
Event Viewer / journalctl / DevTools.

## How to run

No build step, no server, no internet needed. Just open the file:

```bash
# macOS / Linux
xdg-open index.html   # or: open index.html

# or serve it locally
python3 -m http.server 8000
# then visit http://localhost:8000
```

Type a code (e.g. `0x80070005`, `EACCES`, `550`, `NXDOMAIN`,
`Failed to fetch`) and press **Enter**. Use the category chips to narrow
results. Try the search box with plain words too — `"access denied"` or
`"timeout"` find matches by title, tags, and meaning.

## Tests

The decode/lookup logic lives in the first `<script>` block and is
browser-free, so the test harness extracts it and runs it in Node:

```bash
node test.js
# 45 passed, 0 failed
```

Covers: exact lookup across all 6 families, prefix stripping
(`"Error 401"`, `"HTTP 429"`), hex without `0x`, signed-decimal HRESULTs,
HRESULT bit decomposition + FACILITY_WIN32 mapping, ranked search with
category filters, unknown-code handling, and ticket-summary formatting.

## Example output

```
Error: 0x80070005 — E_ACCESSDENIED — Access is denied
Category: Windows HRESULT
Meaning: Windows refused the operation because of permissions.
         The low 16 bits decode to Win32 error 5 (Access is denied).
Likely causes: File/folder ACLs do not grant access. | App not running
         as administrator. | Service logon account lacks rights.
Next steps: Check the effective permissions (Properties → Security →
         Advanced → Effective Access). | Run elevated if the task needs
         admin rights. | Check Event Viewer for the matching audit entry.
```

## Why this matters for support work

Decoding error codes is a daily support-desk skill: users paste cryptic
codes into tickets, and the agent who can instantly tell a permissions
problem from a DNS problem from a dead backend resolves tickets faster.
The HRESULT bit layout (severity / facility / code) is exactly how Windows
engineers read these codes — knowing it turns "mystery hex" into a lead.

## Files

- `index.html` — the whole app (markup + styles + logic + UI), ~110 KB
- `test.js` — Node test harness (45 assertions)
