# vscode-markdown-run-snippet

Run snippets in your markdown document.

## Features

* Running code snippet in Markdown file

## Usages

Markdown has syntax for code snippets:

    ```language
    your_code.goes_here();
    ```

1. Select the whole snippet (including the marker: \`\`\`).
1. Run `Run Snippet in Markdown` from command palette.

This extension automatically open new untitled document. Its content is the
snippet, filetype is the one specified at just after
beginning marker (`language` part of beginning marker ` ```language `). Inserted snippet is modified based on language-specific template from the
original (surrounded by \`\`\`) snippet.

## Requirements

This extension depends on the following extension:

* [Code Runner](https://github.com/formulahendry/vscode-code-runner)

    Great extension to run opening code snippet. Running the extracted snippet is
    all done by this extension. Can be installed from MarketPlace.

## Extension Settings

* `markdown-run-snippet.mdToVscodeTypeMap`

    Example:

    ```json
     "markdown-run-snippet.mdToVscodeTypeMap": {
        "cpp": "C++"
    }
    ```

    Map from language specified in Markdown to Visual Studio Code's filetype.
    If there is no entry, the same string is used as Visual Studio Code's filetype.

* `markdown-run-snippet.mdTypeToTemplateMap`

    Example:

    ```json
    "markdown-run-snippet.mdTypeToTemplateMap": {
        "rust": "fn main() {\n    $snippet\n}"
    }
    ```

    Map from language specified in Markdown to template (that will be applied to
    the snippet). Template feature is useful for importing common modules,
    including common headers, defining main() function. selected snippet will be
    placed at the position of `$snippet`. The leading ' '(whitespace) before
    `$snippet` is important, because the same amount of ' ' will be prepended to
    all lines of selected snippet.

Configurations defined by default are very very few.

## Known Issues

## Release Notes

### 0.0.1

Initial release