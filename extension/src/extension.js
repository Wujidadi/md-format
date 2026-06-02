'use strict';

const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

// Shared core, bundled in by esbuild (see package.json "compile").
const { formatMarkdown } = require('../../src/pipeline');

/**
 * Resolve the width config for a document, merging sources by precedence
 * (highest first), per field:
 *   1. VS Code settings (mdFormat.doubleWidthUnicodeRanges / narrowOverrideUnicodeRanges) when non-empty
 *   2. the document's workspace-folder `mdformat.config.js`
 *   3. tableFormatter's built-in defaults (applied when a field is left out)
 *
 * Always returns an object, so the core never falls back to reading
 * process.cwd() (which, in the extension host, is not the user's workspace).
 */
function resolveWidthConfig(document, channel) {
  const cfg = vscode.workspace.getConfiguration('mdFormat', document.uri);
  const settingsDouble = cfg.get('doubleWidthUnicodeRanges') || [];
  const settingsNarrow = cfg.get('narrowOverrideUnicodeRanges') || [];

  // Load the workspace-folder config file, if any.
  let fileConfig = {};
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (folder) {
    const configPath = path.join(folder.uri.fsPath, 'mdformat.config.js');
    if (fs.existsSync(configPath)) {
      try {
        // Bust the require cache so edits to the config are picked up without reloading the window.
        delete require.cache[require.resolve(configPath)];
        fileConfig = require(configPath) || {};
      } catch (err) {
        channel.appendLine(
          `ignoring malformed mdformat.config.js (${configPath}): ${err.message}`,
        );
      }
    }
  }

  const widthConfig = {};
  // Per field: settings win when non-empty, else the config file, else omit (→ built-in default).
  if (settingsDouble.length) {
    widthConfig.doubleWidthUnicodeRanges = settingsDouble;
  } else if (Array.isArray(fileConfig.doubleWidthUnicodeRanges)) {
    widthConfig.doubleWidthUnicodeRanges = fileConfig.doubleWidthUnicodeRanges;
  }
  if (settingsNarrow.length) {
    widthConfig.narrowOverrideUnicodeRanges = settingsNarrow;
  } else if (Array.isArray(fileConfig.narrowOverrideUnicodeRanges)) {
    widthConfig.narrowOverrideUnicodeRanges =
      fileConfig.narrowOverrideUnicodeRanges;
  }
  return widthConfig;
}

function activate(context) {
  const channel = vscode.window.createOutputChannel('Markdown Formatter (CJK)');
  context.subscriptions.push(channel);

  const provider = {
    async provideDocumentFormattingEdits(document) {
      const text = document.getText();
      const cfg = vscode.workspace.getConfiguration('mdFormat', document.uri);

      let formatted;
      try {
        formatted = await formatMarkdown(text, {
          filePath: document.uri.fsPath,
          tablesOnly: cfg.get('tablesOnly'),
          delimiterRowNoPadding: cfg.get('delimiterRowNoPadding'),
          normalizeIndentation: cfg.get('normalizeIndentation'),
          tabSize: cfg.get('tabSize'),
          widthConfig: resolveWidthConfig(document, channel),
          onWarn: (msg) => channel.appendLine(msg),
        });
      } catch (err) {
        channel.appendLine(`failed to format ${document.uri.fsPath}: ${err.message}`);
        vscode.window.showErrorMessage(
          `Markdown Formatter: ${err.message} (see "Markdown Formatter (CJK)" output)`,
        );
        return [];
      }

      if (formatted === text) return [];

      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(text.length),
      );
      return [vscode.TextEdit.replace(fullRange, formatted)];
    },
  };

  // Match by file path, not by language id.
  // AI-guidance files (*.prompt.md, *.instructions.md, *.chatmode.md, *.agent.md, SKILL.md, .claude/rules/*.md, etc.) are Markdown but get assigned their own language ids by Copilot/Claude extensions, so a `{ language: 'markdown' }` selector misses them.
  // Those ids are extension- and version-dependent, so a glob over `.md`/`.markdown` covers every current and future variant since they all keep the Markdown extension.
  const selector = [
    { language: 'markdown' }, // markdown-language docs, including untitled/unsaved
    { scheme: 'file', pattern: '**/*.{md,markdown}' }, // any .md file regardless of its language id
  ];
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, provider),
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
