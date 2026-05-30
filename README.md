# md-format

A CLI tool to recursively format Markdown tables, based on the [yzhang.markdown-all-in-one](https://github.com/yzhang-gh/vscode-markdown) table alignment algorithm — with correct CJK and Emoji character width handling.

## Installation

```sh
git clone <repo-url> md-format
cd md-format
npm install
npm link
```

After `npm link`, the `md-format` command is available globally.

## Usage

```sh
md-format [options] <directory|file> [<directory|file> ...]
```

### Options

| Option               | Description                                 | Default |
| -------------------- | ------------------------------------------- | ------- |
| `-h, --help`         | Show help message                           | —      |
| `-d, --dry-run`      | Print what would be changed without writing | `false` |
| `--delimiter-no-pad` | Enable `delimiterRowNoPadding`              | `false` |
| `--normalize-indent` | Enable `normalizeIndentation`               | `false` |
| `--tab-size <n>`     | Tab size for indentation normalization      | `4`     |

### Examples

```sh
# Format all .md files under ./docs
md-format ./docs

# Preview changes without writing
md-format --dry-run ./docs

# Format a single file
md-format ./README.md
```

## Configuration

Place a `mdformat.config.js` in the project root to override the default character width ranges:

```js
module.exports = {
  // Unicode ranges treated as double-width (CJK, arrows, symbols, etc.)
  doubleWidthUnicodeRanges: [
    '\u2014-\u2015', // em dash, horizontal bar
    '\u2025-\u2026', // two dot leader, horizontal ellipsis
    '\u2030',        // per mille sign
    '\u203b',        // reference mark
    '\u2190-\u2193', // arrows (←↑→↓)
    '\u25a0-\u25ff', // geometric shapes
    '\u2713',        // check mark ✓
    '\u2717',        // ballot x ✗
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
