/*
 * test.js — tests for the File Organizer.
 *
 * Each test builds a fresh fixture folder under the OS temp dir, runs the
 * real CLI (organize.js) as a child process, and asserts on the resulting
 * file layout. Fixtures are created here and torn down after every test —
 * nothing is committed.
 *
 * Run:  node test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'organize.js');
const UNDO_FILE = '.file-organizer-undo.json';

function runCli(args) {
  // Throws on non-zero exit, so a CLI crash fails the test.
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function fixture(files) {
  // files: { "name.ext": "contents" } -> absolute path of the temp folder
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-organizer-test-'));
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dir;
}

function listAll(dir) {
  // Flat list of files under dir, relative paths with forward slashes.
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  })(dir);
  return out.sort();
}

let passed = 0;
function test(name, files, fn) {
  const dir = fixture(files);
  try {
    fn(dir);
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}\n    ${e.message.split('\n')[0]}`);
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// 1. Dry run is the default: nothing moves, files stay where they are.
test('dry run moves nothing by default',
  { 'photo.jpg': 'x', 'notes.txt': 'y', 'song.mp3': 'z' },
  (dir) => {
    runCli([dir]);
    assert.deepStrictEqual(listAll(dir), ['notes.txt', 'photo.jpg', 'song.mp3']);
  });

// 2. --go sorts files into the right category folders.
test('--go moves files into category folders',
  { 'photo.jpg': 'x', 'notes.txt': 'y', 'song.mp3': 'z', 'slides.pptx': 'w', 'archive.zip': 'v', 'weird.xyz': 'u' },
  (dir) => {
    runCli([dir, '--go', '--quiet']);
    const files = listAll(dir).filter(f => f !== UNDO_FILE);
    assert.deepStrictEqual(files, [
      'Archives/archive.zip',
      'Audio/song.mp3',
      'Documents/notes.txt',
      'Images/photo.jpg',
      'Others/weird.xyz',
      'Presentations/slides.pptx',
    ]);
  });

// 3. A name clash never overwrites: the second file becomes "name (2).ext".
test('name clashes get a (2) suffix instead of overwriting',
  { 'report.pdf': 'old', 'sub/report.pdf': 'new' },
  (dir) => {
    runCli([dir, '--go', '--recursive', '--quiet']);
    assert(fs.existsSync(path.join(dir, 'PDFs/report.pdf')), 'original should exist');
    assert(fs.existsSync(path.join(dir, 'PDFs/report (2).pdf')), 'clash should be renamed');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'PDFs/report (2).pdf'), 'utf8'), 'new');
  });

// 4. --undo puts everything back where it came from.
test('--undo restores the original layout',
  { 'photo.jpg': 'x', 'notes.txt': 'y' },
  (dir) => {
    runCli([dir, '--go', '--quiet']);
    assert(listAll(dir).some(f => f.startsWith('Images/')), 'file should be moved first');
    runCli([dir, '--undo']);
    assert.deepStrictEqual(listAll(dir), ['notes.txt', 'photo.jpg']);
  });

// 5. --by-date nests files under Category/YYYY-MM by modification time.
test('--by-date nests by modification month', { 'photo.jpg': 'x' }, (dir) => {
  const old = new Date('2024-03-15T12:00:00Z');
  fs.utimesSync(path.join(dir, 'photo.jpg'), old, old);
  runCli([dir, '--go', '--by-date', '--quiet']);
  assert.deepStrictEqual(
    listAll(dir).filter(f => f !== UNDO_FILE),
    ['Images/2024-03/photo.jpg']
  );
});

// 6. A custom categories file overrides the defaults.
test('custom --categories file is honoured', { 'photo.jpg': 'x', 'notes.txt': 'y' }, (dir) => {
  const cats = path.join(dir, 'cats.json');
  fs.writeFileSync(cats, JSON.stringify({ Work: ['.txt'], Fun: ['.jpg'] }));
  runCli([dir, '--go', '--categories', cats, '--quiet']);
  const files = listAll(dir).filter(f => f !== UNDO_FILE && f !== 'cats.json');
  assert(files.includes('Work/notes.txt'), 'notes.txt should be in Work');
  assert(files.includes('Fun/photo.jpg'), 'photo.jpg should be in Fun');
  assert(files.includes('Others/cats.json'), 'cats.json should fall into Others');
});

// 7. Hidden files are skipped unless --include-hidden is passed.
test('hidden files are skipped by default, moved with --include-hidden',
  { '.secret.txt': 'x', 'normal.txt': 'y' },
  (dir) => {
    runCli([dir, '--go', '--quiet']);
    assert(fs.existsSync(path.join(dir, '.secret.txt')), 'dotfile should be untouched');
    runCli([dir, '--go', '--include-hidden', '--quiet']);
    assert(fs.existsSync(path.join(dir, 'Documents/.secret.txt')), 'dotfile should be organised now');
  });

// 8. --json writes a machine-readable report of what was (or would be) done.
test('--json writes a structured report', { 'photo.jpg': 'x', 'notes.txt': 'y' }, (dir) => {
  const report = path.join(dir, 'report.json');
  runCli([dir, '--json', report, '--quiet']);
  const data = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.strictEqual(data.mode, 'dry-run');
  assert.strictEqual(data.moves.length, 2);
  assert(data.moves.every(m => m.from && m.to && m.category), 'each move needs from/to/category');
  assert.deepStrictEqual(
    listAll(dir).filter(f => f !== 'report.json'),
    ['notes.txt', 'photo.jpg']
  );
});

// 9. Running with no arguments prints usage instead of touching anything.
test('no arguments prints usage', {}, () => {
  const out = runCli([]);
  assert(out.includes('Usage:'), 'should print usage');
});

console.log(`\n${passed} test(s) passed${process.exitCode ? ' — FAILURES PRESENT' : ''}.`);
