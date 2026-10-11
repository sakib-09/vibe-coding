#!/usr/bin/env node
/*
 * organize.js — File Organizer
 *
 * Tidies a messy folder (think Downloads or Desktop) by moving files into
 * category folders like "Documents", "Images", "Videos" based on file
 * extension. Designed the way an IT support tech would use it: safe by
 * default, a preview before anything moves, and an undo log so you can
 * always put things back.
 *
 * Node.js standard library only — no npm packages to install.
 *
 * Usage:
 *   node organize.js <folder>              # preview the plan (dry run)
 *   node organize.js <folder> --go         # actually move the files
 *   node organize.js <folder> --undo       # reverse the last --go run
 *
 * Examples:
 *   node organize.js ~/Downloads                       # see what WOULD happen
 *   node organize.js ~/Downloads --go --by-date        # organise into Images/2026-10, ...
 *   node organize.js ~/Downloads --go --recursive     # include subfolders too
 *   node organize.js ~/Downloads --go --json report.json
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Category map: file extension -> folder name.
// Extensions are matched case-insensitively (".JPG" and ".jpg" are the same).
// Anything not listed lands in "Others" so nothing is ever lost.
// ---------------------------------------------------------------------------
const DEFAULT_CATEGORIES = {
  Documents:     ['.doc', '.docx', '.txt', '.rtf', '.md', '.odt', '.pages'],
  PDFs:          ['.pdf'],
  Spreadsheets:  ['.xls', '.xlsx', '.csv', '.ods', '.numbers'],
  Presentations: ['.ppt', '.pptx', '.odp', '.key'],
  Images:        ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.heic', '.tiff', '.ico'],
  Videos:        ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv'],
  Audio:         ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'],
  Archives:      ['.zip', '.tar', '.gz', '.bz2', '.rar', '.7z'],
  Code:          ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.html', '.css', '.json', '.xml', '.php', '.sh', '.sql', '.rb', '.go'],
  Installers:    ['.exe', '.msi', '.dmg', '.pkg', '.deb', '.apk'],
  Fonts:         ['.ttf', '.otf', '.woff', '.woff2'],
};

const OTHERS_CATEGORY = 'Others';
const UNDO_FILENAME = '.file-organizer-undo.json'; // undo log, hidden by the dot prefix

// ---------------------------------------------------------------------------
// Small CLI argument parser. Supports --flags and --key value pairs.
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    target: null,          // folder to organise
    go: false,             // actually move files (default is dry-run preview)
    undo: false,           // reverse the last run
    recursive: false,      // walk into subfolders
    byDate: false,         // nest as Category/YYYY-MM (by file mtime)
    includeHidden: false,  // also organise dotfiles / dotfolders
    json: null,            // write a machine-readable report here
    quiet: false,          // less console output
    categories: null,      // path to a custom categories JSON file
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--go') opts.go = true;
    else if (a === '--undo') opts.undo = true;
    else if (a === '--recursive') opts.recursive = true;
    else if (a === '--by-date') opts.byDate = true;
    else if (a === '--include-hidden') opts.includeHidden = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--json') opts.json = argv[++i];
    else if (a === '--categories') opts.categories = argv[++i];
    else if (a.startsWith('--')) fail(`Unknown option: ${a}\nRun without arguments to see usage.`);
    else rest.push(a);
  }
  if (rest.length > 1) fail('Too many positional arguments. Usage: node organize.js [folder] [options]');
  opts.target = rest[0] ? path.resolve(rest[0]) : process.cwd();
  return opts;
}

function fail(msg) {
  console.error('Error: ' + msg);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Load the extension -> category map. Accepts an optional custom JSON file
// shaped like { "Documents": [".docx", ".txt"], ... } that OVERRIDES the
// defaults entirely (so a company can enforce its own folder policy).
// ---------------------------------------------------------------------------
function loadCategories(customPath) {
  if (!customPath) return extToCategory(DEFAULT_CATEGORIES);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(customPath, 'utf8'));
  } catch (e) {
    fail(`Could not read categories file "${customPath}": ${e.message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`Categories file must be a JSON object like { "Documents": [".txt"] }.`);
  }
  for (const [cat, exts] of Object.entries(parsed)) {
    if (!Array.isArray(exts) || exts.some(e => typeof e !== 'string')) {
      fail(`Category "${cat}" must map to a list of extension strings.`);
    }
  }
  return extToCategory(parsed);
}

// Flips { Category: [ext, ...] } into { ".ext": "Category" } for O(1) lookups.
function extToCategory(map) {
  const lookup = {};
  for (const [category, exts] of Object.entries(map)) {
    for (const ext of exts) {
      const norm = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : '.' + ext.toLowerCase();
      lookup[norm] = category;
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Collect the files to organise. Directories are skipped (we only sort
// files). Symlinks are skipped too — moving a symlink would break whatever
// points at it, and a support tool should never silently do that.
// ---------------------------------------------------------------------------
function collectFiles(target, opts) {
  const files = [];
  const skipped = { dirs: 0, symlinks: 0, hidden: 0, unreadable: 0 };

  // The folders we create for sorting (and the undo log itself) must never
  // be re-scanned, or the tool would try to organise its own output.
  const ownNames = new Set([UNDO_FILENAME, ...new Set(Object.values(opts.lookup))]);

  function walk(dir, depth) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      skipped.unreadable++;
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const hidden = entry.name.startsWith('.');
      if (hidden && !opts.includeHidden) {
        // Hidden files are user's choice; dot-directories are never descended.
        skipped.hidden += entry.isDirectory() ? countTree(full) : 1;
        continue;
      }
      if (entry.isSymbolicLink()) { skipped.symlinks++; continue; }
      if (entry.isDirectory()) {
        skipped.dirs++;
        // Don't descend into the category folders we created ourselves,
        // and respect --recursive for real user subfolders.
        if (opts.recursive && depth > 0 && !ownNames.has(entry.name)) walk(full, depth - 1);
        continue;
      }
      if (entry.isFile()) {
        let stat;
        try { stat = fs.statSync(full); } catch (e) { skipped.unreadable++; continue; }
        // Skip the undo log and anything already sitting inside a category folder.
        const rel = path.relative(target, full);
        const top = rel.split(path.sep)[0];
        if (ownNames.has(top)) continue;
        files.push({ path: full, name: entry.name, mtime: stat.mtime, size: stat.size });
      }
    }
  }

  walk(target, opts.recursive ? Infinity : 1);
  return { files, skipped };
}

// How many files sit under a directory (used to report skipped dot-dirs).
function countTree(dir) {
  let n = 0;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      n += e.isDirectory() ? countTree(path.join(dir, e.name)) : 1;
    }
  } catch (e) { /* unreadable — count what we could */ }
  return n;
}

// ---------------------------------------------------------------------------
// Plan the moves: for each file, work out its destination folder and a
// conflict-free filename. Planning is pure (no filesystem changes), which is
// what makes dry-run previews safe and easy to test.
// ---------------------------------------------------------------------------
function planMoves(target, files, opts) {
  const moves = [];
  const taken = new Set(); // dest paths already claimed by this plan

  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    const category = opts.lookup[ext] || OTHERS_CATEGORY;
    let destDir = path.join(target, category);
    if (opts.byDate) {
      // Nest by last-modified month: e.g. Images/2026-10
      const d = file.mtime;
      destDir = path.join(destDir, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const destName = uniqueName(destDir, file.name, taken);
    moves.push({
      from: file.path,
      to: path.join(destDir, destName),
      category,
      size: file.size,
      renamed: destName !== file.name, // true when a name clash forced a rename
    });
  }
  return moves;
}

// Pick a filename that doesn't collide with an existing file OR with another
// planned move: "photo.jpg" -> "photo (2).jpg" -> "photo (3).jpg", ...
function uniqueName(dir, name, taken) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let i = 2;
  while (fs.existsSync(path.join(dir, candidate)) || taken.has(path.join(dir, candidate))) {
    candidate = `${base} (${i})${ext}`;
    i++;
  }
  taken.add(path.join(dir, candidate));
  return candidate;
}

// ---------------------------------------------------------------------------
// Apply the plan: create folders, move files, write the undo log.
// The undo log is written AFTER every move succeeds; a crashed run simply
// has no log, so --undo never claims to reverse something it didn't record.
// ---------------------------------------------------------------------------
function applyMoves(target, moves) {
  const applied = [];
  for (const move of moves) {
    fs.mkdirSync(path.dirname(move.to), { recursive: true });
    fs.renameSync(move.from, move.to); // same-disk rename: fast, atomic
    applied.push({ from: move.from, to: move.to });
  }
  const undoPath = path.join(target, UNDO_FILENAME);
  fs.writeFileSync(undoPath, JSON.stringify({ createdAt: new Date().toISOString(), moves: applied }, null, 2));
  return applied;
}

// Reverse the last applied run using the undo log.
function undoLast(target) {
  const undoPath = path.join(target, UNDO_FILENAME);
  if (!fs.existsSync(undoPath)) fail('No undo log found — nothing to reverse.');
  const log = JSON.parse(fs.readFileSync(undoPath, 'utf8'));
  let restored = 0;
  // Walk backwards so later moves don't clobber earlier ones.
  for (let i = log.moves.length - 1; i >= 0; i--) {
    const { from, to } = log.moves[i];
    if (!fs.existsSync(to)) continue; // user moved it manually since; skip
    fs.mkdirSync(path.dirname(from), { recursive: true });
    const finalFrom = fs.existsSync(from) ? uniqueName(path.dirname(from), path.basename(from), new Set()) : from;
    fs.renameSync(to, finalFrom);
    restored++;
  }
  fs.unlinkSync(undoPath);
  removeEmptyDirs(target);
  return restored;
}

// Tidy up category folders left empty after an undo (only ones we created).
function removeEmptyDirs(target) {
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(target, entry.name);
    try {
      // Remove YYYY-MM subfolders first, then the category folder itself.
      for (const sub of fs.readdirSync(dir, { withFileTypes: true })) {
        if (sub.isDirectory() && fs.readdirSync(path.join(dir, sub.name)).length === 0) {
          fs.rmdirSync(path.join(dir, sub.name));
        }
      }
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (e) { /* not empty or unreadable — leave it alone */ }
  }
}

// ---------------------------------------------------------------------------
// Reporting: human-readable summary + optional JSON report.
// ---------------------------------------------------------------------------
function report(moves, opts, extra = {}) {
  const byCategory = {};
  for (const m of moves) {
    byCategory[m.category] = byCategory[m.category] || { files: 0, bytes: 0, renamed: 0 };
    byCategory[m.category].files++;
    byCategory[m.category].bytes += m.size;
    if (m.renamed) byCategory[m.category].renamed++;
  }
  if (!opts.quiet) {
    console.log(`\n${moves.length} file(s) across ${Object.keys(byCategory).length} categor${Object.keys(byCategory).length === 1 ? 'y' : 'ies'}:`);
    for (const [cat, s] of Object.entries(byCategory).sort((a, b) => b[1].files - a[1].files)) {
      const renamed = s.renamed ? ` (${s.renamed} renamed)` : '';
      console.log(`  ${cat}: ${s.files} file(s), ${formatBytes(s.bytes)}${renamed}`);
    }
  }
  if (opts.json) {
    fs.writeFileSync(opts.json, JSON.stringify({
      generatedAt: new Date().toISOString(),
      target: opts.target,
      mode: opts.go ? 'applied' : 'dry-run',
      moves: moves.map(m => ({ from: m.from, to: m.to, category: m.category, size: m.size, renamed: m.renamed })),
      summary: byCategory,
      ...extra,
    }, null, 2));
    if (!opts.quiet) console.log(`\nReport written to ${opts.json}`);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(1)} ${units[u]}`;
}

function printUsage() {
  console.log(`
File Organizer — sort a messy folder into category folders by file type.

Usage:
  node organize.js [folder] [options]

  folder            Folder to organise (default: current directory).

Options:
  --go              Actually move files. Without this, only a preview is shown.
  --undo            Reverse the last --go run (uses the undo log in the folder).
  --recursive       Also organise files inside subfolders.
  --by-date         Nest as Category/YYYY-MM using each file's last-modified date.
  --include-hidden  Organise dotfiles too (skipped by default).
  --categories F    Use a custom category map (JSON file) instead of the defaults.
  --json FILE       Write a machine-readable report of the plan/results.
  --quiet           Less console output.

Safety:
  * Default mode is a dry-run preview — nothing moves until you pass --go.
  * Every --go run writes an undo log, so --undo can put everything back.
  * Name clashes become "name (2).ext" instead of overwriting.
  * Symlinks and already-organised category folders are never touched.
`.trim());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(argv) {
  const opts = parseArgs(argv);
  opts.lookup = loadCategories(opts.categories);

  if (!fs.existsSync(opts.target) || !fs.statSync(opts.target).isDirectory()) {
    fail(`"${opts.target}" is not a directory.`);
  }
  // Refuse to organise the filesystem root — a typo'd "/" would be a bad day.
  if (path.resolve(opts.target) === path.parse(opts.target).root) {
    fail('Refusing to organise the filesystem root. Point it at a real folder like ~/Downloads.');
  }

  if (opts.undo) {
    const n = undoLast(opts.target);
    console.log(`Undone: ${n} file(s) restored to their original locations.`);
    return 0;
  }

  const { files, skipped } = collectFiles(opts.target, opts);
  if (files.length === 0) {
    console.log('Nothing to organise — no loose files found.');
    if (skipped.unreadable) console.log(`(Skipped ${skipped.unreadable} unreadable item(s).)`);
    return 0;
  }

  const moves = planMoves(opts.target, files, opts);

  if (!opts.go) {
    if (!opts.quiet) {
      console.log('DRY RUN — nothing was moved. Add --go to apply this plan.\n');
      const show = moves.slice(0, 15);
      for (const m of moves.slice(0, 15)) {
        console.log(`  ${path.basename(m.from)}  ->  ${path.relative(opts.target, m.to)}`);
      }
      if (moves.length > 15) console.log(`  ... and ${moves.length - 15} more`);
    }
    report(moves, opts, { skipped });
    return 0;
  }

  applyMoves(opts.target, moves);
  if (!opts.quiet) console.log(`\nOrganised ${moves.length} file(s). Undo any time with: node organize.js "${opts.target}" --undo`);
  report(moves, opts, { skipped });
  return 0;
}

// Exported for the test suite; the CLI runs only when executed directly.
module.exports = { parseArgs, loadCategories, extToCategory, collectFiles, planMoves, uniqueName, applyMoves, undoLast, DEFAULT_CATEGORIES };

if (require.main === module) {
  if (process.argv.length <= 2) printUsage();
  else process.exit(main(process.argv.slice(2)));
}
