'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { formatMarkdownTables, detectTables } = require('../src/tableFormatter');

// NOTE: tableFormatter loads mdformat.config.js from cwd at module-load time,
// so these tests assume they are run from the project root (npm test does this).

test('aligns a simple ASCII table', () => {
  assert.strictEqual(
    formatMarkdownTables('| a | b |\n|---|---|\n| 1 | 2 |\n'),
    '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n',
  );
});

test('pads CJK cells to their visual width (full-width = 2)', () => {
  assert.strictEqual(
    formatMarkdownTables('| 名稱 | x |\n|---|---|\n| 中文字 | y |\n'),
    '| 名稱   | x   |\n| ------ | --- |\n| 中文字 | y   |\n',
  );
});

test('honours left/center/right alignment markers', () => {
  assert.strictEqual(
    formatMarkdownTables('| L | C | R |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n'),
    '| L   |  C  |   R |\n| :-- | :-: | --: |\n| 1   |  2  |   3 |\n',
  );
});

test('preserves content outside tables', () => {
  assert.strictEqual(
    formatMarkdownTables('前言\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n後語\n'),
    '前言\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n後語\n',
  );
});

test('is idempotent (formatting an already-formatted table is a no-op)', () => {
  const input = '前言\n\n| 名稱 | x |\n|:--|--:|\n| 中文字 | y |\n\n後語\n';
  const once = formatMarkdownTables(input);
  const twice = formatMarkdownTables(once);
  assert.strictEqual(twice, once);
});

test('returns content unchanged when there is no table', () => {
  const input = '# 標題\n\n一段沒有表格的文字。\n';
  assert.strictEqual(formatMarkdownTables(input), input);
});

// ── A1: code-fence awareness ──────────────────────────────────────────────────

test('does NOT reformat a table inside a fenced code block', () => {
  const input = [
    '```',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '```',
    '',
    '| x | y |',
    '|---|---|',
    '| 1 | 2 |',
    '',
  ].join('\n');
  const expected = [
    '```', // code block preserved byte-for-byte
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '```',
    '',
    '| x   | y   |', // real table after the fence is still formatted
    '| --- | --- |',
    '| 1   | 2   |',
    '',
  ].join('\n');
  assert.strictEqual(formatMarkdownTables(input), expected);
});

test('does NOT reformat a table inside a tilde-fenced code block with info string', () => {
  const input = ['~~~markdown', '| a | b |', '|---|---|', '| 1 | 2 |', '~~~', ''].join(
    '\n',
  );
  assert.strictEqual(formatMarkdownTables(input), input);
});

test('detectTables does not pick up tables inside fenced code blocks', () => {
  const input = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n';
  assert.strictEqual(detectTables(input).length, 0);
});
