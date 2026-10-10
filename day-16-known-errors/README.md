# Day 16 — Known Error Database (KEDB)

A single-file web app that implements the ITIL idea of a **known error**: a
problem whose root cause is understood and for which a documented **workaround**
exists. Support desks use known-error databases so the next agent who sees the
same symptom doesn't troubleshoot from scratch.

## What it does

- Browse, search, and filter known-error records (by category, severity P1–P4, fix status)
- Full-text search across titles, symptoms, error messages, workaround steps, tags, and ticket IDs — search `809` or `credential manager` and land on the right record
- Record detail view with symptoms, root cause, numbered workaround steps, permanent-fix notes, and linked ticket IDs
- One-click **Copy workaround** — paste the steps straight into a ticket reply or chat
- Add / edit / delete records with form validation (title, symptoms, and at least one workaround step are required)
- JSON export / import for backup and sharing; data persists in `localStorage`
- Sort by recently updated, severity (P1 first), or most reported; status dashboard counts
- Ships with 6 realistic sample records (VPN error 809, Outlook "Trying to connect", printer spooler crash, MFA push failure, mapped-drive credential loop, Teams screen-share crash)

## How to run

No build, no dependencies, no network calls. Open `index.html` in any modern browser:

```bash
# macOS / Linux
open index.html        # or: xdg-open index.html
```

Or serve it locally and visit the URL:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Example

1. Type `809` in the search box → the VPN error 809 record appears.
2. Click **View details** → read the symptoms, root cause, and 3-step workaround.
3. Click **Copy workaround** → paste the steps into a ticket as the resolution.
4. Add your own: **+ New record** → fill in symptoms + workaround steps → **Save record**.

## Files

| File | What it is |
|------|------------|
| `index.html` | The whole app: markup, CSS, and two `<script>` blocks (pure logic, then the UI layer) |
| `test.js` | Node unit tests: document sanity checks + ~30 assertions against the logic layer (`node test.js`) |
| `README.md` | This file |

## How the code works

- The first `<script>` block is **browser-free pure logic**: seed data, `validateRecord`, `searchRecords` (one lowercased haystack per record), `filterRecords`, `sortRecords`, `stats`, `exportJSON`/`importJSON`, and `escapeHtml`. It exposes everything on `globalThis.__kedbLogic` so the UI script — and the Node test harness — can use it.
- The second `<script>` block is the **UI layer** (guarded: it no-ops without `#recordList` in the DOM). It keeps state in `localStorage`, re-renders the card grid on every search/filter/sort change, and uses event delegation for the card buttons.
- All user-supplied text is rendered through `escapeHtml` to prevent stored XSS from record fields — a habit worth carrying into any support tooling.

## Tests

```bash
node test.js   # expect: all assertions pass
```

Tests extract the logic block from `index.html`, run it in a Node `vm` sandbox, and
assert search/filter/sort/validation/export/import behaviour plus HTML sanity
(single `<html>`, two script blocks, key element IDs, no AI attribution).

## Why this matters for support roles

Known-error management is core **ITIL problem management**: incidents are the
interruptions users report; problems are their underlying causes; known errors
are problems with documented workarounds. Being able to talk about that
vocabulary — and to have built a small KEDB yourself — is a strong signal in IT
support, service desk, and application support interviews.
