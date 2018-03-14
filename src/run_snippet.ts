'use strict';

import * as vscode from 'vscode';
import { isString } from 'util';
import { AssertionError } from 'assert';

export function runMarkdownSnippet() {
    // get editor
    const editor = vscode.window.activeTextEditor;

    // get selection
    const selection = editor !== undefined ? editor.selection : undefined;
    if (editor === undefined || selection === undefined || selection.isEmpty) {
        vscode.window.showErrorMessage('No code selected.');
        return;
    }

    // get snippet
    const selectedText = editor.document.getText(selection);
    const eol = getEol(editor.document.eol);

    const content = Content.parseSelectedText(eol, selectedText);
    if (isString(content)) /* if error */ {
        // if string is returned, this represents an error message.
        vscode.window.showErrorMessage(content);
        return;
    }

    // get current active file's uri
    // unsupported: if not a file, show error message and exit
    const uri = editor.document.uri;
    if (uri === undefined || uri.scheme !== 'file') {
        vscode.window.showErrorMessage('Opened file is not placed at the local filesystem.');
        return;
    }

    // get configuration
    const config = vscode.workspace.getConfiguration('markdown-run-snippet');
    const finalized = FinalizedContent.finalize(config, eol, content);

    // open it in window as Untitled new file
    // and run it.
    vscode.workspace.openTextDocument({
        language: finalized.vscodeType,
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
        const mdType = content.mdType;
        let   vscodeType = FinalizedContent.mdToVscodeFiletype(cfg, content);
        const rawSnippet = content.rawSnippet;
        const fullSnippet = FinalizedContent
            .applyTemplate(cfg, content)
            .replace(/\n/g, eol);

        // fallback: unregistered mdType
        if (vscodeType === undefined) {
            vscodeType = content.mdType;
        }

        return new FinalizedContent(mdType, vscodeType, rawSnippet, fullSnippet);
    }

    private static mdToVscodeFiletype(cfg: vscode.WorkspaceConfiguration, content: Content): string | undefined {
        const mdToVscodeTypeMap = cfg.get<any>('mdToVscodeTypeMap');
        return mdToVscodeTypeMap[content.mdType];
    }

    private static applyTemplate(cfg: vscode.WorkspaceConfiguration, content: Content): string {
        const mdTypeToTemplateMap = cfg.get<any>('mdTypeToTemplateMap');
        let template = mdTypeToTemplateMap[content.mdType];
        if (template === undefined) {
            return content.rawSnippet;
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
        template = template.replace(/^\ *\$snippet/m, '$snippet');

        // insert indentation
        const indent = ' '.repeat(indentMatch[1].length);
        const splitted_rawSnippet = content.rawSnippet.split('\n');
        const indentedSnippet = splitted_rawSnippet.map((line) => {
            return indent + line;
        }).join('\n');
        return template.replace(/\$snippet/, indentedSnippet);
    }
}
class Content {
    public mdType: string;
    public rawSnippet: string;

    constructor(mdType: string, rawSnippet: string) {
        this.mdType = mdType;
        this.rawSnippet = rawSnippet;
    }

    static parseSelectedText(eol: string, selectedText: string): Content | string {
        selectedText = selectedText.trim();
        if (!selectedText.startsWith('```') || !selectedText.endsWith('```')) {
            return 'Selection is not started with ``` or is not ended with ```';
        }

        // remove markers
        selectedText = selectedText.replace(/^```/, '').replace(/```$/, '');

        let splitted_selectedText = selectedText.split(eol);

        // modify snippet: remove the last line: normally that is empty line.
        let lastline = splitted_selectedText.pop();

        // when there isn't even filetype line, lastline will be undefined.
        // splitted_snippet must contain snippet body other than type, so it is
        // needed to have more than 1 element.

        if (// even filetype is not present --- just blank, or
            lastline === undefined ||
            // there is filetype but no body, or
            splitted_selectedText.length === 0 ||
            // there is filetype but no line except trailing empty line
            (lastline === '' && splitted_selectedText.length === 1)
        ) {
            // then selected snippet doesn't contain any code to run.
            return 'No code to run.';
        }

        // if the last line is not empty, push it again.
        if (lastline !== '') {
            splitted_selectedText.push(lastline);
        }

        // parse filetype specified at just after the beginning marker
        let mdType = splitted_selectedText[0];
        if (mdType === '') {
            return 'No filetype detected.';
        }

        let rawSnippet = splitted_selectedText.slice(1).join('\n');

        return new Content(mdType, rawSnippet);
    }
}