# 🐞 Bug Report Builder

A single-file web app that turns a vague "it doesn't work" into a bug report a
developer can actually fix. Fill in the guided form — title, environment,
numbered reproduction steps, expected vs. actual, severity, evidence — and get
a live quality score plus copy-ready Markdown you can paste straight into
GitHub Issues, Jira, or any ticket system.

100% client-side: no build step, no dependencies, works offline, and your
draft never leaves the browser (auto-saved to `localStorage`).

## What it does

- **Guided bug form** — title, OS / browser / app version / network,
  dynamic steps-to-reproduce list (add, remove, reorder), expected vs. actual,
  workaround.
- **Severity triage cards** — Blocker / Critical / Major / Minor / Trivial,
  each with a plain-English definition so you pick the right one.
- **Live report-quality check** — flags errors (missing title, no repro
  steps, expected == actual, no severity) and warnings (vague title, too few
  steps, incomplete environment, no evidence) as you type.
- **Markdown generator** — live preview, one-click copy, download as
  `bug-<slug>.md`.
- **Two built-in examples** — a discount-code cart bug and a mobile layout bug,
  so you can see what a good report looks like and both pass every check.

## How to run

Open `index.html` in any browser. That's it.

```bash
# or serve it locally
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the test suite (Node.js, no dependencies):

```bash
node test.js
```

## Example output

Feeding in the built-in discount-code example produces:

```markdown
# Bug: Cart total shows $0.00 after applying a discount code

**Severity:** Major
**Environment:** Windows 11 · Chrome 131 · ShopApp v2.4.1 · Office Wi-Fi
**Reported:** QA Tester — 2026-10-09

## Steps to reproduce
1. Add any item to the cart.
2. Go to checkout and enter the discount code SAVE10.
3. Click "Apply".

## Expected result

The cart total updates to the discounted price (e.g. $90.00 for a $100 item).

## Actual result

The cart total changes to $0.00 and the order can be placed for free.

## Evidence
- [x] Reproduced more than once
- [x] Screenshot / screen recording attached
- [ ] Console or network logs captured
- [ ] Seen by other users / testers too

## Workaround

Remove the discount code, complete the purchase without it, then email support for a manual refund.
```

## How it works

- The page's JavaScript is split into two blocks: **pure logic** (no DOM —
  `buildMarkdown`, `runChecks`, `filenameFor`, `escapeMd`, severity data,
  examples) and **UI wiring** (form binding, live preview, buttons).
- `runChecks(report)` returns a list of `{level, message}` findings —
  `error` means "not ready to file", `warn` means "could be better",
  `ok` means "this part is solid". The same function powers both the on-page
  checklist and the Node test suite.
- Because the logic is DOM-free, `test.js` extracts the first `<script>`
  block from `index.html`, runs it in a Node `vm` sandbox with stubbed
  browser globals, and asserts 29 checks — including that the two shipped
  examples pass every quality rule themselves.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The whole app — markup, styles, logic, UI wiring |
| `test.js` | Node unit tests for the report logic (29 assertions) |
