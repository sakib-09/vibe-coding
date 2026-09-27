#!/usr/bin/env node
/*
 * link-checker.js — a small QA link checker.
 *
 * Give it a list of URLs and it checks each one: follows redirects, measures
 * how long the server takes to answer, and tells you which links are broken,
 * slow, or redirecting. It prints a summary table and can save a JSON/CSV
 * report. Exit code is 1 if any link is broken, so it can run in CI pipelines.
 *
 * Only Node's built-in modules are used — no `npm install` needed.
 *
 * Usage:
 *   node link-checker.js urls.txt
 *   node link-checker.js https://example.com https://example.com/missing
 *   node link-checker.js urls.txt --timeout 8 --concurrency 5 --out report.json
 */

const fs = require("fs");
const http = require("http");
const https = require("https");

// ---------------------------------------------------------------------------
// Command-line argument parsing (kept simple: "key value" pairs + a URL list)
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const options = {
  timeout: 10,        // seconds to wait for a server before calling it a timeout
  concurrency: 5,     // how many URLs to check at the same time
  out: null,          // path for the JSON report (optional)
  csv: false,         // also write a CSV report next to the JSON one
};
const urlSources = []; // raw strings that may be URLs or a path to a URL file

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--timeout" && args[i + 1]) options.timeout = Number(args[++i]);
  else if (a === "--concurrency" && args[i + 1]) options.concurrency = Number(args[++i]);
  else if (a === "--out" && args[i + 1]) options.out = args[++i];
  else if (a === "--csv") options.csv = true;
  else if (!a.startsWith("-")) urlSources.push(a);
}

if (urlSources.length === 0) {
  console.log("Usage: node link-checker.js <urls.txt | url ...> [--timeout N] [--concurrency N] [--out report.json] [--csv]");
  process.exit(2);
}

// If an argument is an existing file, read URLs out of it (one per line).
// Otherwise treat the argument itself as a URL.
const urls = [];
for (const src of urlSources) {
  if (fs.existsSync(src) && fs.statSync(src).isFile()) {
    const lines = fs.readFileSync(src, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) urls.push(trimmed);
    }
  } else {
    urls.push(src);
  }
}

// Add the scheme when missing ("example.com" -> "https://example.com").
const normalized = urls.map((u) => (/^https?:\/\//i.test(u) ? u : "https://" + u));

// ---------------------------------------------------------------------------
// Fetch one URL. Returns a result object describing what happened.
// Follows redirects manually (up to 5 hops) and records the chain.
// ---------------------------------------------------------------------------
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function fetchOnce(url, method, timeoutMs) {
  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const start = Date.now();
    let settled = false;

    const req = client.request(url, { method }, (res) => {
      // Drain the body so the socket closes cleanly, then report the header.
      res.resume();
      res.on("end", () => {
        if (!settled) {
          settled = true;
          resolve({ status: res.statusCode, headers: res.headers, ms: Date.now() - start });
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        // Keep both the machine-readable code (ENOTFOUND, ECONNREFUSED, ...)
        // and the human-readable message for classification below.
        resolve({ error: (err.code ? err.code + ": " : "") + err.message, ms: Date.now() - start });
      }
    });
    req.setTimeout(timeoutMs);
    req.end();
  });
}

async function checkUrl(startUrl, timeoutMs) {
  const chain = []; // every hop we follow, in order
  let url = startUrl;
  let method = "HEAD"; // HEAD is cheaper; some servers reject it, so we fall back to GET

  for (let hop = 0; hop <= 5; hop++) {
    let attempt = await fetchOnce(url, method, timeoutMs);

    // Some servers answer 405 (Method Not Allowed) to HEAD — retry with GET.
    if (attempt.status === 405 && method === "HEAD") {
      method = "GET";
      attempt = await fetchOnce(url, method, timeoutMs);
    }

    if (attempt.error) {
      return { url: startUrl, ok: false, kind: classifyError(attempt.error), finalUrl: url, ms: attempt.ms, chain, detail: attempt.error };
    }

    chain.push({ url, status: attempt.status, ms: attempt.ms });

    if (REDIRECT_CODES.has(attempt.status) && attempt.headers.location) {
      url = new URL(attempt.headers.location, url).href; // resolve relative redirects
      method = "HEAD"; // restart hop logic with the cheaper method
      continue;
    }

    const ok = attempt.status < 400;
    const kind = ok
      ? (chain.length > 1 ? "redirect-ok" : "ok")
      : "broken";
    return {
      url: startUrl,
      ok,
      kind,
      status: attempt.status,
      finalUrl: url,
      ms: attempt.ms,
      chain,
    };
  }

  return { url: startUrl, ok: false, kind: "too-many-redirects", finalUrl: url, chain };
}

function classifyError(message) {
  if (/timeout/i.test(message)) return "timeout";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "dns-error";
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH/i.test(message)) return "connection-error";
  if (/certificate|SSL/i.test(message)) return "ssl-error";
  return "request-error";
}

// ---------------------------------------------------------------------------
// Run all checks with a concurrency limit (a tiny homemade semaphore).
// ---------------------------------------------------------------------------
async function run(urls, { timeout, concurrency }) {
  const results = new Array(urls.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= urls.length) return;
      results[i] = await checkUrl(urls[i], timeout * 1000);
      reportProgress(i + 1, urls.length, results[i]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, worker);
  await Promise.all(workers);
  return results;
}

function reportProgress(done, total, r) {
  const icon = r.ok ? (r.kind === "ok" ? "OK  " : "REDIR") : "FAIL ";
  const note = r.ok ? `${r.status} in ${r.ms}ms` : `${r.kind}`;
  console.log(`[${done}/${total}] ${icon} ${r.url}  (${note})`);
}

// ---------------------------------------------------------------------------
// Summary + reports
// ---------------------------------------------------------------------------
function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.kind] = (counts[r.kind] || 0) + 1;

  console.log("\n----- Summary -----");
  console.log(`Checked : ${results.length}`);
  for (const [kind, n] of Object.entries(counts)) console.log(`${kind.padEnd(20)}: ${n}`);
  const broken = results.filter((r) => !r.ok);
  if (broken.length > 0) {
    console.log("\nBroken links:");
    for (const r of broken) console.log(`  - ${r.url}  [${r.kind}] ${r.status || r.detail || ""}`);
  }
  return broken.length;
}

function writeReports(results, options) {
  if (!options.out) return;
  const rows = results.map((r) => ({
    url: r.url,
    ok: r.ok,
    kind: r.kind,
    status: r.status ?? null,
    finalUrl: r.finalUrl,
    ms: r.ms,
    redirects: Math.max(0, r.chain.length - 1),
    detail: r.detail ?? null,
  }));
  fs.writeFileSync(options.out, JSON.stringify(rows, null, 2));
  console.log(`\nJSON report written to ${options.out}`);

  if (options.csv) {
    const csvPath = options.out.replace(/\.json$/i, "") + ".csv";
    const head = "url,ok,kind,status,final_url,ms,redirects,detail";
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [r.url, r.ok, r.kind, r.status ?? "", r.finalUrl, r.ms, r.redirects, r.detail ?? ""].map(esc).join(","));
    fs.writeFileSync(csvPath, head + "\n" + lines.join("\n") + "\n");
    console.log(`CSV report written to ${csvPath}`);
  }
}

// ---------------------------------------------------------------------------
(async () => {
  const results = await run(normalized, options);
  const brokenCount = summarize(results);
  writeReports(results, options);
  process.exit(brokenCount > 0 ? 1 : 0); // non-zero exit = broken links found (CI-friendly)
})();
