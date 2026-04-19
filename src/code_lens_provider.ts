"use strict";

import * as vscode from "vscode";

// Matches a line that consists only of (optional) leading whitespace followed
// by ```, plus anything after. Capture groups: indent, rest (possibly language).
const FENCE_RE = /^(\s*)```(.*)$/;

export class MarkdownRunCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];
    const lineCount = document.lineCount;

    let inFence = false;
    let fenceStart = -1;
    let fenceIndent = "";
    let fenceLang = "";

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i).text;
      const m = FENCE_RE.exec(line);
      if (m === null) continue;

      if (!inFence) {
        const indent = m[1];
        const lang = m[2].trim();
        // Skip fences without a language spec — the runner requires one.
        if (lang === "") continue;
        inFence = true;
        fenceStart = i;
        fenceIndent = indent;
        fenceLang = lang;
      } else {
        // Require closing fence to share the opening fence's indent so that
        // nested fences (e.g. inside indented code examples) don't terminate.
        if (m[1] !== fenceIndent) continue;

        const range = new vscode.Range(fenceStart, 0, i, line.length);
        lenses.push(
          new vscode.CodeLens(range, {
            title: "$(play) Run",
            command: "extension.runMarkdownSnippet",
            arguments: [range]
          })
        );
        lenses.push(
          new vscode.CodeLens(range, {
            title: "$(edit) Edit",
            command: "extension.editMarkdownSnippet",
            arguments: [document.uri, range, fenceLang]
          })
        );
        inFence = false;
      }
    }

    return lenses;
  }
}
