#!/usr/bin/env python3
"""Day 01 — TCP Port Scanner.

A small multithreaded TCP connect scanner written in Python's standard
library only. Scans a range of ports on a host and reports which ones
accept connections.

Only scan hosts you own or have explicit permission to test.

Usage:
    python port_scanner.py --host 127.0.0.1 --ports 1-1024
    python port_scanner.py --host example.com --ports 80,443,8080 --timeout 1
"""

import argparse
import socket
from concurrent.futures import ThreadPoolExecutor, as_completed


def parse_ports(spec):
    """Turn '80', '1-1024' or '80,443,8080' into a sorted list of ints."""
    ports = set()
    for chunk in spec.split(","):
        chunk = chunk.strip()
        if "-" in chunk:
            start, end = (int(p) for p in chunk.split("-", 1))
            ports.update(range(start, end + 1))
        else:
            ports.add(int(chunk))
    return sorted(p for p in ports if 1 <= p <= 65535)


def is_open(host, port, timeout):
    """Return True if a TCP connection to host:port succeeds."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def scan(host, ports, timeout=0.5, workers=100):
    """Scan ports concurrently, returning the open ones in ascending order."""
    open_ports = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_port = {
            pool.submit(is_open, host, port, timeout): port for port in ports
        }
        for future in as_completed(future_to_port):
            port = future_to_port[future]
            if future.result():
                open_ports.append(port)
    return sorted(open_ports)


def main():
    parser = argparse.ArgumentParser(description="Multithreaded TCP port scanner.")
    parser.add_argument("--host", required=True, help="Target hostname or IP")
    parser.add_argument("--ports", default="1-1024",
                        help="Port spec: '80', '1-1024' or '80,443,8080'")
    parser.add_argument("--timeout", type=float, default=0.5,
                        help="Per-connection timeout in seconds")
    parser.add_argument("--workers", type=int, default=100,
                        help="Number of scanner threads")
    args = parser.parse_args()

    host = args.host
    try:
        resolved = socket.gethostbyname(host)
    except socket.gaierror:
        print(f"Error: could not resolve '{host}'")
        return

    ports = parse_ports(args.ports)
    print(f"Scanning {host} ({resolved}): {len(ports)} ports...")

    open_ports = scan(host, ports, timeout=args.timeout, workers=args.workers)

    if open_ports:
        print("Open ports:")
        for port in open_ports:
            try:
                service = socket.getservbyport(port)
            except OSError:
                service = "unknown"
            print(f"  {port}/tcp  {service}")
    else:
        print("No open ports found.")


if __name__ == "__main__":
    main()
