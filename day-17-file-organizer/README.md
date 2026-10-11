# File Organizer

Day 17 of the vibe-coding series. A Node.js CLI (standard library only) that
sorts a messy folder — think Downloads or Desktop — into category folders like
`Images`, `Documents`, `Videos` based on file extension.

## Why this matters

"My Downloads folder is a mess" and "set up this new user's profile" are
bread-and-butter IT support tasks: onboarding a new hire, migrating a user's
files to a new machine, or just cleaning up a shared folder. Doing it by hand
takes forever and dragging files around by hand is exactly how things get
lost. This tool does it in seconds — with a preview first, safe moves that
never overwrite, and an undo log so any run can be reversed.

## How it works

1. **Scan** — walks the target folder, skipping directories, symlinks
   (moving a symlink would break whatever points at it), and dotfiles
   unless asked.
2. **Classify** — maps each file's extension to a category folder
   (`Images`, `Documents`, `PDFs`, `Spreadsheets`, `Presentations`,
   `Videos`, `Audio`, `Archives`, `Code`, `Installers`, `Fonts`, `Others`).
   Unknown extensions land in `Others` — nothing is ever lost.
3. **Plan** — builds the full move list *before touching anything*, so the
   dry-run preview is exactly what `--go` would do.
4. **Apply safely** — name clashes become `name (2).ext` instead of
   overwriting, and every run writes an undo log so `--undo` restores the
   original layout.

## Run it

Needs Node.js. No packages to install.

```bash
# Preview the plan first — nothing moves (this is the default)
node organize.js ~/Downloads

# Actually move the files
node organize.js ~/Downloads --go

# Undo the last run — everything goes back where it was
node organize.js ~/Downloads --undo
```

More options:

```bash
# Nest by last-modified month: Images/2026-10, Documents/2026-09, ...
node organize.js ~/Downloads --go --by-date

# Also organise files inside subfolders
node organize.js ~/Downloads --go --recursive

# Organise dotfiles too (skipped by default)
node organize.js ~/Downloads --go --include-hidden

# Use your own category map instead of the built-in one
node organize.js ~/Downloads --go --categories my-categories.json

# Write a machine-readable report of the plan/results
node organize.js ~/Downloads --json report.json
```

A custom categories file is plain JSON that replaces the defaults entirely —
useful when a team wants its own folder policy:

```json
{
  "Work": [".docx", ".xlsx", ".pptx"],
  "Personal": [".jpg", ".mp4"]
}
```

Run the test suite (builds throwaway fixture folders, checks dry-run,
category sorting, clash renames, undo, date nesting, custom categories,
hidden files, and the JSON report):

```bash
node test.js
```

## Example output

```
$ node organize.js ~/Downloads

DRY RUN — nothing was moved. Add --go to apply this plan.

  photo.jpg  ->  Images/photo.jpg
  notes.txt  ->  Documents/notes.txt
  song.mp3  ->  Audio/song.mp3
  setup.exe  ->  Installers/setup.exe
  mystery.xyz  ->  Others/mystery.xyz
  ... and 42 more

47 file(s) across 8 categories:
  Images: 18 file(s), 240.5 MB
  Documents: 9 file(s), 3.2 MB (1 renamed)
  ...
```

## Safety notes

- The default mode is a **dry run** — nothing moves until you pass `--go`.
- `--undo` reverses the last `--go` run using the hidden
  `.file-organizer-undo.json` log in the target folder.
- It refuses to run against the filesystem root.
- Files already inside category folders are never re-sorted, so running it
  twice is harmless.
