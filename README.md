# md-format

A CLI tool to recursively format Markdown files. It runs [Prettier](https://prettier.io) for
general Markdown formatting, then re-aligns tables using the
[yzhang.markdown-all-in-one](https://github.com/yzhang-gh/vscode-markdown) table alignment
algorithm — with correct CJK and Emoji character width handling (which Prettier's byte-based
alignment gets wrong). Use `--tables-only` to skip Prettier and align tables alone.

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

| Option               | Description                                 | Default |
| -------------------- | ------------------------------------------- | ------- |
| `-h, --help`         | Show help message                           | —      |
| `-d, --dry-run`      | Print what would be changed without writing | `false` |
| `--tables-only`      | Only align tables; skip Prettier formatting | `false` |
| `--delimiter-no-pad` | Enable `delimiterRowNoPadding`              | `false` |
| `--normalize-indent` | Enable `normalizeIndentation`               | `false` |
| `--tab-size <n>`     | Tab size for indentation normalization      | `4`     |

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

Prettier formatting respects a standard `.prettierrc`, resolved **relative to each target file's
location** via Prettier's own config lookup (not relative to where `md-fmt` runs). On top of that,
`md-fmt` always applies a built-in default of `embeddedLanguageFormatting: "off"`, so fenced code
blocks (JSON, JS, etc.) are left untouched — this preserves things like multi-line JSON arrays and
single-quoted JS regardless of the target location. A target-local `.prettierrc` can override this
default. The table alignment step is configured separately:

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
  // Characters matched by \p{Extended_Pictographic} but rendered as
  // narrow (1-width) in your font — subtract them back to width 1
  narrowOverrideUnicodeRanges: [
    '\u2122', // ™ Trade Mark Sign
    '\u2139', // ℹ Information Source
  ],
};
```

If no config file is present, the defaults above are used.

## Excluding Files

Create a `.mdformatignore` file in the project root using the same syntax as
`.gitignore`. The following are always excluded regardless:

- `node_modules/`
- `.git/`

## Requirements

- Node.js 16+
- npm

## License

MIT

## Contributors

- [Claude Sonnet 4.6](https://www.anthropic.com)
