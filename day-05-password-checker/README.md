# Day 05 — Password Strength Checker & Policy Auditor

A single-file web app that grades passwords against configurable corporate-style
password policies, estimates entropy and crack time, and generates compliant
random passwords. The kind of tool an IT help desk uses (or explains) when
enforcing password policy for users.

## What it does

- **Policy presets** — Basic / Standard / Strict, mirroring real help-desk
  enforcement tiers (minimum length, character classes, common-password
  blocklist, pattern checks). Every rule can also be toggled individually.
- **Live strength grading** — score 0–100, Weak → Excellent, with a per-rule
  pass/fail checklist and a concrete fix suggestion for each failed rule.
- **Entropy + crack-time estimates** — bits of entropy (`length × log₂(pool)`),
  plus estimated time to crack at 1 billion guesses/sec (CPU) and 1 trillion
  guesses/sec (GPU rig).
- **Secure password generator** — length slider, character-class toggles,
  ambiguous-character exclusion; uses `crypto.getRandomValues()` (never
  `Math.random()` for secrets), guarantees one char per selected class, and
  auto-grades the result against the active policy.
- **Privacy by design** — 100% client-side, zero network calls. A real password
  checker must never transmit what you type.

## How to run

No build, no dependencies. Just open `index.html` in a browser:

```
# or serve it locally:
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How it works (the interesting bits)

| Concept | Where in the code |
|---|---|
| Entropy = `length × log₂(pool size)` | `estimateEntropy()` |
| Crack time ≈ `2^(bits−1) / guesses-per-second` | `gradePassword()` |
| Blocklist + "common+1/123" variants | `banCommon` rule |
| Sequence (`abcd`), repeat (`aaa`), keyboard-walk (`qwer`) detection | `hasSimplePattern()` |
| Secure random generation + Fisher–Yates shuffle | `generatePassword()` |
| Logic kept pure (no DOM) so it can be unit-tested | everything above the UI section |

## Testing

The UI code is separated from the pure logic, so the logic is tested directly:

```
node test.js   # 19 assertions — all passing
```

The harness extracts the `<script>` block from `index.html` and exercises the
grading, entropy math, pattern detection, and generator in Node.

## Try it

Type `password123` (fails the blocklist), then `Qwerty12345!` (fails pattern
detection), then generate a 16-character password and watch it pass the Strict
policy. Toggle policy rules off one by one and see which ones actually carry
the security weight — that's the lesson that sticks in interviews.
