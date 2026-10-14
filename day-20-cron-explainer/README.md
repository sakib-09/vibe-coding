# Day 20 — CronLens: Cron Expression Explainer & Next-Run Calculator

Paste a cron expression and get a plain-English explanation, the next run
times, and warnings about the classic cron gotchas — before a mis-scheduled
job pages you at 3am.

## What it does

- **Parses** 5-field cron (`minute hour day-of-month month day-of-week`),
  6-field with seconds, and `@yearly … @hourly`, `@reboot` shortcuts.
- **Explains** the schedule in plain English, e.g.
  `0 9 * * MON-FRI` → *"At 09:00 on Monday-Friday."*
- **Lists the next N run times** (5, 10 or 20) from any start date/time,
  with relative labels ("in 2h 15m"), plus an estimate of runs in the next 7 days.
- **Field-by-field breakdown table** showing what each field matches.
- **Gotcha warnings**: the day-of-month/day-of-week OR trap, every-minute
  accidents, 6-field portability (Quartz vs classic Vixie cron), Feb 29, day 31.
- **Friendly validation errors** — no silent failures, no regex dumps.
- One-click **copy** of a ticket-ready summary.

Single file, zero dependencies. Open `index.html` in a browser.

## How to run

Just open `index.html` — no server, no build step. Times use your browser's
local timezone.

```bash
# run the test suite (Node.js)
node test.js
```

67 assertions cover parsing, validation errors, Vixie day OR-semantics,
next-run calculation (including Feb 29 in leap years), descriptions and tips.

## Example

Input: `0 0 1 * 0`

> **At 00:00 on the 1st of the month or on Sunday (either one triggers it).**
>
> Heads up: Day-of-month AND day-of-week are OR-ed in cron: this runs when
> EITHER matches, not when both do. This is the most common cron surprise.

Next runs from Wed Oct 14, 2026 12:00:
- Sun, Oct 18, 2026 at 00:00 (in 3d 12h)
- Sun, Oct 25, 2026 at 00:00 (in 10d 12h)
- Sun, Nov 1, 2026 at 00:00 (in 17d 12h)

## Cron semantics used

Follows classic Vixie cron: when **both** day-of-month and day-of-week are
restricted, the job runs when **either** matches. Day-of-week `0` and `7`
both mean Sunday (normalised to 0). `5/20` means 5, 25, 45 (steps from the
given value up to the field maximum).

## Why this matters for support work

Scheduled jobs run backups, patches, report exports and monitoring checks.
Support staff constantly decode cron expressions in tickets and figure out
"when does this run, and why didn't it fire?" — this tool answers both in
seconds.
