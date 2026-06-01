'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'src', 'format.js');
const UNFORMATTED = '# t\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
const FORMATTED = '# t\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n';

function run(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    // run from the project root so mdformat.config.js / .mdformatignore resolve
    cwd: path.join(__dirname, '..'),
    ...opts,
  });
}

test('--check exits non-zero when a file needs formatting and does not write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-'));
  try {
    const file = path.join(dir, 'doc.md');
    fs.writeFileSync(file, UNFORMATTED);
    const res = run(['--check', '--tables-only', file]);
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    // --check must not modify the file
    assert.strictEqual(fs.readFileSync(file, 'utf8'), UNFORMATTED);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--check exits zero when everything is already formatted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-'));
  try {
    const file = path.join(dir, 'doc.md');
    fs.writeFileSync(file, FORMATTED);
    const res = run(['--check', '--tables-only', file]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('does not recurse forever on a symlink cycle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-'));
  try {
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'doc.md'), UNFORMATTED);
    // a link inside sub pointing back at its parent → cycle
    try {
      fs.symlinkSync(dir, path.join(sub, 'loop'));
    } catch {
      return; // platform without symlink support; nothing to assert
    }
    const res = run(['--dry-run', '--tables-only', dir], { timeout: 20000 });
    assert.strictEqual(res.signal, null, 'process should not be killed/hang');
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /would format/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
