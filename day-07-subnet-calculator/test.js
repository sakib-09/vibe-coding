// Test harness for day-07-subnet-calculator.
// Extracts the <script> block from index.html and runs the PURE logic
// in Node. The DOM-wiring section is guarded by
// `typeof document !== "undefined"`, so it safely no-ops here.
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("FAIL: no <script> block found"); process.exit(1); }
const factory = new Function(
  m[1] + "\n;return { parseIPv4, ipToInt, intToIpv4, validCidr, cidrToMaskInt, " +
  "maskIntToCidr, ipClass, ipType, decToBin8, binToDec8, toBinary32, " +
  "subnetInfo, planSubnets, expandIpBinary };"
);
const f = factory();

let failures = 0;
function check(name, cond) {
  console.log((cond ? "ok  " : "FAIL") + " - " + name);
  if (!cond) failures++;
}
function throws(name, fn) {
  let ok = false;
  try { fn(); } catch (e) { ok = true; }
  check(name + " (throws)", ok);
}

// --- parsing ---
check("parseIPv4 192.168.1.10",
  JSON.stringify(f.parseIPv4("192.168.1.10")) === "[192,168,1,10]");
throws("parseIPv4 rejects 999.1.1.1", () => f.parseIPv4("999.1.1.1"));
throws("parseIPv4 rejects 'abc'", () => f.parseIPv4("abc"));
throws("parseIPv4 rejects 3 octets", () => f.parseIPv4("1.2.3"));
throws("parseIPv4 rejects leading zero", () => f.parseIPv4("192.168.01.1"));
throws("parseIPv4 rejects empty octet", () => f.parseIPv4("192.168..1"));

// --- conversions ---
check("cidrToMaskInt(24) -> 255.255.255.0",
  f.intToIpv4(f.cidrToMaskInt(24)) === "255.255.255.0");
check("cidrToMaskInt(0) -> 0.0.0.0",
  f.intToIpv4(f.cidrToMaskInt(0)) === "0.0.0.0");
check("maskIntToCidr(255.255.255.0) -> 24",
  f.maskIntToCidr(f.ipToInt([255, 255, 255, 0])) === 24);
check("maskIntToCidr rejects non-contiguous 255.0.255.0",
  f.maskIntToCidr(f.ipToInt([255, 0, 255, 0])) === null);
check("ipToInt/intToIpv4 round-trip",
  f.intToIpv4(f.ipToInt([10, 0, 5, 23])) === "10.0.5.23");
check("decToBin8(170) -> 10101010", f.decToBin8(170) === "10101010");
check("decToBin8(0) -> 00000000", f.decToBin8(0) === "00000000");
check("binToDec8(10101010) -> 170", f.binToDec8("10101010") === 170);
throws("binToDec8 rejects 7 bits", () => f.binToDec8("1010101"));
throws("binToDec8 rejects letters", () => f.binToDec8("1010101x"));
check("toBinary32 groups octets",
  f.toBinary32(f.ipToInt([192, 168, 1, 1])) === "11000000.10101000.00000001.00000001");
check("expandIpBinary(8.8.8.8)",
  f.expandIpBinary("8.8.8.8") === "00001000.00001000.00001000.00001000");

// --- classification ---
check("ipClass(10) -> A", f.ipClass(10) === "A");
check("ipClass(172) -> B", f.ipClass(172) === "B");
check("ipClass(192) -> C", f.ipClass(192) === "C");
check("ipClass(224) is multicast", f.ipClass(224).startsWith("D"));
check("ipType(10.0.0.1) private", f.ipType([10, 0, 0, 1]).includes("Private"));
check("ipType(172.20.0.1) private", f.ipType([172, 20, 0, 1]).includes("Private"));
check("ipType(192.168.0.1) private", f.ipType([192, 168, 0, 1]).includes("Private"));
check("ipType(127.0.0.1) loopback", f.ipType([127, 0, 0, 1]) === "Loopback");
check("ipType(169.254.1.1) link-local", f.ipType([169, 254, 1, 1]).includes("Link-local"));
check("ipType(8.8.8.8) public", f.ipType([8, 8, 8, 8]).startsWith("Public"));

// --- subnetInfo ---
let s = f.subnetInfo("192.168.1.10", 24);
check("/24 network 192.168.1.0", s.network === "192.168.1.0");
check("/24 broadcast 192.168.1.255", s.broadcast === "192.168.1.255");
check("/24 first usable 192.168.1.1", s.firstUsable === "192.168.1.1");
check("/24 last usable 192.168.1.254", s.lastUsable === "192.168.1.254");
check("/24 total 256", s.totalHosts === 256);
check("/24 usable 254", s.usableHosts === 254);
check("/24 mask 255.255.255.0", s.mask === "255.255.255.0");
check("/24 wildcard 0.0.0.255", s.wildcard === "0.0.0.255");
check("/24 class C", s.className === "C");

s = f.subnetInfo("10.0.5.23", 8);
check("/8 network 10.0.0.0", s.network === "10.0.0.0");
check("/8 broadcast 10.255.255.255", s.broadcast === "10.255.255.255");
check("/8 usable 16777214", s.usableHosts === 16777214);

s = f.subnetInfo("192.168.1.5", 30);
check("/30 network 192.168.1.4", s.network === "192.168.1.4");
check("/30 usable 2", s.usableHosts === 2);
check("/30 first .5 last .6", s.firstUsable === "192.168.1.5" && s.lastUsable === "192.168.1.6");

s = f.subnetInfo("192.168.1.0", 31);
check("/31 usable 2 (RFC 3021)", s.usableHosts === 2);

s = f.subnetInfo("192.168.1.77", 32);
check("/32 usable 1", s.usableHosts === 1);
check("/32 first==last==ip", s.firstUsable === "192.168.1.77" && s.lastUsable === "192.168.1.77");

throws("subnetInfo rejects /33", () => f.subnetInfo("1.2.3.4", 33));
throws("subnetInfo rejects bad IP", () => f.subnetInfo("300.1.1.1", 24));

// --- planSubnets ---
let p = f.planSubnets("192.168.1.0", 24, 4);
check("planner /24 x4 -> /26", p.newCidr === 26);
check("planner makes 4 subnets", p.subnets.length === 4);
check("planner subnet #1 is 192.168.1.0/26", p.subnets[0].network === "192.168.1.0");
check("planner subnet #2 is 192.168.1.64/26", p.subnets[1].network === "192.168.1.64");
check("planner subnet #4 broadcast 192.168.1.255", p.subnets[3].broadcast === "192.168.1.255");

p = f.planSubnets("10.0.0.0", 16, 3);
check("planner rounds 3 up to 4 -> /18", p.newCidr === 18 && p.subnets.length === 4);

p = f.planSubnets("192.168.1.130", 24, 2); // host bits set in input
check("planner normalizes to network address", p.parent === "192.168.1.0/24");

throws("planner refuses /30 into 8 subnets", () => f.planSubnets("10.0.0.0", 30, 8));
throws("planner rejects count 0", () => f.planSubnets("10.0.0.0", 24, 0));

console.log(failures === 0 ? "\nAll tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
