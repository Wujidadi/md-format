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

// Match ignore patterns relative to the root being walked (not process.cwd()),
// so node_modules/vendor/etc. are excluded even when the target lives elsewhere.
function isIgnored(filePath, base) {
  const rel = path.relative(base, filePath).replace(/\\/g, '/');
  const opts = { dot: true, matchBase: false };
  return ignorePatterns.some((pattern) => {
    if (minimatch(rel, pattern, opts)) return true;
    // Also match the pattern at any depth (gitignore-style), so an unanchored
    // pattern like `node_modules/**` also excludes nested `resources/v3/node_modules/**`.
    if (!pattern.startsWith('/') && !pattern.startsWith('**/')) {
      return minimatch(rel, `**/${pattern}`, opts);
    }
    return false;
  });
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

function collectMdFiles(target, root = null) {
  const resolved = path.resolve(target);
  const isRoot = root === null;
  const base = root ?? resolved; // ignore-pattern base = the top-level target
  if (!isRoot && isIgnored(resolved, base)) return [];
  // throwIfNoEntry: false returns undefined instead of throwing on ENOENT, which
  // covers dangling symlinks (statSync follows the link and the target is missing).
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    if (isRoot) console.error(`warning: path not found, skipping: ${target}`);
    return [];
  }
  if (stat.isFile()) {
    return resolved.endsWith('.md') ? [resolved] : [];
  }
  if (stat.isDirectory()) {
    return fs
      .readdirSync(resolved)
      .flatMap((name) => collectMdFiles(path.join(resolved, name), base));
  }
  return [];
}

const files = targets.flatMap((t) => collectMdFiles(t));

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
      // A target-local Prettier config may reference plugins/shared configs that
      // aren't resolvable from here; don't let one bad config abort the whole run.
      let prettierConfig = {};
      try {
        prettierConfig = (await prettier.resolveConfig(file)) || {};
      } catch (err) {
        console.error(
          `warning: ignoring unresolvable Prettier config for ${file}: ${err.message}`,
        );
      }
      try {
        formatted = await prettier.format(original, {
          ...DEFAULT_PRETTIER_OPTIONS,
          ...prettierConfig,
          parser: 'markdown',
        });
      } catch (err) {
        // The resolved config may pull in a plugin we can't load; retry with our
        // built-in defaults only, and if even that fails, leave it unformatted.
        console.error(
          `warning: Prettier failed for ${file} (${err.message}); retrying with built-in defaults`,
        );
        try {
          formatted = await prettier.format(original, {
            ...DEFAULT_PRETTIER_OPTIONS,
            parser: 'markdown',
          });
        } catch (err2) {
          console.error(
            `warning: Prettier still failed for ${file} (${err2.message}); leaving content unformatted`,
          );
        }
      }
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
