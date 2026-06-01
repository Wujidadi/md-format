#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const prettier = require('prettier');
const { formatMarkdownTables } = require('./tableFormatter');
const { minimatch } = require('minimatch');

// ── Usage ────────────────────────────────────────────────────────────---------

const HELP = `\
Usage:
  md-fmt [options] <directory|file> [<directory|file> ...]

Options:
  -h, --help           Show this help message
  --dry-run            Print what would be changed without writing
  --tables-only        Only align tables; skip Prettier formatting (default: false)
  --delimiter-no-pad   Enable delimiterRowNoPadding (default: false)
  --normalize-indent   Enable normalizeIndentation (default: false)
  --tab-size <n>       Tab size for indentation normalization (default: 4)
`;

// ── Default Prettier options ──────────────────────────────────────────────────

// Applied as the floor for every file so md-fmt behaves consistently regardless
// of where the target Markdown lives. A target-local .prettierrc can override these.
// `embeddedLanguageFormatting: 'off'` leaves all fenced code blocks untouched — the
// only way to both preserve multi-line JSON arrays (e.g. "fields": ["*"]) and keep
// JS single quotes, since Prettier has no per-rule switch for embedded code.
const DEFAULT_PRETTIER_OPTIONS = {
  embeddedLanguageFormatting: 'off',
};

// ── Default ignore patterns ───────────────────────────────────────────────────

const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/**',
  'vendor/**',
  '.git/**',
  'dist/**',
  'build/**',
  '.cache/**',
];

// ── Load .mdformatignore ──────────────────────────────────────────────────────

function loadIgnorePatterns() {
  const ignoreFile = path.resolve(process.cwd(), '.mdformatignore');
  if (fs.existsSync(ignoreFile)) {
    return fs
      .readFileSync(ignoreFile, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
  }
  return DEFAULT_IGNORE_PATTERNS;
}

const ignorePatterns = loadIgnorePatterns();

function isIgnored(filePath) {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  return ignorePatterns.some((pattern) =>
    minimatch(rel, pattern, { dot: true, matchBase: false }),
  );
}

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const options = {
  dryRun: false,
  tablesOnly: false,
  delimiterRowNoPadding: false,
  normalizeIndentation: false,
  tabSize: 4,
};
const targets = [];

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '-h':
    case '--help':
      console.log(HELP);
      process.exit(0);
      break;
    case '-d':
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--tables-only':
      options.tablesOnly = true;
      break;
    case '--delimiter-no-pad':
      options.delimiterRowNoPadding = true;
      break;
    case '--normalize-indent':
      options.normalizeIndentation = true;
      break;
    case '--tab-size':
      options.tabSize = parseInt(args[++i], 10);
      break;
    default:
      targets.push(args[i]);
  }
}

if (targets.length === 0) {
  console.error(
    'Usage: md-fmt [--dry-run] [--tables-only] [--delimiter-no-pad] [--normalize-indent] [--tab-size <n>] <path> [<path> ...]',
  );
  process.exit(1);
}

// ── Collect .md files ─────────────────────────────────────────────────────────

function collectMdFiles(target, isRoot = false) {
  const resolved = path.resolve(target);
  if (!isRoot && isIgnored(resolved)) return [];
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return resolved.endsWith('.md') ? [resolved] : [];
  }
  if (stat.isDirectory()) {
    return fs
      .readdirSync(resolved)
      .flatMap((name) => collectMdFiles(path.join(resolved, name)));
  }
  return [];
}

const files = targets.flatMap((t) => collectMdFiles(t, true));

if (files.length === 0) {
  console.log('No .md files found.');
  process.exit(0);
}

// ── Process files ─────────────────────────────────────────────────────────────

let changed = 0;
let unchanged = 0;

(async () => {
  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');

    // ① Run Prettier first for general Markdown formatting, then ② re-align
    // tables with CJK/Emoji-aware widths (Prettier's table widths are byte-based
    // and break on full-width characters). --tables-only skips step ①.
    let formatted = original;
    if (!options.tablesOnly) {
      const prettierConfig = (await prettier.resolveConfig(file)) || {};
      formatted = await prettier.format(formatted, {
        ...DEFAULT_PRETTIER_OPTIONS,
        ...prettierConfig,
        parser: 'markdown',
      });
    }
    formatted = formatMarkdownTables(formatted, options);

    if (formatted === original) {
      unchanged++;
      continue;
    }

    changed++;
    if (options.dryRun) {
      console.log(`[dry-run] would format: ${file}`);
    } else {
      fs.writeFileSync(file, formatted, 'utf8');
      console.log(`formatted: ${file}`);
    }
  }

  if (options.dryRun) {
    console.log(
      `\nDone. ${changed} file(s) would be formatted, ${unchanged} file(s) already up-to-date.`,
    );
  } else {
    console.log(
      `\nDone. ${changed} file(s) changed, ${unchanged} file(s) unchanged.`,
    );
  }
})();
