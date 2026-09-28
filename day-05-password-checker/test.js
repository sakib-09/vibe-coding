// Test harness for day-05-password-checker.
// Extracts the <script> block from index.html and runs the PURE logic
// (gradePassword, generatePassword, estimateEntropy, hasSimplePattern,
// humanDuration) in Node. The DOM-wiring section is guarded by
// `typeof document !== "undefined"`, so it safely no-ops here.
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("FAIL: no <script> block found"); process.exit(1); }
const factory = new Function(
  m[1] + "\n;return { gradePassword, generatePassword, estimateEntropy, hasSimplePattern, humanDuration, PRESETS, COMMON_PASSWORDS };"
);
const { gradePassword, generatePassword, estimateEntropy, hasSimplePattern, humanDuration, PRESETS } = factory();

let failures = 0;
function check(name, cond) {
  console.log((cond ? "ok  " : "FAIL") + " - " + name);
  if (!cond) failures++;
}

const standard = PRESETS.standard;
const strict = PRESETS.strict;

// 1. Common password fails
let g = gradePassword("password123", standard);
check("'password123' fails standard policy", !g.passed);
check("'password123' flagged on blocklist", g.rules.find(r => r.key === "banCommon").ok === false);

// 2. Classic pattern fails (sequential + repeats)
g = gradePassword("Qwerty12345!", standard);
check("'Qwerty12345!' fails on pattern rule", g.rules.find(r => r.key === "banPatterns").ok === false);

// 3. Short password fails length
g = gradePassword("Ab1!", standard);
check("'Ab1!' fails minLength 12", g.rules.find(r => r.key === "minLength").ok === false);

// 4. Missing symbol fails
g = gradePassword("CorrectHorse9x", standard);
check("no-symbol password fails requireSymbol", g.rules.find(r => r.key === "requireSymbol").ok === false);

// 5. A strong random-style password passes strict
g = gradePassword("T7#mQ!zL9@vX2$pK", strict);
check("strong 16-char passes strict policy", g.passed === true);
check("strong 16-char entropy ~105 bits", g.entropyBits > 100 && g.entropyBits < 110);

// 6. Entropy math spot-check: 8 lowercase chars => 8 * log2(26) ≈ 37.6 bits
check("entropy(8 lowercase) ≈ 37.6", Math.abs(estimateEntropy("abcdefgh") - 8 * Math.log2(26)) < 0.01);

// 7. Crack-time ordering sane: GPU rig faster than CPU
g = gradePassword("Tr0ub4dor&3xYz!", standard);
check("GPU crack time < CPU crack time", g.crackFastSec < g.crackSlowSec);
g = gradePassword("Ab1!", standard);
check("humanDuration instant for weak pw", humanDuration(g.crackSlowSec) === "instantly");

// 8. Empty password: no crash, no pass
g = gradePassword("", standard);
check("empty password does not pass", g.passed === false && g.score === 0);

// 9. humanDuration formatting
check("humanDuration(90) => ~1 minute", humanDuration(90).includes("minute"));
check("humanDuration(Infinity) => effectively never", humanDuration(Infinity) === "effectively never");

// 10. Generator: correct length, class guarantees, entropy sanity
const gen = generatePassword(20, { lower: true, upper: true, digit: true, symbol: true, noAmbig: true });
check("generator returns 20 chars", gen.length === 20);
check("generator includes all classes", /[a-z]/.test(gen) && /[A-Z]/.test(gen) && /[0-9]/.test(gen) && /[^a-zA-Z0-9]/.test(gen));
check("generator excludes ambiguous chars", !/[0O1lI]/.test(gen));
g = gradePassword(gen, standard);
check("generated password passes standard policy", g.passed === true);

// 11. Generator throws when no classes selected
let threw = false;
try { generatePassword(12, { lower: false, upper: false, digit: false, symbol: false, noAmbig: false }); }
catch { threw = true; }
check("generator throws with no character classes", threw);

// 12. Basic preset is more lenient than strict
const basic = PRESETS.basic;
const gb = gradePassword("BlueSky42!", basic);
const gs = gradePassword("BlueSky42!", strict);
check("basic passes what strict fails", gb.passed === true && gs.passed === false);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
