#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const prettier = require('prettier');
const { formatMarkdownTables } = require('./tableFormatter');
const ignore = require('ignore');

// ── Usage ────────────────────────────────────────────────────────────---------

const HELP = `\
Usage:
  md-fmt [options] <directory|file> [<directory|file> ...]

Options:
  -h, --help           Show this help message
  --dry-run            Print what would be changed without writing
  --check              Like --dry-run, but exit non-zero if any file needs formatting
  --tables-only        Only align tables; skip Prettier formatting (default: false)
  --delimiter-no-pad   Enable delimiterRowNoPadding (default: false)
  --normalize-indent   Enable normalizeIndentation (default: false)
  --tab-size <n>       Tab size for indentation normalization (default: 4)
`;

// ── Default Prettier options ──────────────────────────────────────────────────

// Applied as the floor for every file so md-fmt behaves consistently regardless of where the target Markdown lives.
// A target-local .prettierrc can override these.
// `embeddedLanguageFormatting: 'off'` leaves all fenced code blocks untouched
// — the only way to both preserve multi-line JSON arrays (e.g. "fields": ["*"]) and keep JS single quotes, since Prettier has no per-rule switch for embedded code.
const DEFAULT_PRETTIER_OPTIONS = {
  embeddedLanguageFormatting: 'off',
};

// ── Default ignore patterns ───────────────────────────────────────────────────

// Bare directory names (not `node_modules/**`):
// an unanchored gitignore pattern matches at any depth, so nested node_modules/vendor/etc. are excluded too.
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  'vendor',
  '.git',
  'dist',
  'build',
  '.cache',
];

// ── Load .mdformatignore ──────────────────────────────────────────────────────

// Build a gitignore matcher from .mdformatignore (cwd) or the built-in defaults.
// The `ignore` package implements full .gitignore semantics (anchoring, negation, comments, any-depth matching), so .mdformatignore behaves exactly like .gitignore.
function buildIgnore() {
  const ig = ignore();
  const ignoreFile = path.resolve(process.cwd(), '.mdformatignore');
  if (fs.existsSync(ignoreFile)) {
    ig.add(fs.readFileSync(ignoreFile, 'utf8'));
  } else {
    ig.add(DEFAULT_IGNORE_PATTERNS);
  }
  return ig;
}

const ig = buildIgnore();

// Match relative to the root being walked (not process.cwd()), so the ignore rules apply correctly even when the target lives elsewhere.
function isIgnored(filePath, base) {
  const rel = path.relative(base, filePath).replace(/\\/g, '/');
  return rel !== '' && ig.ignores(rel);
}

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const options = {
  dryRun: false,
  check: false,
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
    case '--check':
      options.check = true;
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
    case '--tab-size': {
      const raw = args[++i];
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || n < 1) {
        console.error(
          `error: --tab-size requires a positive integer (got ${raw ?? '<nothing>'})`,
        );
        process.exit(1);
      }
      options.tabSize = n;
      break;
    }
    default:
      if (args[i].startsWith('-')) {
        console.error(`error: unknown option: ${args[i]}`);
        console.error(HELP);
        process.exit(1);
      }
      targets.push(args[i]);
  }
}

if (targets.length === 0) {
  console.error(
    'Usage: md-fmt [--dry-run] [--check] [--tables-only] [--delimiter-no-pad] [--normalize-indent] [--tab-size <n>] <path> [<path> ...]',
  );
  process.exit(1);
}

// ── Collect .md files ─────────────────────────────────────────────────────────

const visitedDirs = new Set();

function collectMdFiles(target, root = null) {
  const resolved = path.resolve(target);
  const isRoot = root === null;
  const base = root ?? resolved; // ignore-pattern base = the top-level target
  if (!isRoot && isIgnored(resolved, base)) return [];
  // throwIfNoEntry: false returns undefined instead of throwing on ENOENT, which covers dangling symlinks (statSync follows the link and the target is missing).
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    if (isRoot) console.error(`warning: path not found, skipping: ${target}`);
    return [];
  }
  if (stat.isFile()) {
    return /\.(md|markdown)$/i.test(resolved) ? [resolved] : [];
  }
  if (stat.isDirectory()) {
    // Guard against symlink cycles: resolve to the real path and skip if already walked, so a link pointing back at an ancestor can't recurse forever.
    let real = resolved;
    try {
      real = fs.realpathSync(resolved);
    } catch {
      // keep `resolved` if the real path can't be determined
    }
    if (visitedDirs.has(real)) return [];
    visitedDirs.add(real);

    let entries;
    try {
      entries = fs.readdirSync(resolved);
    } catch (err) {
      console.error(`warning: cannot read directory ${resolved}: ${err.message}`);
      return [];
    }
    return entries.flatMap((name) =>
      collectMdFiles(path.join(resolved, name), base),
    );
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
let errored = 0;
const preview = options.dryRun || options.check; // neither mode writes files

(async () => {
  for (const file of files) {
    let original;
    try {
      original = fs.readFileSync(file, 'utf8');
    } catch (err) {
      errored++;
      console.error(`warning: cannot read ${file}: ${err.message}`);
      continue;
    }

    // ① Run Prettier first for general Markdown formatting, then ② re-align tables with CJK/Emoji-aware widths (Prettier's table widths are byte-based and break on full-width characters).
    // --tables-only skips step ①.
    let formatted = original;
    if (!options.tablesOnly) {
      // A target-local Prettier config may reference plugins/shared configs that aren't resolvable from here; don't let one bad config abort the whole run.
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
        // The resolved config may pull in a plugin we can't load;
        // retry with our built-in defaults only, and if even that fails, leave it unformatted.
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
    try {
      formatted = formatMarkdownTables(formatted, options);
    } catch (err) {
      errored++;
      console.error(`warning: failed to format ${file}: ${err.message}`);
      continue;
    }

    if (formatted === original) {
      unchanged++;
      continue;
    }

    if (preview) {
      changed++;
      console.log(
        `[${options.check ? 'check' : 'dry-run'}] would format: ${file}`,
      );
    } else {
      try {
        fs.writeFileSync(file, formatted, 'utf8');
        changed++;
        console.log(`formatted: ${file}`);
      } catch (err) {
        errored++;
        console.error(`warning: cannot write ${file}: ${err.message}`);
      }
    }
  }

  const errSuffix = errored ? ` ${errored} error(s).` : '';
  if (preview) {
    console.log(
      `\nDone. ${changed} file(s) would be formatted, ${unchanged} file(s) already up-to-date.${errSuffix}`,
    );
  } else {
    console.log(
      `\nDone. ${changed} file(s) changed, ${unchanged} file(s) unchanged.${errSuffix}`,
    );
  }

  // Non-zero exit for CI: --check found drift, or some file could not be processed.
  if (errored > 0 || (options.check && changed > 0)) {
    process.exitCode = 1;
  }
})();
