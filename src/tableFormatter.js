'use strict';

// Ported from yzhang-gh/vscode-markdown tableFormatter.ts
// https://github.com/yzhang-gh/vscode-markdown/blob/master/src/tableFormatter.ts
// License: MIT

const fs = require('fs');
const path = require('path');

const GraphemeSplitter = require('grapheme-splitter');
const splitter = new GraphemeSplitter();

const ColumnAlignment = {
  None: 0,
  Left: 1,
  Center: 2,
  Right: 3,
};

// Config

function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'mdformat.config.js');
  if (fs.existsSync(configPath)) {
    try {
      return require(configPath);
    } catch {
      // ignore malformed config
    }
  }
  return {};
}

const config = loadConfig();

// Double-width character ranges (Emoji + CJK)

const DEFAULT_DOUBLE_WIDTH_RANGES = [
  '\u2014-\u2015', // Em Dash, horizontal bar
  '\u2024-\u2026', // One Dot Leader, Two Dot Leader, Horizontal Ellipsis
  '\u2030-\u2031', // Per Mille Sign, Per Ten Thousand Sign
  '\u203b', // Reference Mark
  '\u2190-\u2193', // Arrows (←, ↑, →, ↓)
  '\u25a0-\u25ff', // Geometric Shapes
  '\u2600-\u26ff', // Miscellaneous Symbols
  '\u2713', // Check Mark
  '\u2717', // Ballot X
  '\u2e80-\u2eff', // CJK Radicals Supplement
  '\u2f00-\u2fdf', // Kangxi Radicals
  '\u3000-\u9fff', // CJK Unified Ideographs
  '\uac00-\ud7af', // Hangul Syllables
  '\uf900-\ufaff', // CJK Compatibility Ideographs
  '\ufe30-\ufe4f', // CJK Compatibility Forms
  '\ufe50-\ufe6f', // Small Form Variants
  '\uff01-\uff60', // Fullwidth ASCII variants
];

// Narrow override: Extended_Pictographic characters that appear narrow in some fonts
const DEFAULT_NARROW_OVERRIDE_RANGES = [
  '\u2122', // ™ Trade Mark Sign
  '\u2139', // ℹ Information Source
];

const doubleWidthUnicodeRanges = (
  config.doubleWidthUnicodeRanges ?? DEFAULT_DOUBLE_WIDTH_RANGES
).join('');

const narrowOverrideUnicodeRanges = (
  config.narrowOverrideUnicodeRanges ?? DEFAULT_NARROW_OVERRIDE_RANGES
).join('');

const doubleWidthRegex = new RegExp(
  `[\\p{Extended_Pictographic}${doubleWidthUnicodeRanges}]`,
  'gu',
);

const narrowOverrideRegex = new RegExp(
  `[${narrowOverrideUnicodeRanges}]`,
  'gu',
);

/**
 * Calculate visual width of a string (CJK/Emoji = 2, others = 1)
 */
function visualWidth(str) {
  const graphemeCount = splitter.countGraphemes(str);
  const doubleWidthChars = str.match(doubleWidthRegex);
  const narrowOverrideChars = str.match(narrowOverrideRegex);
  return (
    graphemeCount +
    (doubleWidthChars ? doubleWidthChars.length : 0) -
    (narrowOverrideChars ? narrowOverrideChars.length : 0)
  );
}

/**
 * Pad a string to the target visual width with spaces (left-aligned by default)
 */
function padCell(cell, targetWidth, align) {
  const w = visualWidth(cell);
  const pad = targetWidth - w;
  if (pad <= 0) return cell;
  switch (align) {
    case ColumnAlignment.Right:
      return ' '.repeat(pad) + cell;
    case ColumnAlignment.Center: {
      const left = Math.floor(pad / 2);
      const right = pad - left;
      return ' '.repeat(left) + cell + ' '.repeat(right);
    }
    default: // Left / None
      return cell + ' '.repeat(pad);
  }
}

/**
 * Detect all Markdown tables in a text string.
 * Returns array of { text, index }
 */
function detectTables(text) {
  const lineBreak = String.raw`\r?\n`;
  const contentLine = String.raw`\|?.*\|.*\|?`;
  const leftSideHyphenComponent = String.raw`(?:\|? *:?-+:? *\|)`;
  const middleHyphenComponent = String.raw`(?: *:?-+:? *\|)*`;
  const rightSideHyphenComponent = String.raw`(?: *:?-+:? *\|?)`;
  const multiColumnHyphenLine =
    leftSideHyphenComponent + middleHyphenComponent + rightSideHyphenComponent;
  const singleColumnHyphenLine = String.raw`(?:\| *:?-+:? *\|)`;
  const hyphenLine = String.raw`[ \t]*(?:${multiColumnHyphenLine}|${singleColumnHyphenLine})[ \t]*`;
  const tableRegex = new RegExp(
    contentLine +
      lineBreak +
      hyphenLine +
      '(?:' +
      lineBreak +
      contentLine +
      ')*',
    'g',
  );

  const results = [];
  for (const match of text.matchAll(tableRegex)) {
    results.push({ text: match[0], index: match.index });
  }
  return results;
}

/**
 * Format a single Markdown table string.
 * @param {string} tableText - raw table text
 * @param {object} options
 * @param {boolean} [options.delimiterRowNoPadding=false] - match markdown.extension.tableFormatter.delimiterRowNoPadding
 * @param {boolean} [options.normalizeIndentation=false]  - match markdown.extension.tableFormatter.normalizeIndentation
 * @param {number}  [options.tabSize=4]
 * @returns {string}
 */
function formatTable(tableText, options = {}) {
  const {
    delimiterRowNoPadding = false,
    normalizeIndentation = false,
    tabSize = 4,
  } = options;

  // NFC normalize
  const text = tableText.normalize();

  // Get indentation from first line
  const indentMatch = text.match(/^(\s*)\S/u);
  let spacesInFirstLine = indentMatch ? indentMatch[1].length : 0;
  let indentation;
  if (normalizeIndentation) {
    const tabStops = Math.round(spacesInFirstLine / tabSize);
    indentation = ' '.repeat(tabSize * tabStops);
  } else {
    indentation = ' '.repeat(spacesInFirstLine);
  }

  const delimiterRowIndex = 1;

  // Extract rows (strip leading indentation)
  const rowsNoIndentPattern = /^\s*(\S.*)$/gmu;
  const rows = Array.from(text.matchAll(rowsNoIndentPattern), (m) =>
    m[1].trim(),
  );

  const colWidth = [];
  const colAlign = [];
  const fieldRegExp = /((\\\||[^\|])*)\|/gu;

  // First pass: parse cells and calculate column widths
  const lines = rows.map((row, iRow) => {
    if (row.startsWith('|')) row = row.slice(1);
    if (!row.endsWith('|')) row = row + '|';

    const values = [];
    let iCol = 0;
    for (const field of row.matchAll(fieldRegExp)) {
      const cell = field[1].trim();
      values.push(cell);
      if (iRow === delimiterRowIndex) {
        iCol++;
        continue;
      }
      const w = visualWidth(cell);
      colWidth[iCol] = Math.max(colWidth[iCol] || 0, w);
      iCol++;
    }
    return values;
  });

  // Normalize delimiter row
  lines[delimiterRowIndex] = lines[delimiterRowIndex].map((cell, iCol) => {
    if (/:-+:/.test(cell)) {
      colAlign[iCol] = ColumnAlignment.Center;
      colWidth[iCol] = Math.max(colWidth[iCol] || 0, 3);
      const specWidth = delimiterRowNoPadding
        ? colWidth[iCol] + 2
        : colWidth[iCol];
      return ':' + '-'.repeat(specWidth - 2) + ':';
    } else if (/:-+/.test(cell)) {
      colAlign[iCol] = ColumnAlignment.Left;
      colWidth[iCol] = Math.max(colWidth[iCol] || 0, 3);
      const specWidth = delimiterRowNoPadding
        ? colWidth[iCol] + 2
        : colWidth[iCol];
      return ':' + '-'.repeat(specWidth - 1);
    } else if (/-+:/.test(cell)) {
      colAlign[iCol] = ColumnAlignment.Right;
      colWidth[iCol] = Math.max(colWidth[iCol] || 0, 3);
      const specWidth = delimiterRowNoPadding
        ? colWidth[iCol] + 2
        : colWidth[iCol];
      return '-'.repeat(specWidth - 1) + ':';
    } else {
      colAlign[iCol] = ColumnAlignment.None;
      colWidth[iCol] = Math.max(colWidth[iCol] || 0, 3);
      const specWidth = delimiterRowNoPadding
        ? colWidth[iCol] + 2
        : colWidth[iCol];
      return '-'.repeat(specWidth);
    }
  });

  // Second pass: build formatted rows
  return lines
    .map((values, iRow) => {
      const cells = values.map((cell, iCol) => {
        if (iRow === delimiterRowIndex) {
          // Delimiter row: pad with hyphens, no space padding
          if (delimiterRowNoPadding) return cell;
          const w = cell.length;
          const target = colWidth[iCol];
          if (w >= target) return cell;
          // Extend hyphens to fill
          if (/:-+:/.test(cell)) return ':' + '-'.repeat(target - 2) + ':';
          if (/:-+/.test(cell)) return ':' + '-'.repeat(target - 1);
          if (/-+:/.test(cell)) return '-'.repeat(target - 1) + ':';
          return '-'.repeat(target);
        }
        return padCell(
          cell,
          colWidth[iCol] || 0,
          colAlign[iCol] ?? ColumnAlignment.None,
        );
      });
      return indentation + '| ' + cells.join(' | ') + ' |';
    })
    .join('\n');
}

/**
 * Format all tables in a Markdown document string.
 * Non-table content is preserved as-is.
 */
function formatMarkdownTables(content, options = {}) {
  const tables = detectTables(content);
  if (tables.length === 0) return content;

  let result = '';
  let lastIndex = 0;

  for (const table of tables) {
    result += content.slice(lastIndex, table.index);
    result += formatTable(table.text, options);
    lastIndex = table.index + table.text.length;
  }
  result += content.slice(lastIndex);
  return result;
}

module.exports = { formatMarkdownTables, formatTable, detectTables };
