import * as vscode from 'vscode';
import MakefileSymbolProvider from './makefile';
import * as log from './log';

const langId = "makefile";
const DocumentSelector = { language: 'makefile' };
const provider = new MakefileSymbolProvider()
export function activate(context: vscode.ExtensionContext) {
	log.getConfig();

	context.subscriptions.push(
		log.outputChannel,
		vscode.languages.registerDocumentSymbolProvider(DocumentSelector, provider),
		vscode.languages.registerDefinitionProvider(DocumentSelector, provider),
		vscode.languages.registerHoverProvider(DocumentSelector, provider),
		vscode.workspace.onDidSaveTextDocument(async (document) => {
			if (document.languageId == langId) {
				provider.updateFileCache(document.uri.toString())
			}
		}),
		vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (document.languageId == langId) {
				provider.readFile(document)
			}
		}),
		vscode.workspace.onDidChangeTextDocument(async (event) => {
			if (event.contentChanges.length > 0 && event.document.languageId == langId) {
				provider.readFile(event.document)
			}
		}),
	)
}

export function deactivate() { 
	log.info("deactivate")
}
