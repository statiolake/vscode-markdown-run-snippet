"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as runSnippet from "./run_snippet";
import * as editSnippet from "./edit_snippet";
import { MarkdownRunCodeLensProvider } from "./code_lens_provider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const runCommand = vscode.commands.registerCommand(
    "extension.runMarkdownSnippet",
    async (range?: vscode.Range) => {
      await runSnippet.runMarkdownSnippet(range);
    }
  );

  const editCommand = vscode.commands.registerCommand(
    "extension.editMarkdownSnippet",
    async (sourceUri: vscode.Uri, range: vscode.Range, mdType: string) => {
      const cfg = vscode.workspace.getConfiguration("markdown-run-snippet");
      const map = cfg.get<{ [key: string]: string }>("mdToVscodeTypeMap") || {};
      const vscodeType = map[mdType] !== undefined ? map[mdType] : mdType;
      const fileExt = sanitizeExt(vscodeType);
      await editSnippet.editMarkdownSnippet(
        sourceUri,
        range,
        vscodeType,
        fileExt
      );
    }
  );

  const codeLens = vscode.languages.registerCodeLensProvider(
    { language: "markdown" },
    new MarkdownRunCodeLensProvider()
  );

  const fsProvider = vscode.workspace.registerFileSystemProvider(
    editSnippet.SCHEME,
    new editSnippet.SnippetFileSystemProvider(),
    { isCaseSensitive: true }
  );

  context.subscriptions.push(runCommand, editCommand, codeLens, fsProvider);
}

// this method is called when your extension is deactivated
export function deactivate() {}

function sanitizeExt(s: string): string {
  // Keep only safe URI path characters. Fall back to "txt" if empty.
  const cleaned = s.replace(/[^A-Za-z0-9_+\-]/g, "");
  return cleaned.length > 0 ? cleaned : "txt";
}
