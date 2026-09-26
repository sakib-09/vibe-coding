# Day 03 — Mini Helpdesk (IT Support Ticket Tracker)

A single-file web app (`index.html` — no server, no build step, no
dependencies) that works like the ticketing systems real IT support and
application support teams use every day: **Jira, ServiceNow, Zendesk**.

Open a ticket when something breaks, set its priority and category, assign
it, track every status change and work note on an activity timeline, and
spot tickets that are breaching the 48-hour SLA (flagged red). Everything
persists in `localStorage`, and you can export the queue to **CSV** (attach
to an incident report / open in Excel) or **JSON** (backup, or hand to an
API).

Why this matters for jobs: helpdesk ticketing is the core workflow of IT
support, application support, and QA triage roles. Being able to say *"I
built a ticket tracker — I know the lifecycle Open → In Progress →
Resolved → Closed, what an SLA is, and why every change needs an audit
trail"* is a concrete interview talking point.

## Run it

Just open `index.html` in any browser — double-click it, or:

```bash
# Linux
xdg-open index.html
# macOS
open index.html
```

Click **Load sample data** to explore with 6 realistic tickets (including
one deliberately stale ticket to show the overdue/SLA highlighting).

## Features

- Create, view, update, and delete tickets
- Priority (`Critical` / `High` / `Medium` / `Low`), status, category,
  reporter, assignee
- Activity timeline: every status/priority change is logged automatically
  (audit trail); add work notes manually
- Dashboard counters: Open, In Progress, Critical & open, Resolved/Closed
- Search + filter by status, priority, category; queue auto-sorted by
  priority then age
- SLA highlighting: tickets untouched for > 48h get a red border (🔴)
- Export to CSV and JSON
- All data stored in `localStorage` — survives reloads, no backend needed

## Example data (from "Load sample data")

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| TICKET-001 | VPN drops every ~30 minutes on campus Wi-Fi | High | Open |
| TICKET-002 | New hire laptop: no admin rights | Medium | In Progress |
| TICKET-003 | Payroll portal shows 500 error on submit | Critical | Open |
| TICKET-004 | Printer jams on every duplex job | Low | Resolved |
| TICKET-005 | Stale ticket (72h old — shows red SLA breach) | High | Open |
| TICKET-006 | Phishing email reported | Critical | In Progress |

## What it teaches

- **localStorage + JSON**: persisting app state as a JSON string and
  parsing it back — the same object shape a REST API would return
- **Input escaping**: every user-supplied string is escaped before
  rendering, preventing stored XSS
- **Event delegation**: one click listener on the ticket list instead of
  one per card
- **State → render pattern**: the screen is always rebuilt from a single
  source of truth (`state.tickets`)
