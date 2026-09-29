#!/usr/bin/env python3
"""
backup_helper.py - Backup Buddy

A small, practical backup tool for support and sysadmin work:
takes one or more source folders, creates a timestamped ZIP archive
in a destination folder, verifies the archive's integrity with a
SHA-256 manifest, and keeps only the N most recent backups (rotation).

Usage examples are in the README. Pure standard library - no pip install needed.

    python3 backup_helper.py backup ~/Documents ~/Photos --dest ~/Backups --keep 7
    python3 backup_helper.py list --dest ~/Backups
    python3 backup_helper.py verify ~/Backups/docs_20260929_091500.zip
"""

import argparse
import datetime
import fnmatch
import hashlib
import json
import sys
import zipfile
from pathlib import Path

# Default patterns that are almost never worth backing up.
DEFAULT_EXCLUDES = [
    "__pycache__", "*.pyc", ".git", ".svn", "node_modules",
    ".DS_Store", "Thumbs.db",
]


def utc_now_stamp():
    """Compact sortable timestamp: 20260929_143015 (local time)."""
    return datetime.datetime.now().strftime("%Y%m%d_%H%M%S")


def file_hash(path, chunk_size=65536):
    """SHA-256 hex digest of a file, read in chunks so big files are fine."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def should_exclude(relative_path, patterns):
    """True if any path part matches an exclude pattern."""
    for part in relative_path.parts:
        for pattern in patterns:
            if fnmatch.fnmatch(part, pattern):
                return True
    return False


def collect_files(sources, excludes):
    """
    Walk each source directory and yield (absolute_path, archive_name).

    archive_name nests files under the source folder's own name so a
    backup of ~/Documents lands as documents/report.pdf inside the ZIP.
    """
    for source in sources:
        source = source.resolve()
        if not source.is_dir():
            raise ValueError(f"source is not a directory: {source}")
        prefix = source.name
        for path in sorted(source.rglob("*")):
            relative = path.relative_to(source)
            if should_exclude(relative, excludes):
                continue
            if path.is_file():
                yield path, Path(prefix) / relative
            elif path.is_dir() and path.is_symlink():
                # Skip symlinked directories: they can create loops.
                print(f"  [skip] symlinked dir: {relative}")


def create_backup(sources, dest, keep, excludes, dry_run=False):
    """Create one timestamped ZIP backup and rotate old ones."""
    dest = Path(dest)
    sources = [Path(s) for s in sources]

    files = list(collect_files(sources, excludes))
    if not files:
        print("Nothing to back up (all files excluded or empty sources).")
        return None

    stamp = utc_now_stamp()
    archive_name = f"backup_{stamp}.zip"
    archive_path = dest / archive_name

    if dry_run:
        total_bytes = sum(p.stat().st_size for p, _ in files)
        print(f"[dry-run] Would create {archive_path}")
        print(f"[dry-run] {len(files)} files, ~{total_bytes / 1024 / 1024:.1f} MB")
        return None

    dest.mkdir(parents=True, exist_ok=True)

    # Avoid silently overwriting an existing archive if two backups land
    # in the same second: append a counter (backup_<stamp>_1.zip, ...).
    counter = 0
    while archive_path.exists():
        counter += 1
        archive_path = dest / f"backup_{stamp}_{counter}.zip"

    # The manifest records every file's hash so `verify` can prove the
    # backup is intact later. It lives inside the ZIP as manifest.json.
    manifest = {"created": stamp, "files": {}}
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, arcname in files:
            archive.write(path, arcname)
            manifest["files"][str(arcname)] = file_hash(path)
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))

    print(f"Created {archive_path} ({len(files)} files)")
    rotated = rotate_backups(dest, keep)
    for old in rotated:
        print(f"  [rotated] removed {old.name} (keeping last {keep})")
    return archive_path


def rotate_backups(dest, keep):
    """
    Keep only the newest `keep` backup_*.zip files in dest.
    Returns the list of files that were removed.
    """
    backups = sorted(
        dest.glob("backup_*.zip"),
        key=lambda p: p.stat().st_mtime,
    )
    removed = []
    while len(backups) > keep:
        oldest = backups.pop(0)
        oldest.unlink()
        removed.append(oldest)
    return removed


def list_backups(dest):
    """Print a table of existing backups: name, size, file count."""
    dest = Path(dest)
    backups = sorted(dest.glob("backup_*.zip"),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    if not backups:
        print(f"No backups found in {dest}")
        return
    print(f"{'Archive':<30}{'Size':>12}{'Files':>8}")
    print("-" * 52)
    for archive in backups:
        with zipfile.ZipFile(archive) as zf:
            count = len([i for i in zf.infolist() if i.filename != "manifest.json"])
        size_mb = archive.stat().st_size / 1024 / 1024
        print(f"{archive.name:<30}{size_mb:>10.1f} MB{count:>8}")


def verify_backup(archive_path):
    """
    Re-hash every file in the ZIP and compare against the manifest.
    Exit code 0 = intact, 1 = corrupted or manifest missing.
    """
    archive_path = Path(archive_path)
    with zipfile.ZipFile(archive_path) as archive:
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except KeyError:
            print("FAIL: no manifest.json - not created by backup_helper, cannot verify")
            return 1
        bad = []
        for name, expected in manifest["files"].items():
            digest = hashlib.sha256()
            with archive.open(name) as handle:
                for chunk in iter(lambda: handle.read(65536), b""):
                    digest.update(chunk)
            if digest.hexdigest() != expected:
                bad.append(name)
    if bad:
        print(f"FAIL: {len(bad)} file(s) corrupted:")
        for name in bad:
            print(f"  {name}")
        return 1
    print(f"OK: {archive_path.name} verified ({len(manifest['files'])} files intact)")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Backup Buddy: timestamped ZIP backups with rotation and integrity checks."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_backup = sub.add_parser("backup", help="Create a new backup.")
    p_backup.add_argument("sources", nargs="+", help="Source folder(s) to back up.")
    p_backup.add_argument("--dest", required=True, help="Folder where backups are stored.")
    p_backup.add_argument("--keep", type=int, default=7,
                          help="Keep only the N most recent backups (default: 7).")
    p_backup.add_argument("--exclude", action="append", default=[],
                          help="Extra exclude pattern (repeatable, e.g. --exclude '*.tmp').")
    p_backup.add_argument("--no-default-excludes", action="store_true",
                          help="Do not apply the built-in exclude patterns.")
    p_backup.add_argument("--dry-run", action="store_true",
                          help="Show what would be backed up without writing anything.")

    p_list = sub.add_parser("list", help="List existing backups.")
    p_list.add_argument("--dest", required=True, help="Backup folder.")

    p_verify = sub.add_parser("verify", help="Verify a backup's integrity.")
    p_verify.add_argument("archive", help="Path to a backup_*.zip file.")

    args = parser.parse_args(argv)

    try:
        if args.command == "backup":
            excludes = [] if args.no_default_excludes else list(DEFAULT_EXCLUDES)
            excludes += args.exclude
            create_backup(args.sources, args.dest, args.keep, excludes, args.dry_run)
            return 0
        if args.command == "list":
            list_backups(args.dest)
            return 0
        if args.command == "verify":
            return verify_backup(args.archive)
    except (ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
