'use strict';

import * as fs from 'fs';
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

    // unselect all
    editor.selection = new vscode.Selection(editor.selection.active, editor.selection.active);
    console.log(`current selection: ${editor.selection.active} - ${editor.selection.anchor}`);
    // delete editor.selection;

    let content = Content.parseSnippet(eol, snippet);
    if (isString(content)) {
        let error = content;
        vscode.window.showInformationMessage(error);
        return;
    }
    
    // get current active file's uri
    let uri = editor.document.uri;
    if (uri === undefined || uri.scheme !== 'file') {
        vscode.window.showInformationMessage('Opened file is not placed at the local filesystem.');
        return;
    }

    // get configuration
    let config = vscode.workspace.getConfiguration('markdown-run-snippet');
    let finalized = FinalizedContent.finalize(config, eol, content);
    if (isString(finalized)) {
        vscode.window.showInformationMessage(finalized);
        return;
    }

    // run it!
    // let tmppath = gentmppath(uri, finalized.extension);
    // fs.writeFileSync(tmppath, finalized.templateAppliedContent);
    vscode.workspace.openTextDocument({
        language: finalized.filetype,
        content: finalized.templateAppliedContent
    }).then((doc) => {
        vscode.window.showTextDocument(doc).then(() => {
            vscode.commands.executeCommand('code-runner.run').then(() => {
                // fs.unlinkSync(tmppath);
            });
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
    public filetype: string;
    public extension: string;
    public originalContent: string;
    public templateAppliedContent: string;

    constructor(filetype: string, extension: string, originalContent: string, templateAppliedContent: string) {
        this.filetype = filetype;
        this.extension = extension;
        this.originalContent = originalContent;
        this.templateAppliedContent = templateAppliedContent;
    }

    public static finalize(cfg: vscode.WorkspaceConfiguration, eol: string, content: Content): FinalizedContent | string {
        let filetype = content.filetype;
        let extension = FinalizedContent.toExt(cfg, content);
        let originalContent = content.content;
        let templateAppliedContent = FinalizedContent
                .applyTemplate(cfg, content)
                .replace(/\n/g, eol);

        if (extension === undefined) {
            return `Extension for filetype ${filetype} is not defined.`;
        } else {
            return new FinalizedContent(filetype, extension, originalContent, templateAppliedContent);
        }
    }

    private static toExt(cfg: vscode.WorkspaceConfiguration, content: Content): string | undefined {
        let typeToExtMap = cfg.get<any>('typeToExtMap');
        return typeToExtMap[content.filetype];
    }

    private static applyTemplate(cfg: vscode.WorkspaceConfiguration, content: Content): string {
        let typeToTemplateMap = cfg.get<any>('typeToTemplateMap');
        let template = typeToTemplateMap[content.filetype];
        if (template === undefined) {
            return content.content;
        }
        return template.replace(/\$snippet/, content.content);
    }
}
class Content {
    public filetype: string;
    public content: string;

    constructor(filetype: string, content: string) {
        this.filetype = filetype;
        this.content = content;
    }

    static parseSnippet(eol: string, orig_snippet: string): Content | string {
        let snippet = orig_snippet.trim();
        if (!snippet.startsWith('```') || !snippet.endsWith('```')) {
            return 'Selection is not started with ``` or is not ended with ```';
        }
        
        snippet = snippet.replace(/^```/, '').replace(/```$/, '');

        let splitted_snippet = snippet.split(eol);
        if (splitted_snippet.length === 0) {
            return 'No string inside ```s.';
        }

        let filetype = splitted_snippet[0];
        if (filetype === '') {
            return 'No filetype detected.';
        }
        let content = splitted_snippet.slice(1).join('\n');
        
        return new Content(filetype, content);
    }
}

function gentmppath(uri: vscode.Uri, ext: string): string {
    let fsPath = uri.fsPath;
    return (dirname(fsPath) + '/' + genrndname() + '.' + ext);
}

function dirname(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/[^\/]*$/, '');
}

function genrndname(): string {
    return 'junk_' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
}