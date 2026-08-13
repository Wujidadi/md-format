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
    // run from the project root so mdformat.config.js resolves
    cwd: path.join(__dirname, '..'),
    ...opts,
  });
}

// Build a directory tree from a { relativePath: contents } map, creating parent directories as needed.
function makeTree(spec) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-'));
  for (const [rel, contents] of Object.entries(spec)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return dir;
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

test('excludes ignored directories at any depth (nested node_modules)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-'));
  try {
    fs.mkdirSync(path.join(dir, 'pkg', 'node_modules', 'dep'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(dir, 'pkg', 'real.md'), UNFORMATTED);
    fs.writeFileSync(
      path.join(dir, 'pkg', 'node_modules', 'dep', 'README.md'),
      UNFORMATTED,
    );
    const res = run(['--dry-run', '--tables-only', dir]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /pkg[/\\]real\.md/);
    assert.doesNotMatch(res.stdout, /node_modules/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a .mdformatignore applies to its own directory subtree only', () => {
  const dir = makeTree({
    'top.md': UNFORMATTED,
    'docs/.mdformatignore': 'gen/\n',
    'docs/keep.md': UNFORMATTED,
    'docs/gen/auto.md': UNFORMATTED,
    // the same name outside docs/ is unaffected by docs/.mdformatignore
    'other/gen/auto.md': UNFORMATTED,
  });
  try {
    const res = run(['--dry-run', '--tables-only', dir]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /top\.md/);
    assert.match(res.stdout, /docs[/\\]keep\.md/);
    assert.doesNotMatch(res.stdout, /docs[/\\]gen/);
    assert.match(res.stdout, /other[/\\]gen[/\\]auto\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a .mdformatignore adds to the built-in defaults instead of replacing them', () => {
  const dir = makeTree({
    '.mdformatignore': 'CHANGELOG.md\n',
    'CHANGELOG.md': UNFORMATTED,
    'real.md': UNFORMATTED,
    'node_modules/dep/README.md': UNFORMATTED,
  });
  try {
    const res = run(['--dry-run', '--tables-only', dir]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /real\.md/);
    assert.doesNotMatch(res.stdout, /CHANGELOG/);
    // the defaults still apply even though the tree has its own ignore file
    assert.doesNotMatch(res.stdout, /node_modules/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a negation in .mdformatignore can undo a built-in default', () => {
  const dir = makeTree({
    '.mdformatignore': '!node_modules\n',
    'node_modules/dep/README.md': UNFORMATTED,
  });
  try {
    const res = run(['--dry-run', '--tables-only', dir]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /node_modules[/\\]dep[/\\]README\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a nested negation re-includes a subtree an outer layer excluded', () => {
  // Verified against `git check-ignore`: with `node_modules` at the root and `!node_modules` in docs/, git does not ignore docs/node_modules/dep/README.md.
  const dir = makeTree({
    'docs/.mdformatignore': '!node_modules\n',
    'docs/node_modules/dep/README.md': UNFORMATTED,
    // outside docs/ the default still applies
    'node_modules/dep/README.md': UNFORMATTED,
  });
  try {
    const res = run(['--dry-run', '--tables-only', dir]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /docs[/\\]node_modules[/\\]dep[/\\]README\.md/);
    assert.strictEqual(res.stdout.match(/README\.md/g).length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ignore rules do not depend on the current working directory', () => {
  const dir = makeTree({
    '.mdformatignore': 'skipped.md\n',
    'skipped.md': UNFORMATTED,
    'real.md': UNFORMATTED,
  });
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-cwd-'));
  try {
    const res = run(['--dry-run', '--tables-only', dir], { cwd: elsewhere });
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /real\.md/);
    assert.doesNotMatch(res.stdout, /skipped\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('--ignore-path rules are anchored at the target root', () => {
  const dir = makeTree({ 'sub/inner.md': UNFORMATTED, 'real.md': UNFORMATTED });
  const rules = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-rules-')),
    'rules.txt',
  );
  try {
    fs.writeFileSync(rules, '/sub\n');
    const res = run(['--dry-run', '--tables-only', '--ignore-path', rules, dir]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /real\.md/);
    assert.doesNotMatch(res.stdout, /inner\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(rules), { recursive: true, force: true });
  }
});

test('rejects a missing --ignore-path file', () => {
  const res = run(['--ignore-path', path.join(os.tmpdir(), 'no-such-file'), '.']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /cannot read --ignore-path file/);
});

test('an explicitly named target bypasses the ignore rules', () => {
  const dir = makeTree({
    '.mdformatignore': 'CHANGELOG.md\n',
    'CHANGELOG.md': UNFORMATTED,
  });
  try {
    const target = path.join(dir, 'CHANGELOG.md');
    const res = run(['--dry-run', '--tables-only', target]);
    assert.strictEqual(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /CHANGELOG\.md/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('processes .markdown files too', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdfmt-'));
  try {
    const file = path.join(dir, 'doc.markdown');
    fs.writeFileSync(file, UNFORMATTED);
    const res = run(['--check', '--tables-only', file]);
    assert.strictEqual(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stdout, /doc\.markdown/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects an unknown option with a non-zero exit', () => {
  const res = run(['--bogus', '.']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /unknown option: --bogus/);
});

test('rejects an invalid --tab-size', () => {
  const res = run(['--tab-size', 'abc', '.']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--tab-size requires a positive integer/);
});

test('rejects an --hr-length below the minimum of 3', () => {
  const res = run(['--hr-length', '2', '.']);
  assert.strictEqual(res.status, 1);
  assert.match(res.stderr, /--hr-length requires an integer >= 3/);
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
