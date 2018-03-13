'use strict';

import * as vscode from 'vscode';
import { isString } from 'util';

export function runMarkdownSnippet() {
    let editor = vscode.window.activeTextEditor;
    let selection = editor !== undefined ? editor.selection : undefined;
    if (editor === undefined || selection === undefined) {
        vscode.window.showInformationMessage('No code selected.');
        return;
    }

    let snippet = editor.document.getText(selection);
    let content = Content.parseSnippet(snippet);
    if (isString(content)) {
        let error = content;
        vscode.window.showInformationMessage(error);
        return;
    }
    console.log(content);
    
    let uri = editor.document.uri;
    if (uri === undefined || uri.scheme !== 'file') {
        vscode.window.showInformationMessage('Opened file is not placed at the local filesystem.');
        return;
    }
    let config = vscode.workspace.getConfiguration("markdown-run-snippet");

    // generate temporary file path
    let extension = content.filetype; // do something to get extension from filetype.
    let tmppath = gentmppath(uri, extension);
    // vscode.commands.executeCommand('code-runner.run', tmppath);
}

class Content {
    public filetype: string;
    public content: string;

    constructor(filetype: string, content: string) {
        this.filetype = filetype;
        this.content = content;
    }

    static parseSnippet(orig_snippet: string): Content | string {
        // unimplemented!
        let snippet = orig_snippet.trim();
        if (!snippet.startsWith('```') || !snippet.endsWith('```')) {
            return "Selection is not started with ``` or is not ended with ```";
        }
        
        snippet = snippet.replace(/^```/, '').replace(/```$/, '');

        let splitted_snippet = snippet.split('\n');
        if (splitted_snippet.length == 0) {
            return 'No string inside ```s.';
        }

        let filetype = splitted_snippet[0];
        if (filetype === "") {
            return "No filetype detected.";
        }
        let content = splitted_snippet.slice(1).join('\n');
        
        return new Content(filetype, content);
    }
}

function gentmppath(uri: vscode.Uri, ext: string): string {
    let fsPath = uri.fsPath;
    return (dirname(fsPath) + '/' + genrndname() + "." + ext);
}

function dirname(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/[^\/]*$/, '');
}

function genrndname(): string {
    return 'junk_' + Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
}