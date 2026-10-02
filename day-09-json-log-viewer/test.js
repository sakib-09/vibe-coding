// Test harness for day-09-json-log-viewer.
// Extracts the <script> block from index.html and runs the PURE logic in
// Node. The DOM-wiring section is guarded by `typeof document !== "undefined"`,
// so it safely no-ops here.
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("FAIL: no <script> block found"); process.exit(1); }
const factory = new Function(
  m[1] + "\n;return { escapeHtml, classifyInput, detectLevel, levelOf, " +
  "normalizeEpoch, extractTimestamp, extractMessage, parseLogInput, " +
  "filterEntries, countByLevel, formatTime, renderJsonHtml, renderEntryHtml, " +
  "renderEntriesHtml, formatForExport };"
);
const f = factory();

let failures = 0;
function check(name, cond) {
  console.log((cond ? "ok  " : "FAIL") + " - " + name);
  if (!cond) failures++;
}

// --- escapeHtml ---
check("escapeHtml angle brackets", f.escapeHtml("<b>x</b>") === "&lt;b&gt;x&lt;/b&gt;");
check("escapeHtml ampersand+quote", f.escapeHtml('a&"b') === "a&amp;&quot;b");

// --- classifyInput ---
check("classify empty", f.classifyInput("   \n ") === "empty");
check("classify single object", f.classifyInput('{"a":1}') === "json");
check("classify pretty-printed object", f.classifyInput('{\n  "a": 1\n}') === "json");
check("classify array", f.classifyInput('[1,2,3]') === "json");
check("classify ndjson", f.classifyInput('{"a":1}\n{"b":2}\n{"c":3}') === "ndjson");
check("classify ndjson with one bad line", f.classifyInput('{"a":1}\nnope\n{"b":2}') === "ndjson");
check("classify garbage", f.classifyInput("hello\nworld") === "invalid");
check("classify single bad line", f.classifyInput("{oops") === "invalid");

// --- detectLevel: strings ---
check("level error", f.detectLevel("error") === "ERROR");
check("level ERROR uppercase", f.detectLevel("ERROR") === "ERROR");
check("level err", f.detectLevel("err") === "ERROR");
check("level fatal", f.detectLevel("fatal") === "ERROR");
check("level warning", f.detectLevel("warning") === "WARN");
check("level info", f.detectLevel("Info") === "INFO");
check("level debug", f.detectLevel("debug") === "DEBUG");
check("level trace", f.detectLevel("trace") === "DEBUG");
check("level unknown string", f.detectLevel("banana") === "UNKNOWN");

// --- detectLevel: numbers (pino + syslog) ---
check("pino 50 -> ERROR", f.detectLevel(50) === "ERROR");
check("pino 60 -> ERROR", f.detectLevel(60) === "ERROR");
check("pino 40 -> WARN", f.detectLevel(40) === "WARN");
check("pino 30 -> INFO", f.detectLevel(30) === "INFO");
check("pino 20 -> DEBUG", f.detectLevel(20) === "DEBUG");
check("pino 10 -> DEBUG", f.detectLevel(10) === "DEBUG");
check("syslog 3 -> ERROR", f.detectLevel(3) === "ERROR");
check("syslog 4 -> WARN", f.detectLevel(4) === "WARN");
check("syslog 6 -> INFO", f.detectLevel(6) === "INFO");
check("syslog 7 -> DEBUG", f.detectLevel(7) === "DEBUG");
check("level null -> UNKNOWN", f.detectLevel(null) === "UNKNOWN");

// --- levelOf ---
check("levelOf level field", f.levelOf({ level: "warn" }) === "WARN");
check("levelOf severity field", f.levelOf({ severity: "ERROR" }) === "ERROR");
check("levelOf numeric pino", f.levelOf({ level: 50 }) === "ERROR");
check("levelOf no level", f.levelOf({ msg: "hi" }) === "UNKNOWN");
check("levelOf non-object", f.levelOf("nope") === "UNKNOWN");

// --- normalizeEpoch ---
check("epoch seconds", f.normalizeEpoch(1759371306) === 1759371306000);
check("epoch millis", f.normalizeEpoch(1759371306421) === 1759371306421);
check("epoch micros", f.normalizeEpoch(1759371306421000) === 1759371306421);
check("epoch too small", f.normalizeEpoch(42) === null);

// --- extractTimestamp ---
check("timestamp ISO string", f.extractTimestamp({ timestamp: "2026-10-02T08:15:03.421Z" }) === "2026-10-02T08:15:03.421Z");
check("timestamp epoch seconds", f.extractTimestamp({ ts: 1759371306 }) === "2025-10-02T02:15:06.000Z");
check("timestamp epoch millis", f.extractTimestamp({ ts: 1759371306421 }) === "2025-10-02T02:15:06.421Z");
check("timestamp bad string", f.extractTimestamp({ time: "not a date" }) === null);
check("timestamp missing", f.extractTimestamp({ a: 1 }) === null);

// --- extractMessage ---
check("message msg field", f.extractMessage({ msg: "hello" }, "fb") === "hello");
check("message prefers message field", f.extractMessage({ message: "m", msg: "x" }, "fb") === "m");
check("message object value stringified", f.extractMessage({ error: { code: 1 } }, "fb") === '{"code":1}');
check("message fallback", f.extractMessage({ a: 1 }, "fb") === "fb");

// --- parseLogInput: single object -> tree mode ---
let r = f.parseLogInput('{"level":"info","msg":"hi"}');
check("json mode", r.mode === "json");
check("json one entry", r.entries.length === 1);
check("json entry level", r.entries[0].level === "INFO");
check("json entry message", r.entries[0].message === "hi");
check("json no parse errors", r.parseErrors === 0);

// --- parseLogInput: array ---
r = f.parseLogInput('[{"level":"error","msg":"a"},{"level":"info","msg":"b"}]');
check("array mode json", r.mode === "json");
check("array two entries", r.entries.length === 2);
check("array line numbers", r.entries[0].lineNo === 1 && r.entries[1].lineNo === 2);

// --- parseLogInput: ndjson with a corrupt line ---
r = f.parseLogInput('{"level":"info","msg":"ok"}\nnot json\n{"level":"error","msg":"bad"}');
check("ndjson mode", r.mode === "ndjson");
check("ndjson three entries", r.entries.length === 3);
check("ndjson one parse error", r.parseErrors === 1);
check("ndjson bad line flagged", r.entries[1].parseError === true);
check("ndjson good line level", r.entries[2].level === "ERROR");

// --- filterEntries ---
const entries = [
  { level: "ERROR", raw: '{"msg":"disk full"}' },
  { level: "INFO", raw: '{"msg":"disk ok"}' },
  { level: "DEBUG", raw: '{"msg":"trace x"}' },
];
check("filter by level", f.filterEntries(entries, ["ERROR"], "").length === 1);
check("filter by query", f.filterEntries(entries, ["ERROR", "INFO", "DEBUG"], "disk").length === 2);
check("filter query case-insensitive", f.filterEntries(entries, ["ERROR", "INFO", "DEBUG"], "DISK").length === 2);
check("filter empty result", f.filterEntries(entries, ["WARN"], "").length === 0);

// --- countByLevel ---
const counts = f.countByLevel(entries);
check("count ERROR", counts.ERROR === 1 && counts.INFO === 1 && counts.DEBUG === 1);

// --- formatTime ---
check("formatTime returns string", typeof f.formatTime("2026-10-02T08:15:03.421Z") === "string");
check("formatTime contains year", f.formatTime("2026-10-02T08:15:03.421Z").indexOf("2026") !== -1);

// --- renderJsonHtml ---
const tree = f.renderJsonHtml({ a: 1, b: "x", c: null, d: true, e: [1, 2], f: { g: 1 } });
check("tree escapes key", tree.indexOf('<span class="j-key">&quot;a&quot;</span>') !== -1);
check("tree string class", tree.indexOf('<span class="j-str">') !== -1);
check("tree number class", tree.indexOf('<span class="j-num">1</span>') !== -1);
check("tree null class", tree.indexOf('<span class="j-null">null</span>') !== -1);
check("tree bool class", tree.indexOf('<span class="j-bool">true</span>') !== -1);
check("tree collapsible", tree.indexOf("<details") !== -1);
check("tree xss-escaped", f.renderJsonHtml({ k: "<script>alert(1)</script>" }).indexOf("<script>") === -1);

// --- renderEntryHtml ---
const entryHtml = f.renderEntryHtml({
  lineNo: 3, raw: '{"level":"error"}', data: { level: "error" }, parseError: false,
  level: "ERROR", timestamp: "2026-10-02T08:15:03.421Z", message: "boom"
});
check("entry badge", entryHtml.indexOf('lv-error">ERROR') !== -1);
check("entry message", entryHtml.indexOf("boom") !== -1);
check("entry detail hidden", entryHtml.indexOf('class="entry-detail" hidden') !== -1);
const badHtml = f.renderEntryHtml({
  lineNo: 4, raw: "not json", data: null, parseError: true,
  level: "UNKNOWN", timestamp: null, message: "not json"
});
check("bad entry flagged", badHtml.indexOf("not valid JSON") !== -1);

// --- renderEntriesHtml ---
check("entries empty message", f.renderEntriesHtml([]).indexOf("No entries match") !== -1);

// --- formatForExport ---
r = f.parseLogInput('{"b":2,"a":1}\n{"c":3}');
const exported = f.formatForExport(r);
check("export pretty-prints", exported.indexOf('\n  "a": 1') !== -1 || exported.indexOf('\n  "b": 2') !== -1);
check("export invalid mode empty", f.formatForExport({ mode: "invalid", entries: [] }) === "");

console.log(failures === 0 ? "\nAll checks passed." : "\n" + failures + " FAILURES.");
process.exit(failures === 0 ? 0 : 1);
