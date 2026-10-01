/*
 * Day 08 — DNS Health Checker: unit tests for the pure (no-network) helpers.
 * Run: node test.js
 */
'use strict';

const {
  isValidDomain, findSpfRecord, hasDmarcRecord, scoreAudit,
  checkToCsvRow, parseArgs, makeCheck, STATUS,
} = require('./dns-checker.js');

let passed = 0;
function assert(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); process.exitCode = 1; }
  else { passed++; }
}
function eq(a, b, label) { assert(a === b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

// --- isValidDomain ---
assert(isValidDomain('example.com'), 'plain domain valid');
assert(isValidDomain('sub.mail.example.co.uk'), 'multi-label domain valid');
assert(!isValidDomain('not a domain'), 'spaces rejected');
assert(!isValidDomain(''), 'empty rejected');
assert(!isValidDomain('nodot'), 'single label rejected');
assert(!isValidDomain('-bad.com'), 'leading dash rejected');

// --- findSpfRecord ---
eq(findSpfRecord([['v=spf1', ' include:_spf.google.com ~all']]), 'v=spf1 include:_spf.google.com ~all', 'spf joined + found');
eq(findSpfRecord([['some other text']]), null, 'no spf -> null');
eq(findSpfRecord(null), null, 'null input -> null');

// --- hasDmarcRecord ---
assert(hasDmarcRecord([['v=DMARC1; p=reject;']]), 'dmarc detected');
assert(!hasDmarcRecord([['v=spf1 include:x ~all']]), 'non-dmarc rejected');
assert(!hasDmarcRecord([]), 'empty rejected');

// --- scoreAudit ---
eq(scoreAudit([makeCheck('a', STATUS.PASS), makeCheck('b', STATUS.WARN)]).verdict, 'WARN', 'warn verdict');
eq(scoreAudit([makeCheck('a', STATUS.WARN), makeCheck('b', STATUS.FAIL)]).verdict, 'FAIL', 'fail beats warn');
eq(scoreAudit([makeCheck('a', STATUS.PASS)]).verdict, 'PASS', 'pass verdict');
eq(scoreAudit([makeCheck('a', STATUS.FAIL)]).fail, 1, 'fail counted');

// --- checkToCsvRow ---
eq(checkToCsvRow('example.com', makeCheck('MX', STATUS.PASS, 'a, "b"')),
  '"example.com","MX","PASS","a, ""b"""', 'csv quoting');

// --- parseArgs ---
const p = parseArgs(['a.com', '--json', 'r.json', 'b.com', '--csv', 'r.csv', '--file', 'd.txt']);
eq(p.domains.join(','), 'a.com,b.com', 'domains parsed');
eq(p.jsonOut, 'r.json', 'json flag');
eq(p.csvOut, 'r.csv', 'csv flag');
eq(p.file, 'd.txt', 'file flag');
assert(parseArgs(['--help']).help, 'help flag');
let threw = false;
try { parseArgs(['--nope']); } catch { threw = true; }
assert(threw, 'unknown flag throws');

console.log(`${passed} assertions passed.`);
