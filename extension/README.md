# Markdown Formatter (CJK-aware tables)

A VS Code formatter for Markdown that runs **Prettier** for general formatting and then **re-aligns tables by visual width**, correctly handling CJK and Emoji characters (full-width = 2, half-width = 1) — precisely what Prettier's byte-length-based alignment gets wrong.

Register it as your Markdown formatter and use **Format Document** (`Shift+Alt+F` / `Shift+Opt+F`) or **Format Document With…** as usual.

## Features

- Prettier-based whole-document Markdown formatting.
- CJK/Emoji-aware table alignment ported from [yzhang.markdown-all-in-one](https://github.com/yzhang-gh/vscode-markdown)'s table formatter.
- Fenced code blocks are left untouched, including pipe-tables shown as example code.
- Idempotent: formatting an already-formatted document is a no-op.

## Usage

1. Open a Markdown file.
2. Run **Format Document** (`Shift+Alt+F`). On the first use VS Code may ask you to pick a default formatter — choose **Markdown Formatter (CJK-aware tables)**.

To set it as the default formatter for Markdown, add to your settings:

```json
"[markdown]": {
  "editor.defaultFormatter": "wujidadi.md-format-vscode"
}
```

### AI-guidance Markdown variants

Copilot and Claude tooling assign their own language modes to AI-guidance files such as prompt files (`*.prompt.md`), instructions files (`*.instructions.md`), chat modes (`*.chatmode.md`), custom agents (`*.agent.md`), and skills (`SKILL.md`), so VS Code no longer treats them as plain Markdown.
This formatter matches files by path (any `.md` / `.markdown` file), not by language id, so it is offered on those files too — including ones under `.github/` and `.claude/`.
To make it the default formatter there as well, add a language-scoped entry per mode you use; the language ids are assigned by your installed extensions, so confirm each one via the language indicator in the status bar:

```json
"[prompt]":       { "editor.defaultFormatter": "wujidadi.md-format-vscode" },
"[instructions]": { "editor.defaultFormatter": "wujidadi.md-format-vscode" },
"[chatmode]":     { "editor.defaultFormatter": "wujidadi.md-format-vscode" }
```

## Settings

| Setting                                | Default | Description                                                                  |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `mdFormat.tablesOnly`                  | `false` | Skip Prettier; only align tables.                                            |
| `mdFormat.delimiterRowNoPadding`       | `false` | Remove space padding around the delimiter row.                               |
| `mdFormat.normalizeIndentation`        | `false` | Normalize table indentation to whole tab stops.                              |
| `mdFormat.tabSize`                     | `4`     | Tab size used when normalizing indentation.                                  |
| `mdFormat.hrLength`                    | `3`     | Length of standalone thematic breaks (`<hr>`, e.g. `---`).                   |
| `mdFormat.doubleWidthUnicodeRanges`    | `[]`    | Override the set of characters treated as double-width.                      |
| `mdFormat.narrowOverrideUnicodeRanges` | `[]`    | Override the set of pictographic characters that actually render half-width. |

### Width configuration

Character-width determination can be customized in two ways, applied per field in this order of precedence:

1. The two `mdFormat.*UnicodeRanges` settings above (when non-empty).
2. An `mdformat.config.js` file at the workspace-folder root (same format as the CLI's config; exports `doubleWidthUnicodeRanges` / `narrowOverrideUnicodeRanges`).
3. The built-in defaults.

## Relationship to the CLI

This extension shares its formatting core with the `md-format` CLI (`md-fmt`) in the same repository, so both produce identical output.

## Development

```sh
cd extension
npm install
npm run compile        # bundle src/extension.js → dist/extension.js via esbuild
```

Then press **F5** from the repository root to launch an Extension Development Host.

## License

MIT
