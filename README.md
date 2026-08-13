# md-format

Format Markdown files with [Prettier](https://prettier.io) for general formatting, then re-align tables using the [yzhang.markdown-all-in-one](https://github.com/yzhang-gh/vscode-markdown) table alignment algorithm
— with correct CJK and Emoji character width handling (which Prettier's byte-based alignment gets wrong).
Use `--tables-only` to skip Prettier and align tables alone.

It ships in two forms that share the same formatting core:

- a **CLI** (`md-fmt`) that recursively formats files — documented below;
- a **VS Code extension** that formats the active document via **Format Document** (`Shift+Alt+F`) — see [`extension/`](extension/).

## Installation

```sh
git clone <repo-url> md-format
cd md-format
npm install
npm link
```

After `npm link`, the `md-fmt` command is available globally.

## Usage

```sh
md-fmt [options] <directory|file> [<directory|file> ...]
```

### Options

| Option               | Description                                                       | Default |
| -------------------- | ----------------------------------------------------------------- | ------- |
| `-h, --help`         | Show help message                                                 | —      |
| `-d, --dry-run`      | Print what would be changed without writing                       | `false` |
| `--check`            | Exit non-zero if any file needs formatting (for CI)               | `false` |
| `--tables-only`      | Only align tables; skip Prettier formatting                       | `false` |
| `--delimiter-no-pad` | Enable `delimiterRowNoPadding`                                    | `false` |
| `--normalize-indent` | Enable `normalizeIndentation`                                     | `false` |
| `--tab-size <n>`     | Tab size for indentation normalization                            | `4`     |
| `--hr-length <n>`    | Length of standalone thematic breaks (`<hr>`, e.g. `---`); min 3  | `3`     |
| `--ignore-path <f>`  | Extra `.mdformatignore`-style rules, applied to every target root | —      |

### Examples

```sh
# Format all .md files under ./docs
md-fmt ./docs

# Preview changes without writing
md-fmt --dry-run ./docs

# Format a single file
md-fmt ./README.md
```

## Configuration

Prettier formatting respects a standard `.prettierrc`, resolved **relative to each target file's location** via Prettier's own config lookup (not relative to where `md-fmt` runs).
On top of that, `md-fmt` always applies a built-in default of `embeddedLanguageFormatting: "off"`, so fenced code blocks (JSON, JS, etc.) are left untouched
— this preserves things like multi-line JSON arrays and single-quoted JS regardless of the target location.
A target-local `.prettierrc` can override this default.
The table alignment step is configured separately:

Place a `mdformat.config.js` in the project root to override the default character width ranges:

```js
module.exports = {
  // Unicode ranges treated as double-width (CJK, arrows, symbols, etc.)
  doubleWidthUnicodeRanges: [
    '\u2014-\u2015', // Em Dash, horizontal bar
    '\u2024-\u2026', // One Dot Leader, Two Dot Leader, Horizontal Ellipsis
    '\u2030-\u2031', // Per Mille Sign, Per Ten Thousand Sign
    '\u203b',        // Reference Mark
    '\u2190-\u2193', // Arrows (←, ↑, →, ↓)
    '\u25a0-\u25ff', // Geometric Shapes
    '\u2600-\u26ff', // Miscellaneous Symbols
    '\u2713',        // Check Mark
    '\u2717',        // Ballot X
    '\u2e80-\u2eff', // CJK Radicals Supplement
    '\u2f00-\u2fdf', // Kangxi Radicals
    '\u3000-\u9fff', // CJK Unified Ideographs
    '\uac00-\ud7af', // Hangul Syllables
    '\uf900-\ufaff', // CJK Compatibility Ideographs
    '\ufe30-\ufe4f', // CJK Compatibility Forms
    '\ufe50-\ufe6f', // Small Form Variants
    '\uff01-\uff60', // Fullwidth ASCII variants
  ],
  // Characters matched by \p{Extended_Pictographic} but rendered as narrow (1-width) in your font — subtract them back to width 1
  narrowOverrideUnicodeRanges: [
    '\u2122', // ™ Trade Mark Sign
    '\u2139', // ℹ Information Source
  ],
};
```

If no config file is present, the defaults above are used.

## Excluding Files

`md-fmt` recursively formats files ending in `.md` or `.markdown`.

Create a `.mdformatignore` file to control what is skipped.
It uses full `.gitignore` syntax (anchoring, negation with `!`, comments, any-depth matching) and behaves like `.gitignore` in every respect:
place one in any directory and its rules govern that directory and everything below it, relative to where the file sits.
Nothing depends on the directory `md-fmt` happens to run from.

Rules apply in layers, from broad to narrow, and the innermost match wins:

1. the built-in defaults, always active:

   ```
   node_modules
   vendor
   .git
   dist
   build
   .cache
   ```

2. the file given by `--ignore-path <file>`, if any, matched relative to each target root — for a shared or global rule set;
3. every `.mdformatignore` found along the way, matched relative to its own directory.

A `.mdformatignore` **adds to** the defaults rather than replacing them, so a negation is what brings one back:

```gitignore
!node_modules    # do format the Markdown shipped inside node_modules
CHANGELOG.md     # never touch the changelog
docs/generated/  # trailing slash: directories only
```

A path named directly on the command line is always formatted, whatever the rules say —
`md-fmt ./CHANGELOG.md` is an explicit instruction, and it is the escape hatch for formatting an otherwise excluded file.

Symlink cycles are detected (a directory is walked at most once by real path), and dangling symlinks are skipped.

## VS Code Extension

The [`extension/`](extension/) folder is a VS Code formatter extension built on the same core, so it produces output identical to the CLI.
Register it as your Markdown formatter and use **Format Document** (`Shift+Alt+F` / `Shift+Opt+F`) or **Format Document With…**.

```sh
cd extension
npm install
npm run compile     # bundle src/extension.js → dist/extension.js (esbuild)
```

Press **F5** from the repository root to launch an Extension Development Host, or run `npm run package` (in `extension/`) to build a `.vsix`.
Settings mirror the CLI options (`mdFormat.tablesOnly`, `mdFormat.delimiterRowNoPadding`, `mdFormat.normalizeIndentation`, `mdFormat.tabSize`, `mdFormat.hrLength`) plus `mdFormat.doubleWidthUnicodeRanges` / `mdFormat.narrowOverrideUnicodeRanges`; the extension also reads a workspace-root `mdformat.config.js` for width configuration.
See [`extension/README.md`](extension/README.md) for details.

## Requirements

- Node.js 18+ (uses the built-in `node --test` runner for `npm test`)
- npm

## License

MIT

## Contributors

- [Claude Sonnet 4.6](https://www.anthropic.com)
