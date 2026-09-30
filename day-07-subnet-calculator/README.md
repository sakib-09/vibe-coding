# Day 07 — Subnet Calculator & IP Toolkit

A single-file web app for IPv4 subnet math: full subnet breakdowns, subnet
planning (splitting one network into equal subnets), and a binary converter.
Zero dependencies, 100% client-side — open it and use it.

## Why this exists

Subnetting shows up everywhere in networking and IT support work: reading a
DHCP scope, planning VLANs, answering "why can't this host reach that host?",
and — very commonly — in job interviews. Being able to look at
`192.168.10.77/26` and immediately know the network, broadcast, and usable
range is a skill interviewers test hands-on.

## How to run

Just open `index.html` in any browser. No build step, no server, no internet needed.

```bash
# or serve it locally
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Features

- **Subnet Calculator** — enter an IP + CIDR prefix and get: subnet mask,
  wildcard mask, network address, broadcast address, first/last usable host,
  total and usable host counts, address class, and address type
  (private / public / loopback / link-local / multicast). The binary view
  highlights network bits in green and host bits in amber so you can *see*
  where the split falls.
- **Subnet Planner** — enter a parent network and how many subnets you need;
  it borrows the right number of bits and lists every resulting subnet with
  its usable range and broadcast address. Rounds up to the next power of two
  (subnets always come in powers of two) and explains when a request is
  impossible.
- **Binary Converter** — click bits to toggle them, or type decimal/binary
  values that stay in sync; plus a full 32-bit binary expansion for any IP.
- Handles the edge cases properly: `/31` point-to-point links (RFC 3021,
  both addresses usable) and `/32` host routes.
- Friendly error messages for malformed input (bad octets, leading zeros,
  non-contiguous masks, impossible splits).

## Example

Input: `192.168.1.10` / `24`

| Field | Result |
|---|---|
| Subnet mask | 255.255.255.0 |
| Network address | 192.168.1.0 |
| Broadcast address | 192.168.1.255 |
| Usable range | 192.168.1.1 – 192.168.1.254 |
| Usable hosts | 254 |

## How it works

All math is done on 32-bit integers with bitwise operators:

- An IPv4 address is really a 32-bit number: `a.b.c.d` =
  `a·256³ + b·256² + c·256 + d`.
- A `/n` prefix means the first `n` bits are the *network* part and the rest
  are the *host* part. The subnet mask is `n` ones followed by zeros.
- `network = IP AND mask`, `broadcast = network OR (NOT mask)`.
- Splitting a network into `k` subnets needs `ceil(log2(k))` extra bits
  borrowed from the host portion.

The core logic lives in pure functions at the top of the `<script>` block
(`parseIPv4`, `subnetInfo`, `planSubnets`, `decToBin8`, …) with the DOM
wiring guarded by `typeof document !== "undefined"` — so the same code runs
in Node for testing.

## Tests

```bash
node test.js   # 57 assertions covering parsing, masks, classes,
               # subnet math, edge cases, and the subnet planner
```
