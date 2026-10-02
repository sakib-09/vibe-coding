# Day 09 — JSON Log Viewer

A single-file web app (no dependencies, no build step) that turns minified,
hard-to-read JSON into a filterable log view. Paste one JSON object, an array,
or newline-delimited JSON (NDJSON — one object per line, the format most
application servers write), and get:

- **Readable log rows** — timestamp, colour-coded level badge, and message per line
- **Expandable details** — click any row to see the full entry as a collapsible,
  syntax-highlighted JSON tree
- **Level detection** that handles real-world messiness: `"level"`, `"severity"`,
  `"loglevel"` fields; string values (`"warn"`, `"ERROR"`); pino/Bunyan numbers
  (`10/20/30/40/50/60`); and syslog numbers (`0–7`)
- **Timestamp normalisation** — ISO strings, epoch seconds, milliseconds, and
  microseconds are all recognised and shown as local time
- **Level filters + live search** — narrow to `ERROR`/`WARN`/… or type to filter rows
- **Stats bar** — entry count, error/warning counts, corrupt-line count
- **Corrupt-line flagging** — lines that aren't valid JSON are called out, not silently dropped
- **Copy / Download** — export the pretty-printed result
- **Single-object mode** — pasting one JSON object renders it as a full collapsible tree

Everything runs in the browser; pasted logs never leave your machine.

## How to run

Just open `index.html` in any modern browser. (Or serve it locally: `python3 -m http.server`
in this folder, then visit `http://localhost:8000`.)

Run the unit tests (pure logic extracted from the page, no browser needed):

```bash
node test.js
```

`test.js` has 82 assertions covering input classification, level detection,
timestamp handling, parsing, filtering, HTML rendering, and export.

## Example

Paste the sample logs (button in the app) and press **Format**:

```
entries: 7    errors: 2    warnings: 1    bad lines: 1    showing: 7

 1  [INFO]    2026-10-02 08:15:03   login attempt
 2  [WARN]    2026-10-02 08:15:04   slow database query
 3  [ERROR]   2026-10-02 08:15:05   charge failed            <- click to expand
 4  [WARN]    2026-10-02 08:15:06   cache miss               (pino level 40 + epoch seconds)
 5  [INFO]    2026-10-02 08:15:07   login succeeded
 6  [UNKNOWN] —                         not valid JSON: this line is not json…
 7  [DEBUG]   2026-10-02 08:15:09   job finished
```

Clicking row 3 expands the full entry:

```json
{
  "timestamp": "2026-10-02T08:15:05.884Z",
  "level": "error",
  "service": "payments",
  "msg": "charge failed",
  "order_id": 88412,
  "error": {
    "code": "card_declined",
    "retryable": false
  }
}
```

## Why this matters for support work

Application-support engineers and QA testers read JSON logs constantly —
API responses, server logs, error payloads. The skill isn't just "knowing JSON";
it's quickly finding the one failing request in thousands of lines. This tool
practices exactly that: normalising inconsistent fields, spotting corrupt data,
and filtering noise — the same triage workflow used with real log aggregators
like Splunk, Datadog, or the ELK stack, minus the enterprise price tag.

## Files

| File | What it is |
|------|------------|
| `index.html` | The whole app: CSS + pure logic + DOM wiring in one file |
| `test.js` | 82 unit tests for the pure logic (`node test.js`) |
| `README.md` | This file |
