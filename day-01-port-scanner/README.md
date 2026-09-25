# Day 01 — TCP Port Scanner

A multithreaded TCP connect scanner written in pure Python (standard library
only). Useful for checking which services are listening on a machine — a
bread-and-butter task in IT support and networking.

> Only scan hosts you own or have explicit permission to test.

## Run it

```bash
python port_scanner.py --host 127.0.0.1 --ports 1-1024
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--host` | (required) | Target hostname or IP |
| `--ports` | `1-1024` | Ports to scan: `80`, `1-1024`, or `80,443,8080` |
| `--timeout` | `0.5` | Per-connection timeout in seconds |
| `--workers` | `100` | Number of scanner threads |

## Example

```bash
$ python port_scanner.py --host 127.0.0.1 --ports 20-90
Scanning 127.0.0.1 (127.0.0.1): 71 ports...
Open ports:
  22/tcp   ssh
  80/tcp   http
```

## How it works

Each port gets its own thread from a pool (`concurrent.futures`). Threads
attempt a TCP `connect()` with a short timeout; successes are collected and
reported with the well-known service name via `socket.getservbyport`.
