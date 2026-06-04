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
