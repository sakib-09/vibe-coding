#!/usr/bin/env node
/**
 * uptime-monitor.js — Service Uptime Monitor
 *
 * Continuously checks a list of HTTP(S) services, measures response latency,
 * and classifies each service as UP / DEGRADED / DOWN. State changes are
 * printed as alerts and appended to an incident log (NDJSON). A live
 * dashboard is redrawn in the terminal after every check round.
 *
 * Node.js standard library only — no npm packages needed.
 *
 * Usage:
 *   node uptime-monitor.js --config services.json        # run forever (default: 30s interval)
 *   node uptime-monitor.js --config services.json --interval 10 --duration 120
 *   node uptime-monitor.js --config services.json --once # single pass, JSON to stdout
 */

// ---------------------------------------------------------------
// Imports — everything here ships with Node.js itself.
// ---------------------------------------------------------------
const http = require('http');      // plain HTTP requests
const https = require('https');    // HTTPS requests
const fs = require('fs');          // config file + incident log
const path = require('path');

// ---------------------------------------------------------------
// CLI argument parsing (tiny hand-rolled parser, no deps).
// Supports: --config <file> --interval <sec> --timeout <ms>
//           --duration <sec> --once --log <file> --help
// ---------------------------------------------------------------
function parseArgs(argv) {
  const args = { config: 'services.example.json', interval: 30, timeout: 8000, duration: 0, once: false, log: 'incidents.ndjson' };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    switch (flag) {
      case '--config': args.config = next; i++; break;
      case '--log': args.log = next; i++; break;
      case '--interval': args.interval = Number(next); i++; break;
      case '--timeout': args.timeout = Number(next); i++; break;
      case '--duration': args.duration = Number(next); i++; break;
      case '--once': args.once = true; break;
      case '--help': args.help = true; break;
      default:
        console.error(`Unknown flag: ${flag}\nRun with --help for usage.`);
        process.exit(2);
    }
  }
  return args;
}

function usage() {
  console.log(`
Service Uptime Monitor — continuously check HTTP(S) services.

Usage:
  node uptime-monitor.js [options]

Options:
  --config <file>    Service list JSON (default: services.example.json)
  --log <file>       Incident log file, NDJSON (default: incidents.ndjson)
  --interval <sec>   Seconds between check rounds (default: 30)
  --timeout <ms>     Per-request timeout in ms (default: 8000)
  --duration <sec>   Stop after this many seconds and print a summary
  --once             One check round only; print JSON and exit (exit 1 if any DOWN)
  --help             Show this help

Config file format:
  {
    "slowThresholdMs": 1500,
    "services": [
      { "name": "Company website", "url": "https://example.com" },
      { "name": "API health", "url": "https://api.example.com/health", "expectStatus": [200] }
    ]
  }
`);
}

// ---------------------------------------------------------------
// Load and validate the config file.
// ---------------------------------------------------------------
function loadConfig(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`Cannot read config file: ${filePath}\n${err.message}`);
    process.exit(2);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch (err) {
    console.error(`Config file is not valid JSON: ${filePath}\n${err.message}`);
    process.exit(2);
  }
  if (!Array.isArray(config.services) || config.services.length === 0) {
    console.error('Config must contain a non-empty "services" array.');
    process.exit(2);
  }
  for (const s of config.services) {
    if (!s.name || !s.url) {
      console.error('Each service needs a "name" and a "url".');
      process.exit(2);
    }
    // expectStatus is optional; default = any 2xx.
    s.expectStatus = s.expectStatus || [200, 201, 202, 203, 204, 205, 206];
  }
  config.slowThresholdMs = config.slowThresholdMs || 1500;
  return config;
}

// ---------------------------------------------------------------
// Check one service once.
// Returns a promise resolving to:
//   { statusCode, latencyMs, error }  — error set when the request failed
//
// Latency is measured with a monotonic clock so system time changes
// can't skew the numbers. Redirects (3xx + Location) are followed up
// to 3 hops, matching what a browser would do.
// ---------------------------------------------------------------
function checkService(service, timeoutMs, maxRedirects = 3) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint(); // nanoseconds, monotonic

    function elapsedMs() {
      return Number(process.hrtime.bigint() - start) / 1e6;
    }

    function done(result) {
      resolve({ ...result, latencyMs: Math.round(elapsedMs()) });
    }

    function request(url, redirectsLeft) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        return done({ statusCode: null, error: 'invalid-url' });
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return done({ statusCode: null, error: 'unsupported-protocol' });
      }

      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { 'User-Agent': 'uptime-monitor/1.0' },
        },
        (res) => {
          // Drain the body so 'end' fires; we don't need the content.
          res.resume();
          res.on('end', () => {
            const location = res.headers.location;
            if (location && res.statusCode >= 300 && res.statusCode < 400 && redirectsLeft > 0) {
              request(new URL(location, url).toString(), redirectsLeft - 1);
              return;
            }
            done({ statusCode: res.statusCode, error: null });
          });
        }
      );

      // Map every failure mode to a short, greppable error code.
      req.on('timeout', () => { req.destroy(); done({ statusCode: null, error: 'timeout' }); });
      req.on('error', (err) => {
        const code = err.code || 'unknown';
        const mapped =
          code === 'ENOTFOUND' ? 'dns-error'
          : code === 'ECONNREFUSED' ? 'connection-refused'
          : code.startsWith('CERT_') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ? 'ssl-error'
          : `error:${code}`;
        done({ statusCode: null, error: mapped });
      });

      req.setTimeout(timeoutMs);
      req.end();
    }

    request(service.url, maxRedirects);
  });
}

// ---------------------------------------------------------------
// Classify a single check result.
//   UP       — expected status code, latency under the slow threshold
//   DEGRADED — expected status code, but too slow (a warning sign)
//   DOWN     — request failed or unexpected status code
// ---------------------------------------------------------------
function classify(service, result, slowThresholdMs) {
  if (result.error || !service.expectStatus.includes(result.statusCode)) return 'DOWN';
  if (result.latencyMs > slowThresholdMs) return 'DEGRADED';
  return 'UP';
}

// ---------------------------------------------------------------
// Per-service rolling state: last N results, current classification,
// and counters used for the summary report.
// ---------------------------------------------------------------
const HISTORY_SIZE = 100;

function newServiceState(service) {
  return {
    service,
    results: [],        // rolling window of { state, latencyMs }
    current: 'UNKNOWN', // current classification
    lastCheck: null,    // most recent raw result
    counters: { up: 0, degraded: 0, down: 0, incidents: 0 },
    latencies: [],      // latencies of UP/DEGRADED checks (for avg/min/max)
  };
}

function recordResult(state, result, newClassification) {
  const prev = state.current;
  state.current = newClassification;
  state.lastCheck = result;
  state.results.push({ state: newClassification, latencyMs: result.latencyMs });
  if (state.results.length > HISTORY_SIZE) state.results.shift();

  if (newClassification === 'UP') state.counters.up++;
  else if (newClassification === 'DEGRADED') state.counters.degraded++;
  else state.counters.down++;

  if (result.error === null) state.latencies.push(result.latencyMs);

  // A state change is an incident worth alerting + logging.
  const changed = prev !== 'UNKNOWN' && prev !== newClassification;
  if (changed) state.counters.incidents++;
  return { prev, changed };
}

// ---------------------------------------------------------------
// Incident log: one JSON object per line (NDJSON).
// Easy to grep, and easy to import into a spreadsheet or SIEM.
// ---------------------------------------------------------------
function logIncident(logPath, serviceName, prev, next, result) {
  const entry = {
    timestamp: new Date().toISOString(),
    service: serviceName,
    from: prev,
    to: next,
    statusCode: result.statusCode,
    latencyMs: result.latencyMs,
    error: result.error,
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

// ---------------------------------------------------------------
// Terminal output helpers.
// ---------------------------------------------------------------
const COLORS = {
  UP: '\x1b[32m',       // green
  DEGRADED: '\x1b[33m', // yellow
  DOWN: '\x1b[31m',     // red
  UNKNOWN: '\x1b[90m',  // grey
};
const RESET = '\x1b[0m';

function colorize(state, text) {
  if (!process.stdout.isTTY) return text; // plain text when piped
  return `${COLORS[state] || ''}${text}${RESET}`;
}

function availabilityPct(state) {
  if (state.results.length === 0) return '—';
  const ok = state.results.filter((r) => r.state !== 'DOWN').length;
  return ((ok / state.results.length) * 100).toFixed(1) + '%';
}

function avgLatency(state) {
  if (state.latencies.length === 0) return '—';
  const avg = state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length;
  return Math.round(avg) + ' ms';
}

function renderDashboard(states, startedAt, round) {
  // Clear the screen and redraw: keeps one live view instead of scrolling.
  process.stdout.write('\x1b[2J\x1b[0;0H');
  const lines = [];
  lines.push('Service Uptime Monitor');
  lines.push(`Started: ${startedAt.toLocaleString()}   Round: ${round}`);
  lines.push('─'.repeat(72));
  lines.push(
    pad('Service', 24) + pad('State', 10) + pad('Latency', 10) +
    pad('Avail (' + HISTORY_SIZE + ')', 14) + 'Last change detail'
  );
  lines.push('─'.repeat(72));
  for (const st of states) {
    const r = st.lastCheck;
    const detail = r
      ? (r.error ? `error: ${r.error}` : `HTTP ${r.statusCode}`)
      : 'waiting for first check…';
    lines.push(
      pad(st.service.name.slice(0, 23), 24) +
      pad(colorize(st.current, st.current), 10 + colorize(st.current, '').length) +
      pad(r ? r.latencyMs + ' ms' : '—', 10) +
      pad(availabilityPct(st), 14) +
      detail
    );
  }
  lines.push('─'.repeat(72));
  lines.push(`Incidents logged to ${args.log}   Press Ctrl+C for summary.`);
  process.stdout.write(lines.join('\n') + '\n');
}

function pad(str, width) {
  str = String(str);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

// ---------------------------------------------------------------
// Final summary printed on exit (Ctrl+C or --duration expiry).
// ---------------------------------------------------------------
function printSummary(states, startedAt) {
  const mins = ((Date.now() - startedAt.getTime()) / 60000).toFixed(1);
  console.log('\n' + '═'.repeat(72));
  console.log(`Summary — ran for ${mins} minutes`);
  console.log('═'.repeat(72));
  for (const st of states) {
    const c = st.counters;
    const total = c.up + c.degraded + c.down;
    const avail = total === 0 ? '—' : ((((c.up + c.degraded) / total) * 100).toFixed(1) + '%');
    console.log(
      `${st.service.name}\n` +
      `  checks: ${total}   availability: ${avail}   ` +
      `up: ${c.up}   degraded: ${c.degraded}   down: ${c.down}   ` +
      `incidents: ${c.incidents}   avg latency: ${avgLatency(st)}`
    );
  }
}

// ---------------------------------------------------------------
// Main.
// ---------------------------------------------------------------
const args = parseArgs(process.argv);
if (args.help) { usage(); process.exit(0); }

const config = loadConfig(args.config);
const states = config.services.map(newServiceState);
const startedAt = new Date();
let round = 0;
let shuttingDown = false;

// --once: single round, JSON to stdout, exit 1 if anything is DOWN.
async function runOnce() {
  const results = [];
  for (const st of states) {
    const result = await checkService(st.service, args.timeout);
    const classification = classify(st.service, result, config.slowThresholdMs);
    results.push({
      name: st.service.name,
      url: st.service.url,
      state: classification,
      statusCode: result.statusCode,
      latencyMs: result.latencyMs,
      error: result.error,
    });
  }
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  process.exit(results.some((r) => r.state === 'DOWN') ? 1 : 0);
}

// One full round: check every service, log state changes, redraw dashboard.
// Alerts are printed AFTER the dashboard redraw — the redraw clears the
// screen, so printing them before would wipe them instantly.
async function runRound() {
  round++;
  const alerts = [];
  for (const st of states) {
    const result = await checkService(st.service, args.timeout);
    const classification = classify(st.service, result, config.slowThresholdMs);
    const { prev, changed } = recordResult(st, result, classification);
    if (changed) {
      logIncident(args.log, st.service.name, prev, classification, result);
      const detail = result.error ? `error: ${result.error}` : `HTTP ${result.statusCode}, ${result.latencyMs} ms`;
      alerts.push({
        classification,
        text: `[ALERT] ${new Date().toLocaleTimeString()} ${st.service.name}: ${prev} → ${classification} (${detail})`,
      });
    }
  }
  if (!args.once) {
    renderDashboard(states, startedAt, round);
    for (const alert of alerts) console.log(colorize(alert.classification, alert.text));
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  printSummary(states, startedAt);
  process.exit(0);
}
process.on('SIGINT', shutdown);

(async () => {
  if (args.once) return runOnce();

  const intervalMs = args.interval * 1000;
  if (!(intervalMs > 0)) { console.error('--interval must be positive.'); process.exit(2); }

  await runRound(); // first round immediately — no waiting for good news

  const timer = setInterval(runRound, intervalMs);

  if (args.duration > 0) {
    setTimeout(() => { clearInterval(timer); shutdown(); }, args.duration * 1000);
  }
})();
