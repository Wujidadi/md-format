'use strict';

// Loads the REAL bundled dist/extension.js with a mock `vscode` module,
// then drives activate() → the registered formatting provider end-to-end.
// This exercises the exact code VS Code will load (not just src/pipeline.js).

const path = require('path');
const Module = require('module');

// ── Mock vscode module ────────────────────────────────────────────────────────

let registeredProvider = null;

class Position {
  constructor(offset) {
    this.offset = offset;
  }
}
class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

const settings = {
  tablesOnly: false,
  delimiterRowNoPadding: false,
  normalizeIndentation: false,
  tabSize: 4,
  doubleWidthUnicodeRanges: [],
  narrowOverrideUnicodeRanges: [],
};

const vscodeMock = {
  window: {
    createOutputChannel: () => ({
      appendLine: (m) => console.log(`[OutputChannel] ${m}`),
      dispose: () => {},
    }),
    showErrorMessage: (m) => console.log(`[ErrorMessage] ${m}`),
  },
  workspace: {
    getConfiguration: () => ({ get: (key) => settings[key] }),
    // Pretend there is no workspace folder, so width config comes purely from settings/defaults.
    getWorkspaceFolder: () => undefined,
  },
  languages: {
    registerDocumentFormattingEditProvider: (selector, provider) => {
      registeredProvider = provider;
      console.log(
        `[register] DocumentFormattingEditProvider for ${JSON.stringify(selector)}`,
      );
      return { dispose: () => {} };
    },
  },
  Range,
  Position,
  TextEdit: {
    replace: (range, newText) => ({ range, newText }),
  },
};

// Intercept require('vscode') to return the mock.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return originalLoad.call(this, request, parent, isMain);
};

// ── Drive the bundled extension ───────────────────────────────────────────────

const ext = require(path.join(__dirname, 'dist', 'extension.js'));

const subscriptions = [];
ext.activate({ subscriptions });

if (!registeredProvider) {
  console.error('FAIL: no formatting provider was registered');
  process.exit(1);
}

const input =
  '#  我的標題\n\n| 名稱 | 說明 |\n|---|---|\n| 蘋果 | a |\n| 香蕉🍌 | bb |\n';

const document = {
  uri: { fsPath: '/tmp/verify.md', scheme: 'file' },
  getText: () => input,
  positionAt: (offset) => new Position(offset),
};

(async () => {
  const edits = await registeredProvider.provideDocumentFormattingEdits(
    document,
    { tabSize: 4, insertSpaces: true },
    { isCancellationRequested: false },
  );

  if (!Array.isArray(edits) || edits.length === 0) {
    console.error('FAIL: provider returned no edits');
    process.exit(1);
  }

  const result = edits[0].newText;
  console.log('\n=== INPUT ===');
  console.log(JSON.stringify(input));
  console.log('\n=== OUTPUT (one TextEdit replacing the whole document) ===');
  console.log(result);

  // Sanity checks.
  const checks = [
    ['Prettier collapsed "#  " → "# "', /^# 我的標題\n/.test(result)],
    ['table delimiter row rebuilt', /\| -+ \| -+ \|/.test(result)],
    [
      'CJK header/data columns aligned to equal visual width',
      result.includes('| 名稱   |') && result.includes('| 蘋果   |'),
    ],
  ];
  let ok = true;
  console.log('\n=== CHECKS ===');
  for (const [label, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})();
