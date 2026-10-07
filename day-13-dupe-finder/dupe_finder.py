#!/usr/bin/env python3
"""
dupe_finder.py -- find duplicate files and show how much disk space they waste.

A classic IT-support scenario: a user says "my disk is full" and the fix is
often just deleting copies of the same file scattered across Downloads,
Desktop, and email attachments. This tool scans folders, finds files with
identical *content*, and reports (optionally deletes) the extras.

How it finds duplicates -- the two-phase trick:
    Phase 1: group files by size. Files with a unique size cannot possibly
             be duplicates, so they are never read. This is the cheap filter.
    Phase 2: only files that share a size with at least one other file get
             hashed (SHA-256, read in 1 MiB chunks). Files with the same
             size AND the same hash are duplicates.

Why two phases? Hashing reads every byte of a file. On a disk with 100,000
files, hashing everything is slow. Grouping by size first (metadata we get
for free from the directory listing) usually leaves only a handful of files
to actually hash. Same idea as a database index: filter cheaply, then do
the expensive check on what's left.

Usage:
    python3 dupe_finder.py ~/Documents ~/Downloads
    python3 dupe_finder.py /data --min-size 1M --json dupes.json --csv dupes.csv
    python3 dupe_finder.py ~/Downloads --delete            # asks first
    python3 dupe_finder.py ~/Downloads --delete --force    # no prompt (scripts)

Standard library only. Works on Linux, macOS, and Windows.
"""

import argparse
import csv
import fnmatch
import hashlib
import heapq
import json
import os
import sys
import time
from datetime import datetime, timezone

# Read files in 1 MiB chunks when hashing: big enough to be fast,
# small enough that a 10 GB file doesn't eat all your RAM.
CHUNK_SIZE = 1024 * 1024

# Directories skipped by default. Version-control and dependency folders
# are full of intentionally-duplicated files; scanning them is noise.
DEFAULT_EXCLUDES = [".git", "node_modules", "__pycache__", ".venv", "venv"]


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def parse_size(text):
    """Turn '10', '500K', '1.5M', '2G' into a byte count."""
    text = text.strip().upper()
    multipliers = {"B": 1, "K": 1024, "KB": 1024,
                   "M": 1024 ** 2, "MB": 1024 ** 2,
                   "G": 1024 ** 3, "GB": 1024 ** 3}
    for suffix in ("KB", "MB", "GB", "K", "M", "G", "B"):
        if text.endswith(suffix):
            return int(float(text[: -len(suffix)]) * multipliers[suffix])
    return int(float(text))


def human_size(num):
    """Turn a byte count into a friendly string like '1.4 MB'."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if num < 1024 or unit == "TB":
            return f"{num:.1f} {unit}" if unit != "B" else f"{num} B"
        num /= 1024


def iso_time(timestamp):
    """Epoch seconds -> ISO-8601 string in UTC (stable in reports)."""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_excluded(path, patterns):
    """True if any part of the path matches an exclude pattern."""
    parts = os.path.normpath(path).split(os.sep)
    return any(fnmatch.fnmatchcase(part, pat)
               for part in parts for pat in patterns)


# ---------------------------------------------------------------------------
# Phase 0: walk the tree and collect (size, path, mtime) for every file
# ---------------------------------------------------------------------------

def walk_files(roots, exclude, max_depth):
    """Yield one dict per regular file found under roots.

    Skips symlinks (we never follow them: a symlinked tree could loop
    forever), excluded directories, and anything we can't read. Hard links
    (two names for the same inode) are reported once -- they aren't really
    two files, and deleting one name doesn't free space.
    """
    seen_inodes = set()   # (device, inode) pairs already reported
    stats = {"scanned": 0, "dirs": 0, "skipped_unreadable": 0,
             "skipped_symlink": 0, "skipped_hardlink": 0, "skipped_empty": 0}

    for root in roots:
        root = os.path.abspath(root)
        if not os.path.isdir(root):
            print(f"warning: not a directory, skipping: {root}", file=sys.stderr)
            continue
        base_depth = root.rstrip(os.sep).count(os.sep)

        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None,
                                                    followlinks=False):
            stats["dirs"] += 1
            # Prune excluded / symlinked directories in place so os.walk
            # never descends into them.
            dirnames[:] = [d for d in dirnames
                           if not is_excluded(os.path.join(dirpath, d), exclude)
                           and not os.path.islink(os.path.join(dirpath, d))]
            if max_depth is not None and dirpath.count(os.sep) - base_depth >= max_depth:
                dirnames[:] = []

            for name in filenames:
                path = os.path.join(dirpath, name)
                if is_excluded(path, exclude):
                    continue
                if os.path.islink(path):
                    stats["skipped_symlink"] += 1
                    continue
                try:
                    st = os.stat(path)  # follows the file itself, not a link (handled above)
                except OSError:
                    stats["skipped_unreadable"] += 1
                    continue
                if not os.path.isfile(path):
                    continue
                ident = (st.st_dev, st.st_ino)
                if ident in seen_inodes:
                    # Hard link to a file we already counted: same bytes on
                    # disk, so it can't be a "duplicate" worth deleting.
                    stats["skipped_hardlink"] += 1
                    continue
                seen_inodes.add(ident)
                if st.st_size == 0:
                    stats["skipped_empty"] += 1
                    continue
                stats["scanned"] += 1
                yield {"path": path, "size": st.st_size, "mtime": st.st_mtime}

    # Attach the counters to the generator's return path via attribute trick:
    walk_files.stats = stats


# ---------------------------------------------------------------------------
# Phase 2: hash only the files that survived phase 1 (shared size)
# ---------------------------------------------------------------------------

def sha256_of(path):
    """SHA-256 hex digest of a file, streamed in chunks."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def find_duplicates(roots, exclude, max_depth, min_size, top_n, quiet):
    """Run the two-phase scan. Returns (groups, largest, stats)."""
    # -- Phase 1: group by size (free metadata, no file reads) --
    by_size = {}
    largest = []  # min-heap of (size, path) for the "biggest files" report
    total_bytes = 0
    scanned = 0
    last_tick = 0.0

    for info in walk_files(roots, exclude, max_depth):
        if info["size"] < min_size:
            continue
        scanned += 1
        total_bytes += info["size"]
        by_size.setdefault(info["size"], []).append(info)
        if top_n:
            if len(largest) < top_n:
                heapq.heappush(largest, (info["size"], info["path"]))
            elif info["size"] > largest[0][0]:
                heapq.heapreplace(largest, (info["size"], info["path"]))
        # Lightweight progress line, only when talking to a terminal.
        now = time.time()
        if not quiet and sys.stdout.isatty() and now - last_tick > 0.25:
            print(f"\rScanned {scanned:,} files...", end="", flush=True)
            last_tick = now
    if not quiet and sys.stdout.isatty():
        print(f"\rScanned {scanned:,} files.          ")

    stats = dict(walk_files.stats)
    stats.update({"files": scanned, "bytes": total_bytes})

    # -- Phase 2: hash only sizes shared by 2+ files --
    groups = []
    candidates = sum(len(v) for v in by_size.values() if len(v) > 1)
    done = 0
    for size in sorted(by_size):
        infos = by_size[size]
        if len(infos) < 2:
            continue  # unique size -> cannot be a duplicate, never hashed
        by_hash = {}
        for info in infos:
            try:
                digest = sha256_of(info["path"])
            except OSError:
                stats["skipped_unreadable"] += 1
                continue
            info["hash"] = digest
            by_hash.setdefault(digest, []).append(info)
            done += 1
            if not quiet and sys.stdout.isatty() and candidates and done % 25 == 0:
                print(f"\rHashing {done:,}/{candidates:,} candidates...",
                      end="", flush=True)
        for digest, dupes in by_hash.items():
            if len(dupes) < 2:
                continue
            # Sort oldest-first: the "original" is usually the earliest copy.
            dupes.sort(key=lambda d: (d["mtime"], d["path"]))
            groups.append({
                "size": size,
                "hash": digest,
                "wasted_bytes": (len(dupes) - 1) * size,
                "files": [{"path": d["path"],
                           "mtime": iso_time(d["mtime"])} for d in dupes],
            })
    if not quiet and sys.stdout.isatty() and candidates:
        print()

    # Biggest groups first -- that's where the disk space is.
    groups.sort(key=lambda g: g["wasted_bytes"], reverse=True)
    largest.sort(reverse=True)
    return groups, largest, stats


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def print_report(groups, largest, stats, top_n):
    total_wasted = sum(g["wasted_bytes"] for g in groups)
    dup_files = sum(len(g["files"]) for g in groups)

    print("=" * 72)
    print(f"Scanned {stats['files']:,} files "
          f"({human_size(stats['bytes'])}) across {stats['dirs']:,} folders")
    skipped = stats["skipped_unreadable"] + stats["skipped_symlink"] + \
        stats["skipped_hardlink"] + stats["skipped_empty"]
    if skipped:
        print(f"Skipped: {stats['skipped_unreadable']} unreadable, "
              f"{stats['skipped_symlink']} symlinks, "
              f"{stats['skipped_hardlink']} hard links, "
              f"{stats['skipped_empty']} empty files")
    print("=" * 72)

    if not groups:
        print("No duplicate files found. Disk is tidy!")
        return total_wasted

    print(f"\nFound {len(groups)} duplicate group(s), "
          f"{dup_files} files involved.")
    print(f"Deletable: {human_size(total_wasted)} "
          f"({dup_files - len(groups)} redundant copies)\n")

    for i, group in enumerate(groups, 1):
        print(f"[Group {i}] {len(group['files'])} copies x "
              f"{human_size(group['size'])} each -- "
              f"wastes {human_size(group['wasted_bytes'])}")
        for f in group["files"]:
            print(f"    {f['path']}")
        print()

    if top_n and largest:
        print(f"Top {len(largest)} largest files (candidates for manual review):")
        for size, path in largest:
            print(f"    {human_size(size):>10}  {path}")
        print()

    return total_wasted


def write_json(path, groups, largest, stats, roots, args):
    payload = {
        "tool": "dupe_finder",
        "roots": [os.path.abspath(r) for r in roots],
        "options": {"min_size": args.min_size,
                    "exclude": args.exclude,
                    "max_depth": args.max_depth},
        "stats": stats,
        "totals": {
            "groups": len(groups),
            "duplicate_files": sum(len(g["files"]) for g in groups),
            "wasted_bytes": sum(g["wasted_bytes"] for g in groups),
        },
        "duplicate_groups": groups,
        "largest_files": [{"path": p, "size": s} for s, p in largest],
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    print(f"Wrote JSON report: {path}")


def write_csv(path, groups):
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["group", "copies", "size_bytes", "wasted_bytes",
                         "sha256", "path", "mtime_utc"])
        for i, group in enumerate(groups, 1):
            for f in group["files"]:
                writer.writerow([i, len(group["files"]), group["size"],
                                 group["wasted_bytes"], group["hash"],
                                 f["path"], f["mtime"]])
    print(f"Wrote CSV report: {path}")


# ---------------------------------------------------------------------------
# Safe deletion: keep the oldest copy, delete the rest
# ---------------------------------------------------------------------------

def delete_duplicates(groups, force):
    """Delete redundant copies, keeping the oldest file in each group."""
    doomed = []
    for group in groups:
        # files[] is already sorted oldest-first; keep [0], delete the rest.
        doomed.extend(group["files"][1:])

    if not doomed:
        print("Nothing to delete.")
        return 0

    freed = sum(g["size"] for g in groups for _ in g["files"][1:])
    print(f"\nWill delete {len(doomed)} file(s), freeing {human_size(freed)}:")
    for f in doomed:
        print(f"    {f['path']}")
    print("Keeping (oldest copy in each group):")
    for group in groups:
        print(f"    {group['files'][0]['path']}")

    if not force:
        answer = input("\nDelete these files? Type DELETE to confirm: ").strip()
        if answer != "DELETE":
            print("Aborted -- nothing was deleted.")
            return 0

    deleted, failed = 0, 0
    for f in doomed:
        try:
            os.remove(f["path"])
            deleted += 1
        except OSError as exc:
            print(f"  failed to delete {f['path']}: {exc}", file=sys.stderr)
            failed += 1
    print(f"Deleted {deleted} file(s), freeing {human_size(freed)}"
          + (f" ({failed} failed)" if failed else "") + ".")
    return deleted


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Find duplicate files by content and report wasted disk space.")
    parser.add_argument("roots", nargs="+",
                        help="directories to scan (one or more)")
    parser.add_argument("--min-size", default="1B",
                        help="ignore files smaller than this, e.g. 1K, 10M "
                             "(default: 1B -- empty files are skipped)")
    parser.add_argument("--exclude", action="append", default=list(DEFAULT_EXCLUDES),
                        help="skip any path whose name matches this pattern; "
                             "repeatable (default: .git, node_modules, "
                             "__pycache__, .venv, venv)")
    parser.add_argument("--no-default-excludes", action="store_true",
                        help="do not apply the default exclude list")
    parser.add_argument("--max-depth", type=int, default=None,
                        help="how many levels below each root to descend")
    parser.add_argument("--top", type=int, default=10,
                        help="show the N largest files (0 to disable)")
    parser.add_argument("--json", metavar="FILE",
                        help="write a JSON report to FILE")
    parser.add_argument("--csv", metavar="FILE",
                        help="write a CSV report to FILE")
    parser.add_argument("--delete", action="store_true",
                        help="delete redundant copies (keeps the oldest copy "
                             "of each group); asks for confirmation first")
    parser.add_argument("--force", action="store_true",
                        help="with --delete, skip the confirmation prompt")
    parser.add_argument("--quiet", action="store_true",
                        help="suppress progress lines")
    args = parser.parse_args(argv)

    if args.no_default_excludes:
        args.exclude = [p for p in args.exclude if p not in DEFAULT_EXCLUDES]
    min_size = parse_size(args.min_size)

    groups, largest, stats = find_duplicates(
        args.roots, args.exclude, args.max_depth, min_size,
        args.top, args.quiet)
    print_report(groups, largest, stats, args.top)

    if args.json:
        write_json(args.json, groups, largest, stats, args.roots, args)
    if args.csv:
        write_csv(args.csv, groups)

    if args.delete:
        delete_duplicates(groups, args.force)
    elif groups and not args.quiet:
        print("Tip: re-run with --delete to remove redundant copies "
              "(keeps the oldest copy of each).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
