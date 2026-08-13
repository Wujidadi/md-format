#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { formatMarkdown } = require('./pipeline');
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
  --hr-length <n>      Length of standalone thematic breaks (<hr>, e.g. "---"); min 3 (default: 3)
  --ignore-path <file> Extra .mdformatignore-style rules, applied to every target root
`;

// ── Ignore rules ──────────────────────────────────────────────────────────────

const IGNORE_FILE_NAME = '.mdformatignore';

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

// A layer pairs one rule set with the directory its patterns are relative to; layers stack as the walk descends, exactly like nested .gitignore files.
// The `ignore` package implements full .gitignore semantics (anchoring, negation, comments, any-depth matching), so .mdformatignore behaves exactly like .gitignore.
// `sets` is kept so that two rule sets belonging to the same directory can be rebuilt as one matcher (see mergeLayer).
function makeLayer(dir, ...sets) {
  // `.add` splits on newlines only for a string argument, so file contents and pattern arrays must be added separately rather than concatenated into one array.
  return { dir, sets, ig: sets.reduce((acc, set) => acc.add(set), ignore()) };
}

// Rules declared for the same directory must live in a single matcher, so that gitignore's own last-match-wins ordering resolves them — that is what lets `!node_modules` in a target's own .mdformatignore undo a built-in default for the whole subtree.
function mergeLayer(layer, ...sets) {
  return makeLayer(layer.dir, ...layer.sets, ...sets);
}

// Read the .mdformatignore of a single directory, if it has one.
function readIgnoreFile(dir) {
  const file = path.join(dir, IGNORE_FILE_NAME);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`warning: cannot read ${file}: ${err.message}`);
    }
    return null;
  }
}

// Each layer matches against the path relative to its own directory, which is what makes an anchored pattern (`/docs`) mean "relative to the file that declared it".
// A trailing-slash pattern (`dist/`) only matches directories, so directories are probed with a trailing slash.
// Layers are evaluated outermost-first and the last decisive match wins (`ignores()` cannot express that, hence `test()`), so a nested file's negation re-includes what an outer layer excluded, as in git.
// `inherited[i]` holds the pattern by which layer i matched an ancestor directory that was re-included anyway: the same pattern matching a descendant is only that pattern's directory coverage, which the walk already handles by pruning, so honouring it would re-exclude a subtree git considers included.
function classify(filePath, isDir, layers, inherited) {
  let ignored = false;
  const matched = layers.map(() => null);
  layers.forEach((layer, i) => {
    const rel = path.relative(layer.dir, filePath).replace(/\\/g, '/');
    if (rel === '' || rel.startsWith('../')) return;
    const verdict = layer.ig.test(isDir ? `${rel}/` : rel);
    if (verdict.ignored) {
      if (verdict.rule?.pattern === inherited[i]) return;
      matched[i] = verdict.rule?.pattern ?? null;
      ignored = true;
    } else if (verdict.unignored) {
      ignored = false;
    }
  });
  // Every pattern recorded in `matched` was overruled by a later layer, since the path is included despite having matched: carry it down so it does not re-exclude anything below.
  return {
    ignored,
    inherited: matched.map((pattern, i) => pattern ?? inherited[i]),
  };
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
  hrLength: 3,
  ignorePath: null,
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
    case '--hr-length': {
      const raw = args[++i];
      const n = parseInt(raw, 10);
      if (Number.isNaN(n) || n < 3) {
        console.error(
          `error: --hr-length requires an integer >= 3 (got ${raw ?? '<nothing>'})`,
        );
        process.exit(1);
      }
      options.hrLength = n;
      break;
    }
    case '--ignore-path': {
      const raw = args[++i];
      if (!raw || raw.startsWith('-')) {
        console.error(
          `error: --ignore-path requires a file path (got ${raw ?? '<nothing>'})`,
        );
        process.exit(1);
      }
      options.ignorePath = raw;
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
    'Usage: md-fmt [--dry-run] [--check] [--tables-only] [--delimiter-no-pad] [--normalize-indent] [--tab-size <n>] [--hr-length <n>] [--ignore-path <file>] <path> [<path> ...]',
  );
  process.exit(1);
}

// ── Collect .md files ─────────────────────────────────────────────────────────

// --ignore-path rules are anchored at each target root rather than at the file that declares them, so one shared ignore file can be reused across unrelated targets.
let extraIgnorePatterns = null;
if (options.ignorePath !== null) {
  try {
    extraIgnorePatterns = fs.readFileSync(options.ignorePath, 'utf8');
  } catch (err) {
    console.error(`error: cannot read --ignore-path file: ${err.message}`);
    process.exit(1);
  }
}

const visitedDirs = new Set();

const isMarkdown = (filePath) => /\.(md|markdown)$/i.test(filePath);

function walkDir(dir, layers, inherited) {
  // Guard against symlink cycles: resolve to the real path and skip if already walked, so a link pointing back at an ancestor can't recurse forever.
  let real = dir;
  try {
    real = fs.realpathSync(dir);
  } catch {
    // keep `dir` if the real path can't be determined
  }
  if (visitedDirs.has(real)) return [];
  visitedDirs.add(real);

  // A .mdformatignore here governs this directory and everything below it, just like a nested .gitignore.
  // At the target root the incoming layer already describes this same directory, so its rules are merged into it rather than stacked on top.
  let scoped = layers;
  let scopedInherited = inherited;
  const local = readIgnoreFile(dir);
  if (local !== null) {
    const innermost = layers[layers.length - 1];
    if (innermost.dir === dir) {
      scoped = [...layers.slice(0, -1), mergeLayer(innermost, local)];
    } else {
      scoped = [...layers, makeLayer(dir, local)];
      scopedInherited = [...inherited, null];
    }
  }

  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    console.error(`warning: cannot read directory ${dir}: ${err.message}`);
    return [];
  }

  const found = [];
  for (const name of entries) {
    const entry = path.join(dir, name);
    // throwIfNoEntry: false returns undefined instead of throwing on ENOENT, which covers dangling symlinks (statSync follows the link and the target is missing).
    const stat = fs.statSync(entry, { throwIfNoEntry: false });
    if (!stat) continue;
    const isDir = stat.isDirectory();
    const verdict = classify(entry, isDir, scoped, scopedInherited);
    if (verdict.ignored) continue;
    if (isDir) found.push(...walkDir(entry, scoped, verdict.inherited));
    else if (stat.isFile() && isMarkdown(entry)) found.push(entry);
  }
  return found;
}

// A target named on the command line is never tested against the ignore rules: naming a path is an explicit intent that outranks them, which is the escape hatch for formatting an otherwise-excluded file.
function collectMdFiles(target) {
  const resolved = path.resolve(target);
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    console.error(`warning: path not found, skipping: ${target}`);
    return [];
  }
  if (stat.isFile()) return isMarkdown(resolved) ? [resolved] : [];
  if (!stat.isDirectory()) return [];
  // The built-in defaults are the bottom layer of every walk, so a .mdformatignore adds to them instead of replacing them; a negation (e.g. `!node_modules`) undoes one.
  const rootSets = [DEFAULT_IGNORE_PATTERNS];
  if (extraIgnorePatterns !== null) rootSets.push(extraIgnorePatterns);
  return walkDir(resolved, [makeLayer(resolved, ...rootSets)], [null]);
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

    // Run the shared "Prettier → CJK-aware table alignment" pipeline.
    // The CLI passes no widthConfig, so tableFormatter falls back to its cwd-based default config (mdformat.config.js) — preserving the long-standing CLI behavior.
    let formatted;
    try {
      formatted = await formatMarkdown(original, {
        filePath: file,
        tablesOnly: options.tablesOnly,
        delimiterRowNoPadding: options.delimiterRowNoPadding,
        normalizeIndentation: options.normalizeIndentation,
        tabSize: options.tabSize,
        hrLength: options.hrLength,
        onWarn: (msg) => console.error(`warning: ${msg}`),
      });
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
