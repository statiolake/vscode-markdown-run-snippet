"use strict";

import * as vscode from "vscode";
import { isString } from "util";
import { AssertionError } from "assert";

export function runMarkdownSnippet() {
  // get editor
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    vscode.window.showErrorMessage("Editor not found.");
    return;
  }

  // get selection
  const selection = editor.selection;
  if (selection === undefined || selection.isEmpty) {
    vscode.window.showErrorMessage("No code selected.");
    return;
  }

  // handle selection
  // get snippet
  const selectedText = editor.document.getText(selection);
  const eol = getEol(editor.document.eol);

  const content = SelectedContent.parseSelectedText(eol, selectedText);
  if (isString(content)) {
    // if string is returned, this represents an error message.
    vscode.window.showErrorMessage(content);
    return;
  }

  // get current active file's uri
  // unsupported: if not a file, show error message and exit
  const uri = editor.document.uri;
  if (uri === undefined || uri.scheme !== "file") {
    vscode.window.showErrorMessage(
      "Opened file is not placed at the local filesystem."
    );
    return;
  }

  // get configuration
  const config = vscode.workspace.getConfiguration("markdown-run-snippet");
  const finalized = FinalizedContent.finalize(config, eol, content);

  // open it in window as Untitled new file
  // and run it.
  vscode.workspace
    .openTextDocument({
      language: finalized.vscodeType,
      content: finalized.fullSnippet
    })
    .then(doc => {
      vscode.window.showTextDocument(doc).then(() => {
        vscode.commands.executeCommand("code-runner.run");
      });
    });
}

function getEol(eeol: vscode.EndOfLine): string {
  let eol;
  switch (eeol) {
    case vscode.EndOfLine.CRLF:
      eol = "\r\n";
      break;
    case vscode.EndOfLine.LF:
      eol = "\n";
      break;
    default:
      throw new AssertionError({
        message: "reached unreachable code: unknown EndOfLine enum variant."
      });
  }
  return eol;
}

class FinalizedContent {
  public mdType: string;
  public vscodeType: string;
  public rawSnippet: string;
  public fullSnippet: string;

  constructor(
    mdType: string,
    vscodeType: string,
    rawSnippet: string,
    fullSnippet: string
  ) {
    this.mdType = mdType;
    this.vscodeType = vscodeType;
    this.rawSnippet = rawSnippet;
    this.fullSnippet = fullSnippet;
  }

  public static finalize(
    cfg: vscode.WorkspaceConfiguration,
    eol: string,
    content: SelectedContent
  ): FinalizedContent {
    const mdType = content.mdType;
    let vscodeType = FinalizedContent.mdToVscodeFiletype(cfg, content);
    const rawSnippet = content.snippet;
    const fullSnippet = FinalizedContent.applyTemplate(cfg, content).replace(
      /\n/g,
      eol
    );

    // fallback: unregistered mdType
    if (vscodeType === undefined) {
      vscodeType = content.mdType;
    }

    return new FinalizedContent(mdType, vscodeType, rawSnippet, fullSnippet);
  }

  private static mdToVscodeFiletype(
    cfg: vscode.WorkspaceConfiguration,
    content: SelectedContent
  ): string | undefined {
    const mdToVscodeTypeMap = cfg.get<any>("mdToVscodeTypeMap");
    return mdToVscodeTypeMap[content.mdType];
  }

  private static applyTemplate(
    cfg: vscode.WorkspaceConfiguration,
    content: SelectedContent
  ): string {
    const mdTypeToTemplateMap = cfg.get<any>("mdTypeToTemplateMap");
    let template = mdTypeToTemplateMap[content.mdType];
    if (template === undefined) {
      return content.snippet;
    }

    // detect the depth of indentation
    // The template may contain more than one `$snippet`, but the depth of
    // indentation is based on the first occurrence.
    const indentMatch = /^(\ *)\$snippet/m.exec(template);
    if (indentMatch === null) {
      // nothing to replace.
      return template;
    }

    // remove indent from template
    template = template.replace(/^\ *\$snippet/m, "$snippet");

    // insert indentation
    const indent = indentMatch[1];
    const splitted_rawSnippet = content.snippet.split("\n");
    const indentedSnippet = splitted_rawSnippet
      .map(line => {
        return indent + line;
      })
      .join("\n");
    return template.replace(/\$snippet/, indentedSnippet);
  }
}

class SelectedContent {
  private constructor(
    public readonly mdType: string,
    public readonly snippet: string
  ) {}

  static parseSelectedText(
    eol: string,
    selectedText: string
  ): SelectedContent | string {
    // Get the indent of the line containing the beginning marker (```). It
    // should be removed before running because the indent there is rather
    // indent for markdown's structure than code's.
    const indent = getMarkdownIndent(selectedText);

    selectedText = selectedText.trim();

    // Check if markers exist
    if (!selectedText.startsWith("```") || !selectedText.endsWith("```")) {
      return "Selection is not started with ``` or is not ended with ```";
    }

    // Remove markers
    selectedText = selectedText.replace(/^```/, "").replace(/```$/, "");

    const lines = selectedText.split(eol);

    // Remove the last line: that should be an empty line.
    const lastline = lines.pop();
    if (lastline === undefined) {
      // It never occurs, since even splitting empty string "" results array
      // containing one empty string [""].
      throw new AssertionError({
        message: "Lines should have at least one element."
      });
    }

    // If lastline is not an empty, it means there is no EOL before the end
    // marker of snippet.
    if (lastline.trim() !== "") {
      return "No newline before the end marker of snippet.";
    }

    //
    // now lines should be like below:
    //
    // {language}
    // ..snippets..
    //
    // so there should be at least one element to get language.
    //
    if (lines.length === 0) {
      return "No filetype is specified.";
    } else if (lines.length === 1) {
      return "No code to run.";
    }

    // Parse filetype specified at just after the beginning marker
    const mdType = lines[0];
    if (mdType === "") {
      return "No filetype detected.";
    }

    // Remove markdown's structural indents.
    const snippet = lines
      .slice(1)
      .map(line => line.replace(RegExp("^" + indent), ""))
      .join("\n");

    return new SelectedContent(mdType, snippet);
  }
}

function getMarkdownIndent(text: string): string {
  const indentMatch = /^(\s*)```/.exec(text);

  if (indentMatch === null) {
    throw new AssertionError({
      message: "indentMatch is null"
    });
  }

  return indentMatch[1];
}
