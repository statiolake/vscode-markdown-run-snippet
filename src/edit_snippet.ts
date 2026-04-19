"use strict";

import * as vscode from "vscode";

export const SCHEME = "md-snippet";

interface EditSession {
  sourceUri: vscode.Uri;
  // Range of the entire fenced block in the source (including both markers).
  fenceRange: vscode.Range;
  fenceIndent: string;
  eol: string;
  // Current body text as known to the virtual doc. Starts as the raw snippet
  // extracted from the source (unindented, LF-joined for the virtual doc).
  body: string;
  invalid: boolean;
  // When true, listener ignores the next change because it was caused by us.
  suppress: boolean;
  disposables: vscode.Disposable[];
}

const sessions = new Map<string, EditSession>();
let nextId = 0;

function sessionKey(uri: vscode.Uri): string {
  // Use path only so that differences in URI serialization (authority handling,
  // percent-encoding, etc.) do not cause lookups to miss.
  return uri.path;
}

export class SnippetFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  public readonly onDidChangeFile = this._emitter.event;

  public watch(): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  public stat(uri: vscode.Uri): vscode.FileStat {
    const session = sessions.get(sessionKey(uri));
    if (session !== undefined) {
      return {
        type: vscode.FileType.File,
        ctime: 0,
        mtime: Date.now(),
        size: Buffer.byteLength(session.body, "utf8")
      };
    }
    // The URI has no session. If it looks like a "directory" path (no
    // extension, or simply the root), report a virtual directory so that
    // VS Code's save flow — which may stat parent paths before writing —
    // does not fall back to createDirectory-with-NoPermissions. Any
    // file-looking URI without a session is genuinely unknown.
    if (isDirectoryLikePath(uri.path)) {
      return {
        type: vscode.FileType.Directory,
        ctime: 0,
        mtime: 0,
        size: 0
      };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  public readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  public createDirectory(): void {
    // No-op: directories are implicit in this virtual FS.
  }

  public readFile(uri: vscode.Uri): Uint8Array {
    const session = sessions.get(sessionKey(uri));
    if (session === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return Buffer.from(session.body, "utf8");
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const session = sessions.get(sessionKey(uri));
    if (session === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    if (session.invalid) {
      vscode.window.showErrorMessage(
        "Cannot write back: the source range was modified or is no longer a valid fenced code block."
      );
      throw vscode.FileSystemError.Unavailable(uri);
    }

    const sourceDoc = await openSourceDoc(session.sourceUri);
    if (sourceDoc === undefined) {
      vscode.window.showErrorMessage(
        "Cannot write back: source document is no longer available."
      );
      session.invalid = true;
      throw vscode.FileSystemError.Unavailable(uri);
    }

    // Re-validate: the recorded fence range must still look like a fence pair.
    if (!isStillFence(sourceDoc, session.fenceRange)) {
      vscode.window.showErrorMessage(
        "Cannot write back: fenced code block markers no longer match the tracked range."
      );
      session.invalid = true;
      throw vscode.FileSystemError.Unavailable(uri);
    }

    const eol = getEol(sourceDoc.eol);
    session.eol = eol;

    const newBody = Buffer.from(content).toString("utf8");
    const replacement = buildReplacement(newBody, session.fenceIndent, eol);

    const bodyRange = new vscode.Range(
      new vscode.Position(session.fenceRange.start.line + 1, 0),
      new vscode.Position(session.fenceRange.end.line, 0)
    );

    const wsEdit = new vscode.WorkspaceEdit();
    wsEdit.replace(session.sourceUri, bodyRange, replacement);

    session.suppress = true;
    const ok = await vscode.workspace.applyEdit(wsEdit);
    session.suppress = false;

    if (!ok) {
      vscode.window.showErrorMessage(
        "Cannot write back: applyEdit was rejected by the editor."
      );
      throw vscode.FileSystemError.Unavailable(uri);
    }

    // Recompute fence range based on the new body line count.
    const newBodyLineCount = countLinesAfterReplacement(replacement, eol);
    const newClosingLine = session.fenceRange.start.line + 1 + newBodyLineCount;
    const closingLineText = sourceDoc.lineAt(newClosingLine).text;
    session.fenceRange = new vscode.Range(
      session.fenceRange.start.line,
      session.fenceRange.start.character,
      newClosingLine,
      closingLineText.length
    );
    session.body = newBody;

    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  public delete(): void {
    throw vscode.FileSystemError.NoPermissions();
  }

  public rename(): void {
    throw vscode.FileSystemError.NoPermissions();
  }
}

export async function editMarkdownSnippet(
  sourceUri: vscode.Uri,
  fenceRange: vscode.Range,
  vscodeType: string,
  fileExt: string
): Promise<void> {
  const sourceDoc = await openSourceDoc(sourceUri);
  if (sourceDoc === undefined) {
    vscode.window.showErrorMessage("Source document could not be opened.");
    return;
  }

  const openLine = sourceDoc.lineAt(fenceRange.start.line).text;
  const indentMatch = /^(\s*)```/.exec(openLine);
  if (indentMatch === null) {
    vscode.window.showErrorMessage(
      "Fence opening marker not found at the expected position."
    );
    return;
  }
  const fenceIndent = indentMatch[1];
  const eol = getEol(sourceDoc.eol);

  // Extract body: lines strictly between opening and closing fence.
  const bodyLines: string[] = [];
  for (let i = fenceRange.start.line + 1; i < fenceRange.end.line; i++) {
    const line = sourceDoc.lineAt(i).text;
    bodyLines.push(stripPrefix(line, fenceIndent));
  }
  const body = bodyLines.join("\n") + (bodyLines.length > 0 ? "\n" : "");

  const id = nextId++;
  // Explicit empty authority so the URI serializes as `md-snippet:///...`
  // rather than `md-snippet:/0/...` (which some consumers parse with the
  // first path segment as the authority).
  const uri = vscode.Uri.from({
    scheme: SCHEME,
    authority: "",
    path: `/${id}/snippet.${fileExt}`
  });

  const session: EditSession = {
    sourceUri,
    fenceRange,
    fenceIndent,
    eol,
    body,
    invalid: false,
    suppress: false,
    disposables: []
  };

  const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
    if (session.invalid) return;
    if (session.suppress) return;
    if (e.document.uri.toString() !== sourceUri.toString()) return;

    for (const change of e.contentChanges) {
      if (session.invalid) return;
      applyChangeToRange(session, change);
    }
  });
  session.disposables.push(changeListener);

  sessions.set(sessionKey(uri), session);

  let doc = await vscode.workspace.openTextDocument(uri);
  if (doc.languageId !== vscodeType) {
    // setTextDocumentLanguage closes the old TextDocument and re-opens one
    // with the new language at the same URI. That fires onDidCloseTextDocument
    // for the old doc — so we must register our close listener *after* this
    // step, otherwise the very act of setting the language would tear down
    // the session before the user even sees the tab.
    doc = await vscode.languages.setTextDocumentLanguage(doc, vscodeType);
  }
  await vscode.window.showTextDocument(doc, { preview: false });

  const closeListener = vscode.workspace.onDidCloseTextDocument(closed => {
    if (sessionKey(closed.uri) !== sessionKey(uri)) return;
    for (const d of session.disposables) d.dispose();
    sessions.delete(sessionKey(uri));
  });
  session.disposables.push(closeListener);
}

async function openSourceDoc(
  uri: vscode.Uri
): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

function isStillFence(
  doc: vscode.TextDocument,
  range: vscode.Range
): boolean {
  if (range.end.line >= doc.lineCount) return false;
  const openLine = doc.lineAt(range.start.line).text;
  const closeLine = doc.lineAt(range.end.line).text;
  return /^\s*```/.test(openLine) && /^\s*```\s*$/.test(closeLine);
}

function applyChangeToRange(
  session: EditSession,
  change: vscode.TextDocumentContentChangeEvent
): void {
  const r = session.fenceRange;
  const cs = change.range.start;
  const ce = change.range.end;

  // Fully before the fence (change ends on a line before the opening fence).
  if (ce.line < r.start.line) {
    const removedLines = ce.line - cs.line;
    const addedLines = (change.text.match(/\n/g) || []).length;
    const delta = addedLines - removedLines;
    if (delta !== 0) {
      session.fenceRange = new vscode.Range(
        r.start.line + delta,
        r.start.character,
        r.end.line + delta,
        r.end.character
      );
    }
    return;
  }

  // Fully after the fence (change starts on a line past the closing fence).
  if (cs.line > r.end.line) {
    return;
  }

  // Otherwise the change overlaps a fence marker line — invalidate.
  session.invalid = true;
}

function buildReplacement(
  body: string,
  indent: string,
  eol: string
): string {
  let normalized = body.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  // If the body ends with a newline, split leaves a trailing "" — drop it,
  // we'll reintroduce the terminating EOL explicitly.
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  const indented = lines
    .map(l => (l.length === 0 ? "" : indent + l))
    .join(eol);
  return indented + eol;
}

function countLinesAfterReplacement(
  replacement: string,
  eol: string
): number {
  // `replacement` is `<indented body><eol>`. The number of lines it occupies
  // in the source equals the number of EOLs it contains, which equals the
  // body line count.
  if (replacement.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = replacement.indexOf(eol, idx);
    if (found === -1) break;
    count++;
    idx = found + eol.length;
  }
  return count;
}

function stripPrefix(line: string, prefix: string): string {
  if (prefix.length === 0) return line;
  return line.startsWith(prefix) ? line.slice(prefix.length) : line;
}

function isDirectoryLikePath(path: string): boolean {
  if (path === "" || path === "/") return true;
  if (path.endsWith("/")) return true;
  // No extension in the last segment → treat as directory.
  const lastSlash = path.lastIndexOf("/");
  const basename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  return !basename.includes(".");
}

function getEol(eeol: vscode.EndOfLine): string {
  return eeol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}
