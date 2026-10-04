# Day 10 — Data Wrangler: CSV ⇄ JSON Converter & Table Viewer

A single-file web app that converts CSV to JSON and JSON to CSV, with auto-format
detection, a sortable/searchable table preview, and download buttons.

**100% client-side.** Paste data or drop a file — nothing ever leaves your browser.

## What it does

- **Auto-detects input**: figures out whether you pasted CSV or JSON (and catches
  NDJSON — one JSON object per line, common in logs)
- **CSV → JSON**: proper RFC-4180 parsing (quoted fields, escaped `""` quotes,
  newlines inside cells), delimiter auto-detection (comma, semicolon, tab, pipe),
  header-row detection, ragged rows padded
- **JSON → CSV**: uses the union of all object keys as columns, JSON-stringifies
  nested objects/arrays into their cells
- **Table preview**: click any column header to sort (numeric-aware), live
  search filter, empty cells marked, row/column/empty-cell stats
- **Copy & download**: copy the output, or download it as `.json` / `.csv`

## Why this matters for support jobs

Support work is full of format juggling: vendor exports arrive as CSV, APIs and
webhooks speak JSON, and someone always asks you to "just reformat this for the
spreadsheet." Knowing how these formats break — stray commas, bad quotes,
mismatched keys — is day-to-day application-support literacy.

## How to run

Open `index.html` in any browser. No build step, no dependencies.

Or serve it locally:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Try it

Click **Load sample** and hit **Convert →**. Then:

1. Switch to the **JSON** tab — see the converted output
2. Go back to **Table**, click the `priority` header to sort, type `high` in the filter
3. Paste your own data — try a semicolon-delimited export, or NDJSON from a log file

## Tests

The conversion logic is kept pure (no DOM) in the `<script id="logic">` block so it
can be tested headlessly:

```bash
node test.js   # 23 assertions covering parsing, detection, and round-trips
```

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole app — markup, styles, pure logic block, UI wiring |
| `test.js` | Headless test harness (extracts and evaluates the logic block) |
| `README.md` | This file |
