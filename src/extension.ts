import * as vscode from 'vscode';
import * as path from 'path';
import { WhatChangedProvider, ChangedFileElement } from './tree';
import { registerGitDocumentProvider, uriForRef } from './gitDocumentProvider';

let treeFullyExpanded = true;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WhatChangedProvider();

  const treeView = vscode.window.createTreeView('whatChangedFiles', {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    treeView,
    registerGitDocumentProvider(),
    vscode.commands.registerCommand('whatChanged.refresh', async () => {
      await provider.load();
    }),
    vscode.commands.registerCommand('whatChanged.collapseOrExpandAll', async () => {
      if (treeFullyExpanded) {
        await vscode.commands.executeCommand('workbench.actions.treeView.whatChangedFiles.collapseAll');
        treeFullyExpanded = false;
      } else {
        const root = provider.getRootElement();
        if (root) {
          await treeView.reveal(root, { expand: 10 });
          treeFullyExpanded = true;
        }
      }
    }),
    vscode.commands.registerCommand('whatChanged.toggleViewMode', async () => {
      const config = vscode.workspace.getConfiguration('whatChanged');
      const current = config.get<'flat' | 'tree'>('viewMode') ?? 'flat';
      await config.update('viewMode', current === 'flat' ? 'tree' : 'flat', vscode.ConfigurationTarget.Global);
      provider.refresh();
    }),
    vscode.commands.registerCommand('whatChanged.setComparisonBranch', async () => {
      const config = vscode.workspace.getConfiguration('whatChanged');
      const current = config.get<string>('mainBranch') ?? 'main';
      const branch = await vscode.window.showInputBox({
        title: 'Comparison branch',
        prompt: 'Branch to compare against (e.g. main, develop)',
        value: current,
        placeHolder: 'main',
      });
      if (branch !== undefined && branch.trim() !== '') {
        await config.update('mainBranch', branch.trim(), vscode.ConfigurationTarget.Global);
        await provider.load();
      }
    }),
    vscode.commands.registerCommand('whatChanged.openFile', (element: ChangedFileElement) => {
      if (!element) return;
      const fsPath = path.resolve(element.repoRoot, element.file.path);
      vscode.window.showTextDocument(vscode.Uri.file(fsPath));
    }),
    vscode.commands.registerCommand('whatChanged.diffWithMain', async (element?: ChangedFileElement) => {
      let target = element;
      if (!target && treeView.selection.length > 0) {
        const sel = treeView.selection[0];
        if (sel && 'file' in sel && 'repoRoot' in sel) target = sel as ChangedFileElement;
      }
      if (!target) return;
      const fsPath = path.resolve(target.repoRoot, target.file.path);
      const mainBranch = vscode.workspace.getConfiguration('whatChanged').get<string>('mainBranch') ?? 'main';
      const leftUri = uriForRef(target.repoRoot, mainBranch, target.file.path);
      const hasUncommitted = ['modified', 'staged', 'untracked'].includes(target.file.workingStatus);
      const rightUri = hasUncommitted
        ? vscode.Uri.file(fsPath)
        : uriForRef(target.repoRoot, 'HEAD', target.file.path);
      const rightLabel = hasUncommitted ? 'working' : 'branch';
      const title = `${target.file.path} (${mainBranch} ↔ ${rightLabel})`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    }),
  );

  provider.load();
}

export function deactivate(): void {}
