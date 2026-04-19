"use strict";
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import * as runSnippet from "./run_snippet";
import { MarkdownRunCodeLensProvider } from "./code_lens_provider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the implementation of the command with  registerCommand
  // The commandId parameter must match the command field in package.json
  const runCommand = vscode.commands.registerCommand(
    "extension.runMarkdownSnippet",
    (range?: vscode.Range) => {
      runSnippet.runMarkdownSnippet(range);
    }
  );

  const codeLens = vscode.languages.registerCodeLensProvider(
    { language: "markdown" },
    new MarkdownRunCodeLensProvider()
  );

  context.subscriptions.push(runCommand, codeLens);
}

// this method is called when your extension is deactivated
export function deactivate() {}
