'use strict';

const prettier = require('prettier');
const { formatMarkdownTables, findCodeFenceRanges } = require('./tableFormatter');

// ── Abbreviation-definition protection ────────────────────────────────────────

// Matches a PHP Markdown Extra / markdown-it-abbr abbreviation definition line,
// e.g. `*[HTML]: HyperText Markup Language` (leading whitespace allowed).
// Here the leading `*` is a literal part of the block syntax, NOT an emphasis marker;
// Prettier does not understand it and rewrites `*` (escaping it to `\*` or normalizing it to `_`), which breaks the syntax.
const ABBR_DEFINITION = /^\s*\*\[[^\]]+\]:/;

// HTML comments survive Prettier untouched, so each protected line is swapped for one before formatting and restored afterwards.
const ABBR_PLACEHOLDER = /<!--MDFMT_ABBR_(\d+)-->/g;

/**
 * Replace top-level abbreviation-definition lines with opaque placeholders so Prettier leaves them alone.
 * Lines inside fenced code blocks are skipped (Prettier already leaves fence content untouched).
 *
 * @param {string} text
 * @returns {{ masked: string, placeholders: string[] }}
 */
function maskAbbreviations(text) {
  // Cheap multiline pre-check so documents without any abbreviation definition skip the line-by-line scan entirely.
  if (!/^\s*\*\[[^\]]+\]:/m.test(text)) {
    return { masked: text, placeholders: [] };
  }
  const fenceRanges = findCodeFenceRanges(text);
  const inFence = (pos) => fenceRanges.some(([s, e]) => pos >= s && pos < e);

  const placeholders = [];
  const lines = text.split('\n');
  let offset = 0;
  const masked = lines
    .map((line) => {
      const lineStart = offset;
      offset += line.length + 1; // account for the '\n' separator
      if (ABBR_DEFINITION.test(line) && !inFence(lineStart)) {
        const token = `<!--MDFMT_ABBR_${placeholders.length}-->`;
        placeholders.push(line);
        return token;
      }
      return line;
    })
    .join('\n');

  return { masked, placeholders };
}

/**
 * Restore the original abbreviation-definition lines swapped out by maskAbbreviations.
 *
 * @param {string} text
 * @param {string[]} placeholders
 * @returns {string}
 */
function unmaskAbbreviations(text, placeholders) {
  if (!placeholders.length) return text;
  return text.replace(ABBR_PLACEHOLDER, (m, i) => placeholders[Number(i)] ?? m);
}

// ── Default Prettier options ──────────────────────────────────────────────────

// Applied as the floor for every document so formatting behaves consistently regardless of where the target Markdown lives.
// A target-local .prettierrc can override these.
// `embeddedLanguageFormatting: 'off'` leaves all fenced code blocks untouched
// — the only way to both preserve multi-line JSON arrays (e.g. "fields": ["*"]) and keep JS single quotes, since Prettier has no per-rule switch for embedded code.
const DEFAULT_PRETTIER_OPTIONS = {
  embeddedLanguageFormatting: 'off',
};

/**
 * Format a Markdown string through the full pipeline, returning the formatted text.
 *
 * This is the shared core used by both the CLI (src/format.js) and the VS Code
 * extension. It performs no file IO and never calls process.exit; callers handle
 * reading/writing and decide what to do with warnings via `onWarn`.
 *
 * Pipeline:
 *   ① Run Prettier first for general Markdown formatting (skipped when tablesOnly).
 *   ② Re-align tables with CJK/Emoji-aware widths (Prettier aligns by byte length,
 *      which breaks on full-width characters), overriding Prettier's tables.
 * The order must not be reversed.
 *
 * @param {string} text - the raw Markdown content
 * @param {object} [options]
 * @param {string} [options.filePath] - path used by prettier.resolveConfig to find a target-local .prettierrc
 * @param {boolean} [options.tablesOnly=false] - skip Prettier; only align tables
 * @param {boolean} [options.delimiterRowNoPadding=false]
 * @param {boolean} [options.normalizeIndentation=false]
 * @param {number}  [options.tabSize=4]
 * @param {object}  [options.widthConfig] - width config injected explicitly (shape: { doubleWidthUnicodeRanges?, narrowOverrideUnicodeRanges? }). When omitted, tableFormatter falls back to its cwd-based default config.
 * @param {(message: string) => void} [options.onWarn] - called with a human-readable warning instead of writing to console
 * @returns {Promise<string>} the formatted Markdown
 */
async function formatMarkdown(text, options = {}) {
  const {
    filePath,
    tablesOnly = false,
    delimiterRowNoPadding = false,
    normalizeIndentation = false,
    tabSize = 4,
    widthConfig,
    onWarn = () => {},
  } = options;

  let formatted = text;

  if (!tablesOnly) {
    // Shield abbreviation definitions (`*[ABBR]: …`) from Prettier, which would otherwise rewrite their literal leading `*`.
    const { masked, placeholders } = maskAbbreviations(text);

    // A target-local Prettier config may reference plugins/shared configs that aren't resolvable from here; don't let one bad config abort formatting.
    let prettierConfig = {};
    try {
      prettierConfig = (filePath ? await prettier.resolveConfig(filePath) : null) || {};
    } catch (err) {
      onWarn(
        `ignoring unresolvable Prettier config for ${filePath}: ${err.message}`,
      );
    }
    try {
      formatted = await prettier.format(masked, {
        ...DEFAULT_PRETTIER_OPTIONS,
        ...prettierConfig,
        parser: 'markdown',
      });
    } catch (err) {
      // The resolved config may pull in a plugin we can't load;
      // retry with our built-in defaults only, and if even that fails, leave it unformatted.
      onWarn(
        `Prettier failed for ${filePath ?? 'document'} (${err.message}); retrying with built-in defaults`,
      );
      try {
        formatted = await prettier.format(masked, {
          ...DEFAULT_PRETTIER_OPTIONS,
          parser: 'markdown',
        });
      } catch (err2) {
        onWarn(
          `Prettier still failed for ${filePath ?? 'document'} (${err2.message}); leaving content unformatted`,
        );
        formatted = masked;
      }
    }

    formatted = unmaskAbbreviations(formatted, placeholders);
  }

  // ② Table alignment overrides the tables produced by Prettier, using CJK visual width.
  // May throw on malformed input — callers decide how to surface it.
  formatted = formatMarkdownTables(formatted, {
    delimiterRowNoPadding,
    normalizeIndentation,
    tabSize,
    ...(widthConfig !== undefined ? { widthConfig } : {}),
  });

  return formatted;
}

module.exports = {
  formatMarkdown,
  DEFAULT_PRETTIER_OPTIONS,
};
