# Day 11 — Service Uptime Monitor

A continuous uptime checker for HTTP(S) services. It polls a list of services on
a schedule, measures response latency, and classifies each service as
**UP / DEGRADED / DOWN**:

| State    | Meaning                                                        |
|----------|----------------------------------------------------------------|
| UP       | Returned an expected status code within the slow threshold     |
| DEGRADED | Returned an expected status code, but too slowly (early warning)|
| DOWN     | Request failed (timeout, DNS, connection, SSL) or bad status   |

Every state change is printed as a console alert and appended to an incident
log in **NDJSON** format (one JSON object per line — easy to grep or import
into a spreadsheet/SIEM). A live dashboard redraws in the terminal after every
round. Ctrl+C prints a final availability summary.

## Why this exists

IT support and app support teams own "is the site up?" questions. Real
monitoring stacks (Nagios, Zabbix, Datadog, PagerDuty) all do what this does
at its core: poll on a schedule, measure, classify, alert, log. Building a
small one teaches the concepts behind the enterprise tools and gives you
something concrete to talk about in interviews.

## Requirements

- Node.js 18+ (standard library only — no `npm install` needed)

## How to run

```bash
cd day-11-uptime-monitor

# Single check of every service, JSON to stdout (exit 1 if anything is DOWN — CI friendly)
node uptime-monitor.js --config services.example.json --once

# Watch mode: check every 10 seconds forever, live dashboard + incident log
node uptime-monitor.js --config services.example.json --interval 10

# Watch for 2 minutes, then print a summary and exit
node uptime-monitor.js --config services.example.json --interval 10 --duration 120 --timeout 5000
```

Full flags:

| Flag              | Default                 | Meaning                                  |
|-------------------|-------------------------|------------------------------------------|
| `--config <file>` | `services.example.json` | Service list JSON                        |
| `--log <file>`    | `incidents.ndjson`      | Where incident entries are appended      |
| `--interval <s>`  | `30`                    | Seconds between check rounds             |
| `--timeout <ms>`  | `8000`                  | Per-request timeout                      |
| `--duration <s>`  | none (runs forever)     | Stop after N seconds, print summary      |
| `--once`          | —                       | One round only, JSON output              |

## Config format

```json
{
  "slowThresholdMs": 1500,
  "services": [
    { "name": "Company website", "url": "https://example.com" },
    { "name": "API health", "url": "https://api.example.com/health", "expectStatus": [200] }
  ]
}
```

- `slowThresholdMs` — latency above this marks a service DEGRADED instead of UP.
- `expectStatus` — optional list of acceptable HTTP codes (default: any 2xx).

Copy `services.example.json` to `services.json` and edit it for your own targets.
(Don't commit real internal URLs to a public repo.)

## Example output

`--once` mode:

```json
{
  "timestamp": "2026-10-05T15:30:00.000Z",
  "results": [
    {
      "name": "Example homepage",
      "url": "https://example.com",
      "state": "UP",
      "statusCode": 200,
      "latencyMs": 87,
      "error": null
    }
  ]
}
```

Incident log (`incidents.ndjson`) — one line per state change:

```json
{"timestamp":"2026-10-05T15:32:10.123Z","service":"API health","from":"UP","to":"DOWN","statusCode":null,"latencyMs":8000,"error":"timeout"}
```

Watch-mode dashboard:

```
Service Uptime Monitor
Started: 10/5/2026, 9:30:00 AM   Round: 4
────────────────────────────────────────────────────────────────────────
Service                 State     Latency   Avail (100)   Last change detail
────────────────────────────────────────────────────────────────────────
Example homepage        UP        87 ms     100.0%        HTTP 200
GitHub status API       UP        210 ms    100.0%        HTTP 200
────────────────────────────────────────────────────────────────────────
Incidents logged to incidents.ndjson   Press Ctrl+C for summary.
```

## How it works (the short version)

1. **Scheduling** — `setInterval` fires a check round every N seconds; the
   first round runs immediately so you get data right away.
2. **Checking** — each service gets an HTTP(S) `GET` with a timeout.
   Redirects (3xx + `Location`) are followed up to 3 hops, like a browser.
   Latency is measured with `process.hrtime.bigint()`, a monotonic clock that
   can't be skewed by the system clock changing.
3. **Classification** — errors and unexpected status codes → DOWN; slow but
   working → DEGRADED; everything else → UP. Error types are mapped to short
   greppable codes (`timeout`, `dns-error`, `connection-refused`, `ssl-error`).
4. **State tracking** — each service keeps a rolling window of its last 100
   results (for the availability %) plus lifetime counters. A change from the
   previous state is an *incident*: it gets an alert line and an NDJSON log
   entry. The very first observation doesn't count (nothing changed *from*).
5. **Reporting** — Ctrl+C (or `--duration` expiry) prints per-service totals,
   availability %, incident count, and average latency.

## Interview talking points

- "I built a small uptime monitor in Node with no dependencies — polling,
  latency measurement, state machines, and NDJSON incident logging."
- "DEGRADED vs DOWN is the difference between a warning and a page: slow
  responses are often the first sign of trouble, so I made slowness a
  first-class state, not just pass/fail."
- "Availability is computed over a rolling window of the last 100 checks,
  so one blip ages out instead of haunting the number forever."
- "I used a monotonic clock for latency so NTP adjustments can't skew the
  measurements — a detail that matters in real monitoring."

## Ideas to extend it

- Send alerts somewhere real: a Slack/Discord webhook on state change.
- Add a TCP check mode for non-HTTP services (databases, SSH).
- Serve the dashboard over HTTP so the team can watch it in a browser.
- Track "mean time to recover" per incident (pair each DOWN with its next UP).
