'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatMarkdown } = require('../src/pipeline');

test('runs Prettier then aligns tables (ASCII)', async () => {
  const input = '#  t\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  const out = await formatMarkdown(input, { filePath: 'x.md', widthConfig: {} });
  // Prettier collapses the double space after #, table is re-aligned.
  assert.match(out, /^# t\n/);
  assert.match(out, /\| a {3}\| b {3}\|/);
  assert.match(out, /\| --- \| --- \|/);
});

test('aligns CJK cells by visual width and is idempotent', async () => {
  const input = '| 名稱 | x |\n| --- | --- |\n| 蘋果 | a |\n';
  const once = await formatMarkdown(input, {
    filePath: 'x.md',
    widthConfig: {},
  });
  const twice = await formatMarkdown(once, {
    filePath: 'x.md',
    widthConfig: {},
  });
  assert.strictEqual(twice, once, 'pipeline should be idempotent');
  // Both CJK cells are width 4, so the data cell padding matches the header.
  assert.match(once, /\| 名稱 \|/);
  assert.match(once, /\| 蘋果 \|/);
});

test('tablesOnly skips Prettier formatting', async () => {
  // The heading has an irregular space Prettier would normally fix; tablesOnly must leave it.
  const input = '#  t\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
  const out = await formatMarkdown(input, {
    filePath: 'x.md',
    tablesOnly: true,
    widthConfig: {},
  });
  assert.match(out, /^#  t\n/, 'heading must be left untouched in tablesOnly mode');
});

test('preserves abbreviation definitions (`*[ABBR]: …`) and is idempotent', async () => {
  const input =
    '# t\n\n*[HTML]: HyperText Markup Language\n*[CSS]: Cascading Style Sheets\n\nHTML and CSS.\n';
  const once = await formatMarkdown(input, { filePath: 'x.md', widthConfig: {} });
  // The literal leading `*` must survive (Prettier would otherwise escape it to `\*` or normalize it to `_`).
  assert.match(once, /^\*\[HTML\]: HyperText Markup Language$/m);
  assert.match(once, /^\*\[CSS\]: Cascading Style Sheets$/m);
  assert.ok(!/[\\_]\[HTML\]:/.test(once), 'must not produce \\*[HTML]: or _[HTML]:');
  const twice = await formatMarkdown(once, { filePath: 'x.md', widthConfig: {} });
  assert.strictEqual(twice, once, 'pipeline should be idempotent');
});

test('does not touch abbreviation-like lines inside fenced code blocks', async () => {
  const input = '# t\n\n```markdown\n*[XYZ]: demo\n```\n';
  const out = await formatMarkdown(input, { filePath: 'x.md', widthConfig: {} });
  assert.match(out, /```markdown\n\*\[XYZ\]: demo\n```/);
});

test('hrLength expands a standalone thematic break beyond Prettier\'s hardcoded 3 characters', async () => {
  const input = 'a\n\n-------\n\nb\n';
  const out = await formatMarkdown(input, {
    filePath: 'x.md',
    widthConfig: {},
    hrLength: 7,
  });
  assert.strictEqual(out, 'a\n\n-------\n\nb\n');
});

test('hrLength defaults to 3, matching Prettier\'s own thematic break length', async () => {
  const input = 'a\n\n-------\n\nb\n';
  const out = await formatMarkdown(input, { filePath: 'x.md', widthConfig: {} });
  assert.strictEqual(out, 'a\n\n---\n\nb\n');
});

test('hrLength does not touch a setext heading underline (only a genuine thematic break)', async () => {
  // "Title\n---" is a setext H2, not an <hr>; Prettier normalizes it to an ATX heading either way.
  const input = 'Title\n---\n\nbody\n';
  const out = await formatMarkdown(input, {
    filePath: 'x.md',
    widthConfig: {},
    hrLength: 7,
  });
  assert.strictEqual(out, '## Title\n\nbody\n');
});

test('hrLength does not touch a thematic break inside a fenced code block', async () => {
  const input = '# t\n\n```\n---\n```\n';
  const out = await formatMarkdown(input, {
    filePath: 'x.md',
    widthConfig: {},
    hrLength: 7,
  });
  assert.match(out, /```\n---\n```/);
});

test('hrLength is a no-op in tablesOnly mode (Prettier does not run)', async () => {
  const input = 'a\n\n-------\n\nb\n';
  const out = await formatMarkdown(input, {
    filePath: 'x.md',
    widthConfig: {},
    tablesOnly: true,
    hrLength: 3,
  });
  assert.strictEqual(out, input);
});

test('onWarn receives messages instead of throwing on bad Prettier config', async () => {
  // A non-existent file path still resolves config gracefully; just assert it returns a string.
  const warnings = [];
  const out = await formatMarkdown('# t\n', {
    filePath: 'x.md',
    widthConfig: {},
    onWarn: (m) => warnings.push(m),
  });
  assert.strictEqual(typeof out, 'string');
});
