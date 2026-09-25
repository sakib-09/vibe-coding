# Day 02 — Log Analyzer

A single-file web app that turns a raw Apache/Nginx access log into an
instant support dashboard. Paste log lines (or upload a `.log` file) and get:
status-code breakdown with a bar chart, top requested URLs, top visitor IPs,
the slowest requests, and a searchable table of every error — with one-click
CSV export for attaching to incident tickets.

Reading logs is the bread and butter of application support and QA triage.
This tool practices exactly that: spotting 5xx spikes, repeated 404s,
suspicious scanning patterns, and slow endpoints.

## Run it

No server or build step needed — just open the file in a browser:

```bash
# macOS
open index.html
# Linux
xdg-open index.html
# Windows — double-click index.html
```

Click **Load sample log** to try it instantly with the included `sample.log`
(51 realistic requests), or paste/upload your own log.

## Expected input format

Apache/Nginx *combined* log format, one request per line. An optional
response time in seconds at the end of each line enables the "slowest
requests" table (Nginx `$request_time` style):

```
192.168.1.10 - frank [25/Sep/2026:09:02:11 +0600] "GET /index.html HTTP/1.1" 200 5123 "-" "Mozilla/5.0" 0.042
```

Lines that don't match are skipped (counted, not fatal), so mixed or partial
logs won't break the analysis.

## Example output (sample.log)

- **Total requests:** 51 · **Unique visitors:** 27 · **Errors:** 19 (37.3%)
- **Status classes:** 2xx: 30, 3xx: 2, 4xx: 14, 5xx: 5
- **Slowest request:** `GET /api/reports/monthly` — 8.412s (returned 503)
- **Top IP:** `192.168.1.12` — 8 requests
- **Top request:** `POST /api/login` — 6 hits
- Notable findings: repeated `401`s on `/api/login` from one IP (possible
  brute-force), `500`s on `/api/checkout`, scanner probes for `/.env`,
  `/wp-login.php`, and `/phpmyadmin/`

## How it works

- `parseLog()` — a regular expression pulls apart each log line into an
  object (`ip`, `time`, `method`, `path`, `status`, `bytes`, `agent`,
  `duration`). Malformed lines are counted and skipped.
- `analyze()` — aggregates everything the dashboard needs: status-class
  counts, top-N URLs/IPs via a `Map`, the 10 slowest requests, and the full
  error list (status ≥ 400).
- Rendering is plain DOM updates; the bar chart is drawn on `<canvas>` with
  no libraries. `esc()` sanitizes log content before inserting it into HTML.
- The CSV export builds a properly quoted CSV string and triggers a download
  via a `Blob` URL — handy for attaching evidence to a support ticket.

## Files

| File | Description |
|------|-------------|
| `index.html` | The whole app: HTML, CSS, and JavaScript in one file |
| `sample.log` | 51-line sample access log for demo/testing |
| `README.md` | This file |
