#!/usr/bin/env python3
"""Self-test for dupe_finder.py.

Builds a fixture tree with known duplicates, then checks that the tool:
  1. finds exactly the right duplicate group (and not same-size non-dupes),
  2. computes wasted bytes correctly,
  3. skips empty files and default-excluded dirs (.git),
  4. writes valid JSON and CSV reports,
  5. --delete keeps one copy and removes the rest,
  6. a dry run deletes nothing.

Run:  python3 test_dupe_finder.py
"""

import csv
import json
import os
import shutil
import subprocess
import sys
import tempfile

TOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dupe_finder.py")
CONTENT = b"identical-bytes-" * 64      # 1024 bytes
OTHER = b"X" * 1024                     # same size, different content


def build_fixture(base):
    """Create the fixture tree. Returns the root path."""
    root = os.path.join(base, "tree")
    dup_content_paths = [
        os.path.join(root, "docs", "report.pdf"),
        os.path.join(root, "downloads", "report (1).pdf"),
        os.path.join(root, "downloads", "nested", "report-final.pdf"),
    ]
    for p in dup_content_paths:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(CONTENT)
    # Same SIZE as CONTENT but different bytes -> must NOT be flagged.
    with open(os.path.join(root, "docs", "other.bin"), "wb") as fh:
        fh.write(OTHER)
    # Empty files are skipped by default (min-size 1B).
    for name in ("empty1.txt", "empty2.txt"):
        open(os.path.join(root, name), "wb").close()
    # .git is excluded by default even though the content matches.
    gitdir = os.path.join(root, ".git")
    os.makedirs(gitdir, exist_ok=True)
    with open(os.path.join(gitdir, "blob"), "wb") as fh:
        fh.write(CONTENT)
    # A unique file, just to make sure it never shows up as a dupe.
    with open(os.path.join(root, "unique.txt"), "wb") as fh:
        fh.write(b"one of a kind")
    return root


def run(*args):
    proc = subprocess.run([sys.executable, TOOL, *args],
                          capture_output=True, text=True)
    return proc


def check(name, condition, detail=""):
    status = "PASS" if condition else "FAIL"
    print(f"[{status}] {name}" + (f" -- {detail}" if detail and not condition else ""))
    if not condition:
        check.failed += 1
check.failed = 0


def main():
    tmp = tempfile.mkdtemp(prefix="dupe_test_")
    try:
        root = build_fixture(tmp)
        json_path = os.path.join(tmp, "report.json")
        csv_path = os.path.join(tmp, "report.csv")

        # --- 1-4: scan + reports -------------------------------------------
        proc = run(root, "--json", json_path, "--csv", csv_path, "--quiet")
        check("exit code 0", proc.returncode == 0, proc.stderr[-500:])

        with open(json_path, encoding="utf-8") as fh:
            report = json.load(fh)
        check("JSON parses", isinstance(report, dict))
        check("one duplicate group", report["totals"]["groups"] == 1,
              f"got {report['totals']['groups']}")
        group = report["duplicate_groups"][0]
        check("group has 3 files", len(group["files"]) == 3,
              f"got {len(group['files'])}")
        check("wasted bytes = 2 copies x 1024",
              group["wasted_bytes"] == 2 * len(CONTENT),
              f"got {group['wasted_bytes']}")
        paths = [f["path"] for f in group["files"]]
        check("same-size different-content file NOT flagged",
              not any(p.endswith("other.bin") for p in paths))
        check(".git content NOT flagged",
              not any(os.sep + ".git" + os.sep in p for p in paths))
        check("empty files NOT flagged",
              not any(p.endswith("empty1.txt") for p in paths))
        check("stats counted 5 real files (3 dupes + other.bin + unique.txt)",
              report["stats"]["files"] == 5,
              f"got {report['stats']['files']}")
        check("largest-files list present",
              len(report["largest_files"]) > 0)

        with open(csv_path, encoding="utf-8", newline="") as fh:
            rows = list(csv.DictReader(fh))
        check("CSV has one row per duplicate file", len(rows) == 3,
              f"got {len(rows)}")
        check("CSV wasted_bytes consistent",
              all(int(r["wasted_bytes"]) == group["wasted_bytes"] for r in rows))

        # --- 5: --delete keeps exactly one copy ------------------------------
        del_root = build_fixture(os.path.join(tmp, "del"))
        proc = run(del_root, "--delete", "--force", "--quiet")
        check("delete run exits 0", proc.returncode == 0, proc.stderr[-500:])
        remaining = []
        for dirpath, _, filenames in os.walk(del_root):
            if os.sep + ".git" + os.sep in dirpath + os.sep:
                continue  # .git is excluded from scans, so its copy survives
            for name in filenames:
                p = os.path.join(dirpath, name)
                if os.path.getsize(p) == len(CONTENT):
                    with open(p, "rb") as fh:
                        if fh.read() == CONTENT:
                            remaining.append(p)
        check("exactly one copy of the content remains", len(remaining) == 1,
              f"got {len(remaining)}")
        check("unique.txt untouched",
              os.path.exists(os.path.join(del_root, "unique.txt")))
        check("other.bin untouched",
              os.path.exists(os.path.join(del_root, "docs", "other.bin")))

        # --- 6: report-only run deletes nothing ------------------------------
        safe_root = build_fixture(os.path.join(tmp, "safe"))
        before = sum(len(files) for _, _, files in os.walk(safe_root))
        run(safe_root, "--quiet")
        after = sum(len(files) for _, _, files in os.walk(safe_root))
        check("report-only run deletes nothing", before == after)

        print()
        if check.failed:
            print(f"{check.failed} check(s) FAILED")
            return 1
        print("All checks passed.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
