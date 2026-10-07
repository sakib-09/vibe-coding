# Dupe Finder — duplicate file detector

Day 13 of the vibe-coding series. A Python CLI (standard library only) that
finds duplicate files by *content* and shows how much disk space the extra
copies waste — plus safe, confirm-first cleanup.

## Why this matters

"My disk is full" is one of the most common end-user support tickets, and the
fix is often embarrassingly simple: the same 2 GB video sitting in Downloads,
on the Desktop, and as an email attachment. Support techs hunt these down with
duplicate-finder tools before resorting to bigger disks. This is that tool:
point it at a user's folders, get a report of every wasted byte, and clean up
with confidence.

## How it works (the two-phase trick)

Hashing every file on a disk is slow — it reads every byte. So the tool
filters cheaply first:

1. **Phase 1 — group by file size.** Size comes free from the directory
   listing. A file with a unique size *cannot* be a duplicate, so it's never
   even opened.
2. **Phase 2 — hash only the survivors.** Files sharing a size get a SHA-256
   hash (streamed in 1 MiB chunks, so huge files don't eat RAM). Same size
   **and** same hash = true duplicates.

Same idea as a database index: do the cheap filter first, the expensive
check only on what's left. Bonus details a reviewer will notice: hard links
(same inode) are counted once since they aren't really two files, symlinks
are never followed, and unreadable files are skipped with a count instead of
crashing the scan.

## Run it

Needs Python 3. No packages to install.

```bash
# Report duplicates under one or more folders
python3 dupe_finder.py ~/Documents ~/Downloads

# Ignore small files, write JSON + CSV reports
python3 dupe_finder.py /data --min-size 1M --json dupes.json --csv dupes.csv

# Limit depth, custom excludes
python3 dupe_finder.py ~ --max-depth 3 --exclude "*.tmp"

# Delete redundant copies (keeps the OLDEST copy of each group).
# Prints the plan and asks you to type DELETE before touching anything.
python3 dupe_finder.py ~/Downloads --delete

# Same, but no prompt (for scripts / cron)
python3 dupe_finder.py ~/Downloads --delete --force
```

Run the self-test (builds a fixture tree, checks grouping, wasted-byte math,
JSON/CSV output, and that `--delete` keeps exactly one copy):

```bash
python3 test_dupe_finder.py
```

## Example output

```
========================================================================
Scanned 6 files (13.0 KB) across 3 folders
========================================================================

Found 1 duplicate group(s), 3 files involved.
Deletable: 4.0 KB (2 redundant copies)

[Group 1] 3 copies x 2.0 KB each -- wastes 4.0 KB
    /tmp/dupe_demo/Documents/vacation-photo.jpg
    /tmp/dupe_demo/Downloads/vacation-photo (1).jpg
    /tmp/dupe_demo/Downloads/vacation-photo-final.jpg

Top 3 largest files (candidates for manual review):
        5.0 KB  /tmp/dupe_demo/Documents/big-video.mp4
        2.0 KB  /tmp/dupe_demo/Downloads/vacation-photo-final.jpg
        2.0 KB  /tmp/dupe_demo/Downloads/vacation-photo (1).jpg
```

Notes:

- Empty files are skipped by default (`--min-size 1B`); every empty file
  would otherwise "match" every other one.
- `.git`, `node_modules`, `__pycache__`, `.venv`, and `venv` are excluded by
  default — use `--no-default-excludes` to scan them anyway.
- The "Top N largest files" list is there for the other half of a
  disk-full ticket: the single huge files worth a human look.

## Files

- `dupe_finder.py` — the tool (single file, stdlib only)
- `test_dupe_finder.py` — self-test, 18 checks, all passing
