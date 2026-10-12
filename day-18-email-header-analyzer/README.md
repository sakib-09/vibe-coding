# Day 18 — MailTrail: Email Header Analyzer

A single-file web app that turns a wall of raw email headers into something a
support analyst can actually read: who sent it, how it got here, whether it
passes SPF / DKIM / DMARC, and whether anything smells phishy. Email triage is
daily work on IT support desks, service desks, and security teams — reading
headers is one of the first skills they teach you.

## What it does

- Paste raw headers (or a full raw message — the body is ignored) and get:
  - **Message summary** — From, To, Subject, Date, Return-Path, Reply-To, Message-ID, with RFC 2047 encoded words (e.g. `=?UTF-8?B?...?=`) decoded
  - **Authentication panel** — parses every `Authentication-Results` header into SPF / DKIM / DMARC results with pass / fail / inconclusive badges and the domains they apply to
  - **Received path timeline** — each hop's from/by host and IP, timestamps, and per-hop delay (flags delays over 30 min and clock skew)
  - **Security checks** — phishing red flags with plain-language explanations: SPF/DKIM/DMARC failures, From vs. Return-Path mismatch, Reply-To going elsewhere, DKIM domain not aligning with From, missing auth results, missing Message-ID, private IPs in the path
  - **Verdict banner** — Looks legitimate / Review recommended / Suspicious
- Two built-in samples to learn from: one clean message, one phishing attempt (try the suspicious one — watch the checks light up)
- **Copy text summary** — paste findings straight into a ticket; **Download JSON report** for records
- 100% client-side, zero network calls — pasted headers never leave the page

## How to run

No build, no dependencies. Open `index.html` in any modern browser:

```bash
# macOS / Linux
open index.html        # or: xdg-open index.html
```

Or serve it locally:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Example

1. Click **Load suspicious sample** → the phishing message is analyzed.
2. Verdict: **Suspicious — treat with caution**. SPF and DKIM both FAILED, the
   visible `From: security@notice-paypal.com` doesn't match the envelope sender
   `bounce@phish-attacker.net`, and replies would go to `help@phish-attacker.net`.
3. Click **Copy text summary** → paste the findings into a ticket or a chat with
   the user who reported it.
4. Click **Load clean sample** to see what a healthy message looks like: all
   three auth checks pass and the only notes are informational.

## Files

| File | What it is |
|------|------------|
| `index.html` | The whole app: markup, CSS, and two `<script>` blocks (pure logic, then the UI layer) |
| `test.js` | Node unit tests: document sanity checks + 42 assertions against the logic layer (`node test.js`) |
| `README.md` | This file |

## How the code works

- The first `<script>` block is **browser-free pure logic**: `unfoldHeaders` (RFC 5322 continuation-line folding), `decodeWords` (hand-rolled base64 + UTF-8 + quoted-printable decoder — no `atob`, no `Buffer`), `extractAddress`, `parseAuthResults` (splits on `;` while ignoring separators inside `(comments)`), `parseReceived` (from/by host+IP, timestamp), `computeDelays`, `isPrivateIp`, and `analyze`, which ties it all together into summary + auth + hops + checks + verdict. It exposes everything on `globalThis.__mhaLogic`.
- The second `<script>` block is the **UI layer** (guarded: it no-ops without `#hdrInput` in the DOM). It renders the verdict, summary table, auth badges, hop timeline, and checks list, and wires up the sample loaders, copy-to-clipboard, and JSON download.
- All user-supplied text is rendered through `escapeHtml` — pasted headers can contain anything, so this is non-negotiable.

## Tests

```bash
node test.js   # expect: 42 passed, 0 failed
```

Tests extract the logic block from `index.html`, run it in a Node `vm` sandbox, and
assert unfolding, encoded-word decoding, address parsing, auth-results parsing,
Received parsing, delay math, private-IP detection, end-to-end verdicts for a clean
and a phishing message, the copy-ready text summary, and HTML sanity
(single `<html>`, two script blocks, key element IDs, no AI attribution).

## Why this matters for support roles

"Can you read email headers?" comes up in IT support, service desk, and SOC analyst
interviews because it's how you triage phishing reports and delivery problems:
SPF tells you if the sending server was authorized, DKIM tells you the message wasn't
altered, DMARC ties them to the domain the user actually sees. Being able to walk an
interviewer through a suspicious `Received` chain and explain *why* a From/Return-Path
mismatch matters is exactly the kind of practical answer that stands out.
