// Day 10 — Data Wrangler logic tests.
// Extracts the pure-logic <script id="logic"> block from index.html,
// evaluates it in this sandbox, and asserts behaviour.
// Run: node test.js   (expect: ALL 24 TESTS PASSED)

const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/<script id="logic">([\s\S]*?)<\/script>/);
if (!m) { console.error("FAIL: logic block not found"); process.exit(1); }
eval(m[1]); // defines parseCSV, detectDelimiter, csvToJson, detectJsonShape, jsonToCsv, ...

let passed = 0, failed = 0;
function t(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL:", name); }
}

// --- parseCSV basics ---
t("parse header+rows", (() => {
  const p = parseCSV("a,b,c\n1,2,3\n4,5,6", ",");
  return p.headers.join() === "a,b,c" && p.rows.length === 2 && p.rows[1][2] === "6";
})());

// --- quoted fields, escaped quotes, newline inside quotes ---
t("rfc4180 quoting", (() => {
  const p = parseCSV('name,note\n"Lindqvist, M","said ""hi"""\nB,"line1\nline2"', ",");
  return p.rows[0][0] === "Lindqvist, M" &&
         p.rows[0][1] === 'said "hi"' &&
         p.rows[1][1] === "line1\nline2";
})());

// --- semicolon + tab delimiters ---
t("semicolon delim", (() => parseCSV("a;b\n1;2", ";").headers.length === 2)());
t("tab delim", (() => parseCSV("a\tb\n1\t2", "\t").rows[0][1] === "2")());

// --- ragged rows padded ---
t("ragged row padded", (() => parseCSV("a,b,c\n1,2", ",").rows[0].length === 3 &&
  parseCSV("a,b,c\n1,2", ",").rows[0][2] === "")());

// --- detectDelimiter ---
t("detect comma", detectDelimiter("a,b,c\n1,2,3") === ",");
t("detect semicolon", detectDelimiter("a;b;c\n1;2;3") === ";");
t("detect tab", detectDelimiter("a\tb\n1\t2") === "\t");
t("detect pipe", detectDelimiter("a|b\n1|2") === "|");

// --- csvToJson with headers ---
t("csvToJson objects", (() => {
  const j = csvToJson(parseCSV("name,ticket\nMoe,1", ","), true);
  return j.length === 1 && j[0].name === "Moe" && j[0].ticket === "1";
})());

// --- detectJsonShape ---
t("json array shape", detectJsonShape('[{"a":1}]').kind === "array");
t("json object shape", detectJsonShape('{"a":1}').kind === "object");
t("ndjson shape", detectJsonShape('{"a":1}\n{"a":2}').kind === "ndjson");
t("invalid json", detectJsonShape("not json").kind === "invalid");
t("empty input", detectJsonShape("   ").kind === "invalid");

// --- jsonToCsv union of keys, nested stringify ---
t("jsonToCsv union keys", (() => {
  const { headers, rows } = jsonToCsv([{ a: 1, b: 2 }, { b: 3, c: 4 }]);
  return headers.join() === "a,b,c" && rows[1][0] === "" && rows[1][2] === "4";
})());
t("jsonToCsv nested object", (() => {
  const { rows } = jsonToCsv([{ a: { x: 1 } }]);
  return rows[0][0] === '{"x":1}';
})());
t("jsonToCsv single object", (() => {
  const { headers } = jsonToCsv({ a: 1 });
  return headers.join() === "a";
})());

// --- toCsvText quoting ---
t("toCsvText quotes commas", (() => {
  const s = toCsvText(["a"], [["x,y"]], ",");
  return s.includes('"x,y"');
})());
t("toCsvText quotes quotes", toCsvText(["a"], [['q"q']], ",").includes('"q""q"'));

// --- detectInputKind ---
t("kind json", detectInputKind('[{"a":1}]') === "json");
t("kind csv", detectInputKind("a,b\n1,2") === "csv");

// --- round-trip csv -> json -> csv ---
t("round trip", (() => {
  const csv = "name,ticket\nMoe,1\nPriya,2";
  const j = csvToJson(parseCSV(csv, ","), true);
  const back = jsonToCsv(j);
  return toCsvText(back.headers, back.rows, ",") === csv;
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL TESTS PASSED");
