'use strict';

import * as vscode from 'vscode';
import { isString } from 'util';
import { AssertionError } from 'assert';

export function runMarkdownSnippet() {
    // get editor
    let editor = vscode.window.activeTextEditor;

    // get selection
    let selection = editor !== undefined ? editor.selection : undefined;
    if (editor === undefined || selection === undefined) {
        vscode.window.showInformationMessage('No code selected.');
        return;
    }

    // get snippet
    let snippet = editor.document.getText(selection);
    let eol = getEol(editor.document.eol);

    let content = Content.parseSnippet(eol, snippet);
    if (isString(content)) /* if error */ {
        let error = content;
        vscode.window.showInformationMessage(error);
        return;
    }

    // get current active file's uri; if not a file then show error message and exit
    let uri = editor.document.uri;
    if (uri === undefined || uri.scheme !== 'file') {
        vscode.window.showInformationMessage('Opened file is not placed at the local filesystem.');
        return;
    }

    // get configuration
    let config = vscode.workspace.getConfiguration('markdown-run-snippet');
    let finalized = FinalizedContent.finalize(config, eol, content);

    // open it in window as Untitled new file
    // and run it.
    vscode.workspace.openTextDocument({
        language: finalized.mdType,
        content: finalized.fullSnippet
    }).then((doc) => {
        vscode.window.showTextDocument(doc).then(() => {
            vscode.commands.executeCommand('code-runner.run');
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

    constructor(mdType: string, vscodeType: string, rawSnippet: string, fullSnippet: string) {
        this.mdType = mdType;
        this.vscodeType = vscodeType;
        this.rawSnippet = rawSnippet;
        this.fullSnippet = fullSnippet;
    }

    public static finalize(cfg: vscode.WorkspaceConfiguration, eol: string, content: Content): FinalizedContent {
        let mdType = content.mdType;
        let vscodeType = FinalizedContent.mdToVscodeFiletype(cfg, content);
        let rawSnippet = content.rawSnippet;
        let fullSnippet = FinalizedContent
            .applyTemplate(cfg, content)
            .replace(/\n/g, eol);

        if (vscodeType === undefined) {
            vscodeType = content.mdType;
        }
        return new FinalizedContent(mdType, vscodeType, rawSnippet, fullSnippet);
    }

    private static mdToVscodeFiletype(cfg: vscode.WorkspaceConfiguration, content: Content): string | undefined {
        let mdToVscodeTypeMap = cfg.get<any>('mdToVscodeTypeMap');
        return mdToVscodeTypeMap[content.mdType];
    }

    private static applyTemplate(cfg: vscode.WorkspaceConfiguration, content: Content): string {
        let mdTypeToTemplateMap = cfg.get<any>('mdTypeToTemplateMap');
        let template = mdTypeToTemplateMap[content.mdType];
        if (template === undefined) {
            return content.rawSnippet;
        }

        // detect the depth of indentation
        // The template may contain more than one `$snippet`, but the depth of
        // indentation is based on the first occurrence.
        let matchIndent = /^(\ *)\$snippet/m.exec(template);
        if (matchIndent === null) {
            // nothing to replace.
            return template;
        }

        // remove indent from template
        template = template.replace(/^\ *\$snippet/m, '$snippet');

        // insert indentation
        let indent = ' '.repeat(matchIndent[1].length);
        let splitted_snippet = content.rawSnippet.split('\n');
        let rawSnippet = splitted_snippet.map((line) => {
            return indent + line;
        }).join('\n');
        return template.replace(/\$snippet/, rawSnippet);
    }
}
class Content {
    public mdType: string;
    public rawSnippet: string;

    constructor(mdType: string, rawSnippet: string) {
        this.mdType = mdType;
        this.rawSnippet = rawSnippet;
    }

    static parseSnippet(eol: string, orig_snippet: string): Content | string {
        let snippet = orig_snippet.trim();
        if (!snippet.startsWith('```') || !snippet.endsWith('```')) {
            return 'Selection is not started with ``` or is not ended with ```';
        }

        // remove marker
        snippet = snippet.replace(/^```/, '').replace(/```$/, '');

        let splitted_snippet = snippet.split(eol);

        // modify snippet: remove the last line: normally that is empty line.
        let lastline = splitted_snippet.pop();

        // when there isn't even filetype line, lastline will be undefined.
        // splitted_snippet must contain snippet body other than type, so it is
        // needed to have more than 1 element.

        if (// even filetype is not present --- just blank, or
            lastline === undefined ||
            // there is filetype but no body, or
            splitted_snippet.length === 0 ||
            // there is filetype but no line except trailing empty line
            (lastline === '' && splitted_snippet.length === 1)
        ) {
            // then selected snippet doesn't contain any code to run.
            return 'No code to run.';
        }

        // if the last line is not empty, push it again.
        if (lastline !== '') {
            splitted_snippet.push(lastline);
        }

        // parse filetype specified at just after the beginning marker
        let mdType = splitted_snippet[0];
        if (mdType === '') {
            return 'No filetype detected.';
        }

        let rawSnippet = splitted_snippet.slice(1).join('\n');

        return new Content(mdType, rawSnippet);
    }
}