# Day 06 — Backup Buddy

A command-line backup helper in pure Python (standard library only). It creates
timestamped ZIP archives of your folders, verifies each backup's integrity with
a SHA-256 manifest, and automatically rotates old backups so the disk never
fills up.

## Why this is useful

Backups are one of the first things an IT support / sysadmin tech gets asked to
own: user documents before a reinstall, project folders before a migration,
nightly snapshots on a shared drive. This tool practices the real habits of
that job — timestamped naming, retention policies, exclude lists for junk, and
proof that a backup is actually restorable.

## What it does

- `backup` — archives one or more source folders into `backup_<timestamp>.zip`
- Skips junk by default (`__pycache__`, `.git`, `node_modules`, `*.pyc`, ...)
  with `--exclude` for your own patterns
- `--dry-run` previews what *would* be backed up without writing anything
- `--keep N` keeps only the N most recent backups (rotation)
- `list` — shows existing backups with size and file count
- `verify` — re-hashes every file in a ZIP against its embedded `manifest.json`
  and reports corruption (exit code 1 if anything is damaged, so it works in scripts)

## How to run

No dependencies — just Python 3.8+.

```bash
# Back up two folders, keep the 7 most recent backups
python3 backup_helper.py backup ~/Documents ~/Projects --dest ~/Backups --keep 7

# Preview first (nothing is written)
python3 backup_helper.py backup ~/Documents --dest ~/Backups --dry-run

# See what you have
python3 backup_helper.py list --dest ~/Backups

# Prove a backup is intact
python3 backup_helper.py verify ~/Backups/backup_20260929_152003.zip
```

Extra options: `--exclude '*.tmp'` (repeatable) and `--no-default-excludes`.

## Example output

```
$ python3 backup_helper.py backup ~/Documents --dest ~/Backups --keep 7
Created /home/sakib/Backups/backup_20260929_152003.zip (142 files)
  [rotated] removed backup_20260910_091500.zip (keeping last 7)

$ python3 backup_helper.py verify ~/Backups/backup_20260929_152003.zip
OK: backup_20260929_152003.zip verified (142 files intact)
```

## How it works

- `zipfile` (with `ZIP_DEFLATED`) writes the archive; each file's SHA-256 goes
  into a `manifest.json` stored *inside* the same ZIP.
- `verify` streams each entry back through SHA-256 and compares it to the
  manifest — corruption is caught even if the ZIP still opens.
- Rotation sorts `backup_*.zip` by modification time and deletes the oldest
  until only `--keep` remain.
- Two backups in the same second get a counter suffix (`_1`, `_2`) so they
  never overwrite each other.

## Files

- `backup_helper.py` — the whole tool (~230 lines, heavily commented)
