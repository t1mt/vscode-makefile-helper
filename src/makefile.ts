import * as vscode from 'vscode';
import * as fs from "fs";
import { exec } from "child_process";
import * as log from "./log"
import * as pathname from 'path';

const start = new vscode.Position(0, 0);
const cache = new Map<string, Map<string, Variable[]>>();

class MakefileSymbolProvider implements vscode.DocumentSymbolProvider, vscode.DefinitionProvider, vscode.HoverProvider {
    private readonly specialTargets = [
        '.PHONY', '.SUFFIXES', '.DEFAULT', '.PRECIOUS', '.INTERMEDIATE', '.NOTINTERMEDIATE',
        '.SECONDARY', '.SECONDEXPANSION', '.DELETE_ON_ERROR', '.IGNORE', '.LOW_RESOLUTION_TIME',
        '.SILENT', '.EXPORT_ALL_VARIABLES', '.NOTPARALLEL', '.ONESHELL', '.POSIX',
    ];
    private readonly targetPattern = /^([^:#=\s]+)\s*:[^=]*$/;
    private readonly variablePattern = /^([^:#=\s]+)\s*(=|:=|::=|:::=|[?]=).*$/;
    private readonly referencePattern = /^[^:#=\s]+\s*\$[\(\{]?([^:#=\s]+)[\)\}]?\s+.*$/;
    private readonly functionPattern = /^define\s+([^:#=\s]+)\s*$/;
    private readonly includePattern = /^include\s+([^:#=\s]+)\s*$/;
    private readonly functionCallPattern = /^[^:#=]+\s*\$\(call\s(\w+).*\).*$/;
    private readonly wordRangePattern = /([^:#=\s]+)/;

    private variables: Map<string, Variable[]> = new Map();
    private includes: Map<string, string> = new Map();

    provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken)
        : Thenable<vscode.SymbolInformation[]> {
        return new Promise((resolve, reject) => {
            const symbols: vscode.SymbolInformation[] = [];

            for (let i = 0; i < document.lineCount; i++) {
                const line = document.lineAt(i);
                if (this.matchTarget(document, line, symbols)) {
                    continue;
                }
                if (this.matchVariable(document, line, symbols)) {
                    continue;
                }
                this.matchFunction(document, line, symbols);
            }
            log.info("prase document symbols", document.fileName)
            resolve(symbols);
        });
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
        this.readFile(document)

        const variable = document.getText(document.getWordRangeAtPosition(position, this.wordRangePattern));

        return new Promise((resolve, reject) =>
            !token.isCancellationRequested
                ? resolve(this.getDefinitions(variable, document, position))
                : reject()
        );
    }

    private async getDefinitions(variable: string, document: vscode.TextDocument, position: vscode.Position) {
        this.readFile(document)
        const range = document.getWordRangeAtPosition(position, this.wordRangePattern);
        const selector = document.getText(range);
        return await this.getDefinition(document.fileName, selector);
    }

    public getDefinition(filename: string, variable: string): vscode.ProviderResult<vscode.Definition> {
        let res: vscode.Location[] = new Array();
        this.getVariable(filename, variable)?.forEach((it) => { res.push(it.getVscodeLocation()) });

        return res;
    }

    provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
        const variable = document.getText(document.getWordRangeAtPosition(position, this.wordRangePattern));
        return this.getHover(variable, position, document);
    }

    private matchTarget(
        document: vscode.TextDocument,
        line: vscode.TextLine,
        symbols: vscode.SymbolInformation[],
    ): boolean {
        const match = line.text.match(this.targetPattern);
        if (!match) {
            return false;
        }

        const target = match[1];
        // exclude special targets from outline
        if (this.specialTargets.includes(target)) {
            return true;
        }

        symbols.push(new vscode.SymbolInformation(
            target,
            vscode.SymbolKind.Field,
            '',
            new vscode.Location(document.uri, line.range)
        ));
        return true;
    }

    private matchVariable(
        document: vscode.TextDocument,
        line: vscode.TextLine,
        symbols: vscode.SymbolInformation[],
    ): boolean {
        const match = line.text.match(this.variablePattern);
        if (!match) {
            return false;
        }

        const variable = match[1];

        symbols.push(new vscode.SymbolInformation(
            variable,
            vscode.SymbolKind.Variable,
            '',
            new vscode.Location(document.uri, line.range)
        ));
        return true;
    }

    private matchFunction(
        document: vscode.TextDocument,
        line: vscode.TextLine,
        symbols: vscode.SymbolInformation[],
    ): boolean {
        const match = line.text.match(this.functionPattern);
        if (!match) {
            return false;
        }

        const func = match[1];

        symbols.push(new vscode.SymbolInformation(
            func,
            vscode.SymbolKind.Function,
            '',
            new vscode.Location(document.uri, line.range)
        ));
        return true;
    }

    readFile(document: vscode.TextDocument) {
        const filename = document.fileName
        const v = cache.get(filename)
        if (v != undefined) {
            return
        }
        log.info("parse document definition", document.fileName)
        this.updateFileCache(document.fileName)
    }

    updateFileCache(filename: string) {
        if (!fs.existsSync(filename)) {
            return
        }

        let res: string = ""
        let content = fs.readFileSync(filename, 'utf8');
        const regexp = /#.*$/gm;
        res = content.replace(regexp, "");  // trim comment lines

        const lines = res.split(/\r?\n/gm);
        const regexpNewLine = /\\\s*/gm;
        for (let i = lines.length - 1; i >= 0; i--) {
            const match = lines[i].match(regexpNewLine);
            if (!match) {
                continue;
            }
            const nextLine = lines[i + 1].match(/\b(.*)/g);
            if (nextLine) {
                lines[i] = lines[i].replace(regexpNewLine, nextLine[1]);
            }
            regexpNewLine.lastIndex = 0;
            lines[i + 1] = lines[i + 1].replace(/.*/g, "");
        }

        for (let ln = 0; ln < lines.length; ln++) {
            if (lines[ln].length == 0) {
                continue;
            }

            if (lines[ln].match(this.variablePattern)) {
                this.addVariable(filename, lines[ln], ln);

            } else if (lines[ln].match(this.referencePattern)) {
                const match = this.referencePattern.exec(lines[ln])
                if (match != null) {
                    const name: string = match[1];
                    const type: string = "reference";
                    const value: string = "";
                    const index: number = match.index + match[0].indexOf(match[1])
                    const v = new Variable(name, type, value, filename, ln, index);

                    if (!this.variables.has(name)) {
                        this.variables.set(name, new Array());
                    }
                    this.variables.get(name)?.push(v);
                }

            } else if (lines[ln].match(this.includePattern)) {
                log.info("Found import other makefile: " + lines[ln]);
                let include = lines[ln].match(this.includePattern);
                if (include != null) {
                    this.parseIncludeMakefile(filename, include[1]);
                }

            } else if (lines[ln].match(this.targetPattern)) {
                const match = this.targetPattern.exec(lines[ln])
                if (match != null) {
                    const name: string = match[1];
                    const type: string = "target";
                    const value: string = "";
                    const index: number = match.index + match[0].indexOf(match[1])
                    const v = new Variable(name, type, value, filename, ln, index);

                    if (!this.variables.has(name)) {
                        this.variables.set(name, new Array());
                    }
                    this.variables.get(name)?.push(v);
                }
            
            } else if (lines[ln].match(this.functionPattern)) {
                const match = this.functionPattern.exec(lines[ln]);
                if (match != null) {
                    const name: string = match[1];
                    const type: string = "function";
                    const value: string = "";
                    const index: number = match.index + match[0].indexOf(match[1])
                    const v = new Variable(name, type, value, filename, ln, index);

                    if (!this.variables.has(name)) {
                        this.variables.set(name, new Array());
                    }
                    this.variables.get(name)?.push(v);
                }

            } else if (lines[ln].match(this.functionCallPattern)) {
                const match = this.functionCallPattern.exec(lines[ln]);
                if (match != null) {
                    const name: string = match[1];
                    const type: string = "call";
                    const value: string = "";
                    const index: number = match.index + match[0].indexOf(match[1])
                    const v = new Variable(name, type, value, filename, ln, index);

                    if (!this.variables.has(name)) {
                        this.variables.set(name, new Array());
                    }
                    this.variables.get(name)?.push(v);
                }
            }
        }

        cache.set(filename, this.variables)
        log.info("cache Makefile " + filename)
    }
    

    //https://www.gnu.org/software/make/manual/html_node/Include.html
    private parseIncludeMakefile(rootPath: string, path: string) {
        let absPath = path;
        if (!pathname.isAbsolute(path)) {
            absPath = pathname.join(pathname.dirname(rootPath), path)
        }

        this.includes.set(absPath, "")

        let vv = cache.get(absPath);
        if (vv) {
            log.info("read included Makefile from cache : " + absPath);
            return
        }
        this.updateFileCache(absPath);
        log.info("included Makefile processed : " + absPath);
    }

    private addVariable(filename: string, line: string, line_idx: number) {
        const regexp = /(\w+)\s*([:+?]?)=(.*)/g;
        let res = regexp.exec(line);

        if (res != null) {
            let name: string = res[1];
            let type: string = res[2];
            let value: string = res[3];
            let index: number = res.index + res[0].indexOf(res[1])
            let v = new Variable(name, type, value, filename, line_idx, index);

            if (!this.variables.has(name)) {
                this.variables.set(name, new Array());
            }
            this.variables.get(name)?.push(v);
        }

        regexp.lastIndex = 0;
    }

    private getVariable(filename: string, variable: string): Variable[] {
        let res: Variable[] = new Array();
        const items = this.variables.get(variable);
        items?.forEach(element => res.push(element));

        this.includes.forEach((v, key) => {
            const maps = cache.get(key)

            maps?.forEach((val, varname) => {
                if (varname == variable) {
                    res.push(...val)
                }
            })
        });
        return res;
    }

    public getHover(variable: string, vsPosition: vscode.Position, doc: vscode.TextDocument): vscode.ProviderResult<vscode.Hover> {
        let items = this.getVariable(doc.fileName, variable);
        
        if (items) {
            let md = new vscode.MarkdownString();
            md.appendCodeblock(variable, "Makefile");
            md.appendText("expands to:");
            let res = this.extractValueOfVariable(variable, doc.fileName, vsPosition.line);
            if (res != null) {
                md.appendCodeblock(res, "Makefile");
                return new vscode.Hover(md);
            }
        }

        return null;
    }

    private extractValueOfVariable(variable: string, filename: string, line: number): string | null {
        let items = this.getVariable(filename, variable);

        if (items) {
            let i = 0;
            for (; i < items.length; i++) {
                if (items[i].line >= line) {
                    break;
                }
            }
            i--;

            if (i < 0) return null;

            let values = items[i].getValue();

            let regexpInnerVars = /\$[{\(](\w+)[\)}]/g;
            if (regexpInnerVars.test(values)) {
                regexpInnerVars.lastIndex = 0;
                let regexpRes = regexpInnerVars.exec(values);
                while (regexpRes) {
                    let extracted = this.extractValueOfVariable(regexpRes[1], items[i].file, items[i].line);
                    if (extracted != null) {
                        values = values.replace(regexpRes[0], extracted);
                    }
                    regexpRes = regexpInnerVars.exec(values);
                }
                regexpInnerVars.lastIndex = 0;
            }

            return values;
        }

        return null;
    }

}


class Variable {

    public readonly name: string;
    public readonly type: string;
    public readonly file: string;
    public readonly line: number;
    public readonly position: number;
    public readonly value: string;

    public constructor(name: string, type: string, value: string, file: string, line: number, position: number) {
        this.file = file;
        this.name = name;
        this.type = type;
        this.line = line;
        this.position = position;
        this.value = value.trimStart();

    }

    public getValue(): string {
        return this.value;
    }

    public getVscodeLocation(): vscode.Location {
        let from = new vscode.Position(this.line, this.position);
        let to = new vscode.Position(this.line, this.position + this.name.length);

        return new vscode.Location(vscode.Uri.file(this.file), new vscode.Range(from, to));
    }
}

export default MakefileSymbolProvider;
