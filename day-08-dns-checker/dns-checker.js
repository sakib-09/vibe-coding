#!/usr/bin/env node
/*
 * Day 08 — DNS Health Checker
 * ----------------------------
 * A small CLI that audits the DNS configuration of one or more domains and
 * reports the problems an IT support / network admin would actually care about:
 *   - does the domain resolve to an IP? (A / AAAA records)
 *   - can it receive email? (MX records that resolve)
 *   - is email spoofing guarded? (SPF in TXT, DMARC at _dmarc.<domain>)
 *   - are the nameservers healthy? (at least 2, and each one resolves)
 *   - does the main IP have reverse DNS? (PTR record — mail servers need this)
 *   - is wildcard DNS enabled? (a random subdomain resolving is often a surprise)
 *
 * Only Node.js built-ins are used: dns/promises, net, fs, path.
 *
 * Usage:
 *   node dns-checker.js example.com github.com
 *   node dns-checker.js --file domains.txt
 *   node dns-checker.js example.com --json report.json
 *   node dns-checker.js example.com --csv report.csv
 *   node dns-checker.js --help
 *
 * Exit code: 0 = no failed checks, 1 = at least one failed check (CI-friendly).
 */

'use strict';

const dns = require('node:dns/promises');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

// --- configuration ---------------------------------------------------------
const QUERY_TIMEOUT_MS = 8000;   // give up on a single DNS query after 8s
const MAX_CONCURRENT_DOMAINS = 4; // how many domains to audit at once

// --- pure helpers (no network; unit-tested in test.js) ---------------------

/**
 * True when the string looks like a plausible domain name.
 * (A sanity check, not a full RFC validation.)
 */
function isValidDomain(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(name);
}

/** Record statuses used by every check. */
const STATUS = { PASS: 'PASS', WARN: 'WARN', FAIL: 'FAIL', INFO: 'INFO' };

/**
 * Make a check result object. Keeping one shape for every check makes the
 * console, JSON and CSV outputs trivial to generate from the same data.
 */
function makeCheck(name, status, detail) {
  return { name, status, detail: detail || '' };
}

/**
 * Score a finished domain audit: number of FAILs and the overall verdict.
 * Verdict order: a single FAIL beats any number of WARNs.
 */
function scoreAudit(checks) {
  const fail = checks.filter((c) => c.status === STATUS.FAIL).length;
  const warn = checks.filter((c) => c.status === STATUS.WARN).length;
  const verdict = fail > 0 ? 'FAIL' : warn > 0 ? 'WARN' : 'PASS';
  return { fail, warn, verdict };
}

/**
 * Look for an SPF record ("v=spf1 ...") inside the TXT records of a domain.
 * Returns the SPF string, or null when there is none.
 */
function findSpfRecord(txtRecords) {
  for (const entry of txtRecords || []) {
    const text = Array.isArray(entry) ? entry.join('') : String(entry);
    if (/^v=spf1\b/i.test(text.trim())) return text.trim();
  }
  return null;
}

/**
 * True when any TXT record at _dmarc.<domain> is a real DMARC record.
 * dns.resolveTxt returns one array of strings per TXT record, hence the join.
 */
function hasDmarcRecord(txtRecords) {
  for (const entry of txtRecords || []) {
    const text = Array.isArray(entry) ? entry.join('') : String(entry);
    if (/^v=DMARC1\b/i.test(text.trim())) return true;
  }
  return false;
}

/**
 * Build one CSV row for a check result. Fields are quoted so commas in
 * details don't break the file.
 */
function checkToCsvRow(domain, check) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  return [domain, check.name, check.status, check.detail].map(q).join(',');
}

/**
 * Normalize CLI args: split out flags (--json, --csv, --file, --help) from
 * the plain domain names. Used by both main() and the tests.
 */
function parseArgs(argv) {
  const opts = { domains: [], file: null, jsonOut: null, csvOut: null, help: false };
  const args = argv.slice();
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--json') opts.jsonOut = args.shift() || null;
    else if (a === '--csv') opts.csvOut = args.shift() || null;
    else if (a === '--file' || a === '-f') opts.file = args.shift() || null;
    else if (a.startsWith('--')) throw new Error(`Unknown option: ${a}`);
    else opts.domains.push(a);
  }
  return opts;
}

// --- network helpers --------------------------------------------------------

/**
 * Run a promise with a timeout. DNS libraries don't always time out on their
 * own, so this keeps the tool from hanging on a dead nameserver.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref(); // don't keep the process alive just for the timer
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Query one DNS record type and return { records } on success or { error }.
 * NXDOMAIN / NODATA / SERVFAIL are common answers, not crashes — we record
 * them so the report can explain what happened.
 */
async function query(type, name) {
  const fn = {
    A: dns.resolve4, AAAA: dns.resolve6, MX: dns.resolveMx,
    NS: dns.resolveNs, TXT: dns.resolveTxt, SOA: dns.resolveSoa,
    CNAME: dns.resolveCname,
  }[type];
  try {
    const records = await withTimeout(fn(name), QUERY_TIMEOUT_MS, `${type} ${name}`);
    return { records };
  } catch (err) {
    return { error: err.code || err.message };
  }
}

// --- the audit ---------------------------------------------------------------

/**
 * Run every check against one domain and return the list of check results.
 * Each check is independent, so most queries run in parallel with Promise.all.
 */
async function auditDomain(domain) {
  const checks = [];

  // 1-2. Does the domain resolve? (website reachability starts here)
  const [a, aaaa] = await Promise.all([query('A', domain), query('AAAA', domain)]);
  if (a.records && a.records.length) {
    checks.push(makeCheck('A record', STATUS.PASS, `resolves to ${a.records.join(', ')}`));
  } else {
    checks.push(makeCheck('A record', STATUS.FAIL, `no IPv4 address (${a.error || 'no data'})`));
  }
  if (aaaa.records && aaaa.records.length) {
    checks.push(makeCheck('AAAA record', STATUS.PASS, `IPv6: ${aaaa.records.join(', ')}`));
  } else {
    checks.push(makeCheck('AAAA record', STATUS.INFO, 'no IPv6 address (optional)'));
  }

  // 3-4. Email: MX records present, and each mail server actually resolves.
  const mx = await query('MX', domain);
  let mailHosts = [];
  if (mx.records && mx.records.length) {
    mailHosts = mx.records.slice().sort((x, y) => x.priority - y.priority);
    const desc = mailHosts.map((m) => `${m.priority} ${m.exchange}`).join(', ');
    checks.push(makeCheck('MX records', STATUS.PASS, desc));
  } else {
    checks.push(makeCheck('MX records', STATUS.WARN, `no mail servers (${mx.error || 'no data'}) — domain cannot receive email`));
  }
  const mailLookups = await Promise.all(
    mailHosts.map(async (m) => {
      const r = await query('A', m.exchange);
      return { host: m.exchange, ok: !!(r.records && r.records.length), ip: (r.records || [])[0] || r.error };
    })
  );
  for (const m of mailLookups) {
    checks.push(makeCheck(
      `MX host ${m.host}`,
      m.ok ? STATUS.PASS : STATUS.FAIL,
      m.ok ? `resolves to ${m.ip}` : `does NOT resolve (${m.ip}) — mail will bounce`
    ));
  }

  // 5-6. Email authentication: SPF and DMARC records.
  const txt = await query('TXT', domain);
  const spf = txt.records ? findSpfRecord(txt.records) : null;
  checks.push(makeCheck(
    'SPF record',
    spf ? STATUS.PASS : STATUS.WARN,
    spf ? spf : 'no SPF record — anyone can spoof this domain in email'
  ));
  const dmarc = await query('TXT', `_dmarc.${domain}`);
  const hasDmarc = dmarc.records ? hasDmarcRecord(dmarc.records) : false;
  checks.push(makeCheck(
    'DMARC record',
    hasDmarc ? STATUS.PASS : STATUS.INFO,
    hasDmarc ? 'DMARC policy published' : 'no DMARC record at _dmarc.<domain> (recommended for email domains)'
  ));

  // 7-8. Nameservers: at least two, and each one must resolve.
  const ns = await query('NS', domain);
  const nameservers = ns.records || [];
  if (nameservers.length >= 2) {
    checks.push(makeCheck('Nameserver count', STATUS.PASS, `${nameservers.length}: ${nameservers.join(', ')}`));
  } else if (nameservers.length === 1) {
    checks.push(makeCheck('Nameserver count', STATUS.WARN, `only one nameserver (${nameservers[0]}) — single point of failure`));
  } else {
    checks.push(makeCheck('Nameserver count', STATUS.FAIL, `no nameservers found (${ns.error || 'no data'})`));
  }
  const nsLookups = await Promise.all(
    nameservers.map(async (host) => {
      const r = await query('A', host);
      return { host, ok: !!(r.records && r.records.length), detail: (r.records || []).join(', ') || r.error };
    })
  );
  for (const n of nsLookups) {
    checks.push(makeCheck(
      `Nameserver ${n.host}`,
      n.ok ? STATUS.PASS : STATUS.FAIL,
      n.ok ? `resolves to ${n.detail}` : `does NOT resolve (${n.detail}) — remove or fix this NS`
    ));
  }

  // 9. Reverse DNS on the first IPv4 address (mail servers and some firewalls care).
  const firstIp = a.records && a.records[0];
  if (firstIp) {
    try {
      const hostnames = await withTimeout(dns.reverse(firstIp), QUERY_TIMEOUT_MS, `PTR ${firstIp}`);
      checks.push(makeCheck('Reverse DNS (PTR)', STATUS.PASS, `${firstIp} -> ${hostnames.join(', ')}`));
    } catch (err) {
      checks.push(makeCheck('Reverse DNS (PTR)', STATUS.WARN, `${firstIp} has no PTR record (${err.code || err.message})`));
    }
  }

  // 10. Wildcard DNS: a random, surely-nonexistent subdomain should NOT resolve.
  const randomLabel = `no-such-host-${Date.now().toString(36)}`;
  const wild = await query('A', `${randomLabel}.${domain}`);
  if (wild.records && wild.records.length) {
    checks.push(makeCheck('Wildcard DNS', STATUS.WARN, `*.${domain} resolves — subdomains all point somewhere; often unintentional`));
  } else {
    checks.push(makeCheck('Wildcard DNS', STATUS.PASS, `random subdomain does not resolve (good)`));
  }

  return checks;
}

// --- output ------------------------------------------------------------------

const ICON = { PASS: '✓', WARN: '!', FAIL: '✗', INFO: '·' };

function printDomainReport(domain, checks) {
  const { verdict } = scoreAudit(checks);
  console.log(`\n=== ${domain}  [${verdict}] ===`);
  for (const c of checks) {
    console.log(`  [${ICON[c.status]} ${c.status.padEnd(4)}] ${c.name}: ${c.detail}`);
  }
}

function printSummary(results) {
  console.log('\n--- Summary ---');
  for (const { domain, verdict } of results) {
    console.log(`  [${verdict}] ${domain}`);
  }
  const failed = results.filter((r) => r.verdict === 'FAIL').length;
  console.log(failed ? `\n${failed} domain(s) have FAILED checks.` : '\nAll domains healthy (no failures).');
}

function writeJsonReport(file, results) {
  const payload = {
    generatedAt: new Date().toISOString(),
    tool: 'dns-checker (day-08)',
    results: results.map(({ domain, checks }) => ({ domain, ...scoreAudit(checks), checks })),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
}

function writeCsvReport(file, results) {
  const lines = ['domain,check,status,detail'];
  for (const { domain, checks } of results) {
    for (const c of checks) lines.push(checkToCsvRow(domain, c));
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// --- main --------------------------------------------------------------------

function usage() {
  console.log(`DNS Health Checker — audit a domain's DNS the way a support tech would.

Usage:
  node dns-checker.js example.com [more-domains...]
  node dns-checker.js --file domains.txt
  node dns-checker.js example.com --json report.json
  node dns-checker.js example.com --csv report.csv

Options:
  --file, -f <path>   read domains from a file (one per line, # = comment)
  --json <path>       write a machine-readable JSON report
  --csv <path>        write a CSV report (one row per check)
  --help, -h          show this help

Exit code is 1 when any check fails (handy for CI / monitoring scripts).`);
}

/** Read a domain list file: one domain per line, blank lines and # comments skipped. */
function readDomainFile(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { usage(); return 0; }

  let domains = opts.domains.map((d) => d.toLowerCase());
  if (opts.file) domains = domains.concat(readDomainFile(opts.file));

  const invalid = domains.filter((d) => !isValidDomain(d));
  if (invalid.length) {
    console.error(`Invalid domain name(s): ${invalid.join(', ')}`);
    return 2;
  }
  if (!domains.length) { usage(); return 2; }

  // Audit domains in small batches so we don't flood the resolver.
  const results = [];
  for (let i = 0; i < domains.length; i += MAX_CONCURRENT_DOMAINS) {
    const batch = await Promise.all(domains.slice(i, i + MAX_CONCURRENT_DOMAINS).map(async (domain) => {
      const checks = await auditDomain(domain);
      return { domain, checks, ...scoreAudit(checks) };
    }));
    for (const r of batch) printDomainReport(r.domain, r.checks);
    results.push(...batch);
  }
  printSummary(results);

  if (opts.jsonOut) { writeJsonReport(opts.jsonOut, results); console.log(`\nJSON report: ${path.resolve(opts.jsonOut)}`); }
  if (opts.csvOut) { writeCsvReport(opts.csvOut, results); console.log(`CSV report: ${path.resolve(opts.csvOut)}`); }

  return results.some((r) => r.verdict === 'FAIL') ? 1 : 0;
}

// Export the pure helpers so test.js can unit-test them.
module.exports = { isValidDomain, findSpfRecord, hasDmarcRecord, scoreAudit, checkToCsvRow, parseArgs, makeCheck, STATUS };

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(2); });
}
