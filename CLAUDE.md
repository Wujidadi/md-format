# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`md-format` is a CLI tool that recursively formats Markdown files. The pipeline has two steps:

1. First run **Prettier** for general Markdown formatting (headings, lists, blank lines, etc.).
2. Then **re-align tables** using an algorithm ported from [yzhang.markdown-all-in-one](https://github.com/yzhang-gh/vscode-markdown)'s `tableFormatter.ts`, correctly handling the "visual width" of CJK and Emoji characters (full-width = 2, half-width = 1) — precisely what Prettier's byte-length-based alignment gets wrong.

`--tables-only` skips step 1 (Prettier) and performs table alignment alone.

## Development Commands

This project has no linter or build step.

```sh
npm install            # install dependencies
npm link               # makes the md-fmt command available globally (note: the bin name is md-fmt, not md-format)

npm test               # run the test suite (node:test); runnable from any cwd
node --test test/tableFormatter.test.js   # run a single test file

# Run directly (without link)
node src/format.js [options] <path> [<path> ...]

# Preview changes without writing
node src/format.js --dry-run ./check-table.md
```

Tests live in `test/` and use Node's built-in test runner (no extra deps).
They lock the current correct alignment output (ASCII/CJK/alignment markers/idempotency) plus code-fence awareness, so they double as regression snapshots.
`check-table.md` is an additional manual fixture in the project root containing assorted CJK/Emoji/symbol tables.

## Architecture

The formatting core is shared between a CLI and a VS Code extension, with clearly separated responsibilities:

- **`src/tableFormatter.js`** — table alignment logic, exporting `formatMarkdownTables`, `formatTable`, `detectTables`, and `buildWidthMatchers`.
- **`src/pipeline.js`** — the shared, pure "Prettier → table alignment" pipeline, exporting `formatMarkdown(text, options)`. **No file IO, no `process.exit`.** Both the CLI and the extension call this so they produce identical output. Callers pass `filePath` (for `prettier.resolveConfig`), the formatting options, an optional `widthConfig`, and an `onWarn` callback (so warnings go to `console.error` for the CLI or an OutputChannel for the extension).
- **`src/format.js`** — CLI entry point (`bin: md-fmt`). Responsible for:
  - parsing arguments
  - resolving ignore rules via the `ignore` package (full `.gitignore` semantics), stacked in layers as the walk descends — see below
  - recursively collecting `.md`/`.markdown` files (skipping ignored paths, dangling symlinks, and symlink cycles)
  - calling `formatMarkdown` per file (passing no `widthConfig`, so `tableFormatter` uses its cwd-based default config) and writing back unless `--dry-run`/`--check`
- **`extension/`** — the VS Code extension (separate manifest). `src/extension.js` registers a `DocumentFormattingEditProvider` for `markdown` that calls `formatMarkdown` and returns a whole-document `TextEdit`. esbuild bundles `src/extension.js` (inlining `../../src/pipeline.js` and node deps, `--external:vscode`) into `dist/extension.js`. The extension is **workspace-aware**: it never relies on `process.cwd()`, always passing an explicit `widthConfig` resolved per field from VS Code settings (`mdFormat.*UnicodeRanges`) > the workspace-root `mdformat.config.js` > built-in defaults.

### Processing Pipeline (pipeline.js)

Each document passes through, in order:

1. **Prettier** for whole-document formatting. Options are layered as `{ ...DEFAULT_PRETTIER_OPTIONS, ...resolveConfig(file), parser: 'markdown' }`:
   `DEFAULT_PRETTIER_OPTIONS` (a built-in floor, currently `embeddedLanguageFormatting: 'off'`),
   then a target-local `.prettierrc` resolved **per file via `prettier.resolveConfig(file)`** (relative to each target file's location, NOT where md-fmt runs — so the same repo's `.prettierrc` only applies to files inside it),
   then the forced markdown parser.
   `--tables-only` skips this step.
   - `embeddedLanguageFormatting: 'off'` leaves fenced code blocks untouched.
     This is the only way to both preserve multi-line JSON arrays and keep JS single quotes, because Prettier has no per-rule switch for embedded code — it's all-or-nothing per file.
   - Immediately after Prettier runs, `expandThematicBreaks` re-expands standalone thematic breaks (`<hr>`, e.g. `---`) to `hrLength` characters.
     Prettier's markdown printer hardcodes every thematic break to exactly 3 characters (`---`, or `***` next to a list) with no option to configure it, so this is a necessary post-processing fix-up, not optional cleanup.
     It only touches a line that is exactly `---`/`***` and is surrounded by blank lines or document boundaries (and not inside a fenced code block, via `findCodeFenceRanges`) — safe because Prettier always separates block-level nodes with exactly one blank line and always normalizes setext headings to ATX `#` headings, so no bare `---`/`***` line in Prettier's output can be anything other than a genuine thematic break. Skipped when `--tables-only` (Prettier didn't run, so there is nothing of its own to fix up).
   - Then `rejoinLintNextLineComments` removes the blank line Prettier inserts after a `<!-- markdownlint-disable-next-line … -->` comment.
     Prettier parses the comment as its own HTML block and separates it from the next block with a blank line, so the suppression would land on the blank line and silently stop working (e.g. the HackMD `###### tags:` idiom that needs MD001 suppressed).
     Lines inside fenced code blocks are left alone. Skipped when `--tables-only` for the same reason as above.
2. **Table alignment** (`formatMarkdownTables`) overrides the tables produced by Prettier, using CJK visual width instead.

**The order must not be reversed**:
Prettier's Markdown formatting also re-aligns tables itself, but it aligns by byte length, so full-width characters end up misaligned;
Prettier must run first and the table formatter must run afterward to fix them.
This order has been verified to be idempotent (running it twice produces stable output).

### Formatting Flow (tableFormatter.js)

1. `detectTables` uses a regular expression to find all table blocks in the text, returning `{ text, index }`.
   It first computes fenced-code-block ranges (`findCodeFenceRanges`) and discards any match that starts inside one, so pipe-tables shown as example code are left alone.
2. `formatMarkdownTables` rewrites only the table blocks;
   **content outside tables is preserved untouched** (reassembled via index slicing).
3. `formatTable` does two-pass processing:
   the first pass parses all cells and computes each column's maximum visual width;
   the second pass pads with spaces and rebuilds each row according to alignment (None/Left/Center/Right, determined by the position of `:` in the delimiter row).

### Visual Width Calculation (key design)

`visualWidth()` is where this tool primarily differs from the original VS Code extension:

- Uses `grapheme-splitter` to count graphemes, avoiding miscounting of Emoji combining sequences.
- A `doubleWidthRegex` combines `\p{Extended_Pictographic}` with a set of Unicode ranges to count CJK/Emoji as width 2.
- A `narrowOverrideRegex` "subtracts back" characters that `\p{Extended_Pictographic}` misjudges but that actually render as half-width (e.g. ™, ℹ).

These regexes are built by `buildWidthMatchers(config)` from a width config and passed down through `formatMarkdownTables → formatTable → padCell/visualWidth`.
Resolution is **lazy, not at module load** (so `require`-ing the module has no filesystem side effects):
`formatMarkdownTables` uses `options.matchers`, else builds from `options.widthConfig`, else falls back to `getDefaultMatchers()` which reads `mdformat.config.js` from cwd once and caches it.
The CLI relies on that cwd default; tests inject `widthConfig` so they are deterministic and cwd-independent.

When adjusting character-width determination, edit `mdformat.config.js` (override `doubleWidthUnicodeRanges` and `narrowOverrideUnicodeRanges`) rather than the source defaults directly.
A missing or malformed config silently falls back to the built-in defaults.

### Ignore Rules (format.js)

Modelled directly on `.gitignore`, so nothing depends on `process.cwd()`.

A **layer** (`makeLayer`) pairs one `ignore()` matcher with the directory its patterns are relative to.
Each walk starts with a root layer holding `DEFAULT_IGNORE_PATTERNS` (plus the `--ignore-path` file, when given), anchored at the target root;
`walkDir` then appends a layer for every `.mdformatignore` it meets on the way down.
Rules declared for the same directory are **merged into one matcher** (`mergeLayer`) rather than stacked, because only the `ignore` package's own last-match-wins ordering can resolve them — that is what makes `!node_modules` in a target's own `.mdformatignore` undo a built-in default across the whole subtree.

`classify` evaluates the layers outermost-first and takes the last decisive verdict, so a nested file's negation re-includes what an outer layer excluded.
It uses `ig.test()` rather than `ig.ignores()` because only the former distinguishes "matched a negation" from "did not match".
Its `inherited` argument carries the pattern by which a layer matched an ancestor directory that was re-included anyway:
the `ignore` package extends a directory pattern to cover everything beneath it, but the walk already prunes at excluded directories, so honouring that coverage would re-exclude a subtree git considers included.
Verified against `git check-ignore`.

A target named on the command line is never tested against the rules — an explicit path is an explicit intent, and it is the escape hatch for formatting an otherwise excluded file.

## CLI Options

Mirroring the VS Code extension's setting names:

- `--dry-run` / `-d`: only list the files that would change, without writing (always exits 0).
- `--check`: like `--dry-run` but exits non-zero when any file needs formatting — for CI gates.
- `--tables-only`: skip Prettier and only align tables (restores the earlier "tables-only", surgical behavior).
- `--delimiter-no-pad`: corresponds to `markdown.extension.tableFormatter.delimiterRowNoPadding`.
- `--normalize-indent`: corresponds to `markdown.extension.tableFormatter.normalizeIndentation`, paired with `--tab-size <n>` (default 4).
- `--hr-length <n>`: length of standalone thematic breaks (`<hr>`, e.g. `---`); minimum 3 (default 3). Only applied when Prettier runs (skipped with `--tables-only`), since Prettier's markdown printer hardcodes every thematic break to 3 characters and this is not exposed as a Prettier option.
- `--ignore-path <file>`: an extra `.mdformatignore`-style rule set, layered above the built-in defaults and below any `.mdformatignore`. Its patterns are anchored at each target root, not at the file that declares them, so one shared rule set can be reused across unrelated targets. A missing file is a hard error.

## Git Commits

Follow [`.github/git-commit-instructions.md`](.github/git-commit-instructions.md):

1. All commit messages must be written in English, using standard terminology and conventional wording. Do not mix in non-English words (including interjections or idioms) beyond what is strictly necessary.
2. Use the [Conventional Commits](https://www.conventionalcommits.org/en/) standard format to improve the readability and maintainability of commit messages.
3. When the change is large or complex, include at least one bullet point below the commit subject summarizing the change and the reason each file was modified.

## Notes

- The command name actually registered is `md-fmt` (`package.json`'s `bin`), not the package name `md-format`.
- By default Prettier formats the **entire document** (not just tables); the first run on an existing repo may produce a large diff.
  Use `--tables-only` if you only want table alignment.
