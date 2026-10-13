# Day 19 — LoadLine: HAR File Analyzer

A single-file web app that turns a browser HAR file into something a support
analyst can actually use. A HAR (HTTP Archive) is a JSON recording of every
network request the browser made while loading a page — DevTools can export
one, and app support teams ask users for them daily because they show exactly
what failed, what was slow, and what to tell the user.

## What it does

- **Drop a `.har` file** (drag & drop or file picker) — parsed and analyzed
  entirely in the browser; nothing is uploaded anywhere
- **Summary cards** — request count, bytes transferred, wall-clock page time,
  failed count, slow count
- **Insights panel** — plain-language findings in support-desk tone, severity
  ordered (error → warn → info):
  - failed requests (status ≥ 400 or blocked/never completed)
  - mixed content (http:// resources on an https:// page)
  - slow requests (> 2 s) and huge downloads (> 1 MB)
  - duplicate identical requests (same method + URL)
  - static assets with no cache headers (no `Cache-Control`/`ETag`/`Last-Modified`)
  - large uncompressed text assets (> 50 KB, no gzip/brotli)
  - heavy redirect chains (3+ redirects before the final URL)
- **Waterfall tab** — pure-CSS timing bars per request, color-coded by type
- **Requests tab** — searchable table (method, status badge, URL, type, size,
  time); click a row for the detail view: request/response headers plus a
  per-phase timing breakdown (blocked / DNS / SSL / connect / send / wait / receive)
- **Copy text summary** — paste-ready findings for a ticket, including a
  "what to tell the user" line; **Download JSON report** and **Download CSV**
- Built-in **sample HAR** (16 requests) crafted so every insight fires — great
  for learning what each finding looks like

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

To get a real HAR file: open the page in Chrome/Edge/Firefox DevTools →
Network tab → reproduce the issue → right-click → "Save all as HAR".

## Example

1. Click **Load sample HAR** → a 16-request recording of a shop page is analyzed.
2. Summary: 16 requests, 2 failed, 1 slow, ~2.7 MB transferred.
3. Insights flags, among others:
   - `[ERROR]` 404 on `missing-image.png` and 500 on `/api/checkout`
   - `[ERROR]` mixed content: `http://cdn.example.com/banner.jpg` on the https page
   - `[WARN]` `/api/search` took 3.4 s; `hero.mp4` is a 2.3 MB download
   - `[WARN]` `app.js` and `logo.png` have no cache headers
   - `[INFO]` `/analytics` was requested twice; `app.js` (90 KB) is uncompressed;
     `old-promo → new-promo → deals → offers` is a 3-hop redirect chain
4. Open the **Waterfall** tab to see the 3.4 s `/api/search` bar dominate the
   timeline; open **Requests**, click that row, and the timing breakdown shows
   most of the time in "wait" (server-side) rather than download.
5. Click **Copy text summary** → paste the findings into a ticket.

## Files

| File | What it is |
|------|------------|
| `index.html` | The whole app: markup, CSS, and two `<script>` blocks (pure logic, then the UI layer) |
| `test.js` | Node unit tests: document sanity checks + 42 assertions against the logic layer (`node test.js`) |
| `README.md` | This file |

## How the code works

- The first `<script>` block is **browser-free pure logic** exposed as
  `globalThis.__llaLogic`: `parseHar` (tolerates real HAR files, bare
  `{log:{entries}}` wrappers, and raw entry arrays), `entrySummary`
  (normalizes HAR's `-1` "unknown" timings/sizes to 0), `buildWaterfall`
  (offsets relative to the first request), `summarize` (headline numbers +
  slowest/largest/type buckets), `findInsights` (the eight detectors, each a
  small pure function returning `{severity, title, detail}`), `formatBytes` /
  `formatMs`, `textSummary` (ticket-ready plain text), and `csvRows`.
  A hand-rolled `parseUrl` keeps the logic runnable in a Node `vm` sandbox.
- The second `<script>` block is the **UI layer** (guarded: it no-ops without
  `#dropZone` in the DOM). It builds the sample HAR, renders cards/insights/
  waterfall/table/detail, and wires up drag & drop, search, tabs, copy, and
  downloads.
- All user- and file-supplied text is rendered through `escapeHtml` — HAR files
  can contain anything, so this is non-negotiable.

## Why this helps in support/QA interviews

- Reading HAR files is a core app-support skill: "a user says the page is
  slow — what do you ask for and what do you look at?" This project is the
  answer, and you can demo it live.
- It exercises the exact vocabulary interviewers probe: status codes, request
  timing phases (DNS vs. connect vs. wait vs. receive), caching headers,
  compression, mixed content, redirect chains.
- The "what to tell the user" line practices the other half of the job:
  translating technical findings into a clear, empathetic user-facing message.
