import * as vscode from 'vscode';
import * as path from 'path';
import type { BranchInfo, ChangedFile } from './git';

export type TreeElement = BranchInfoElement | FolderElement | ChangedFileElement;

export class BranchInfoElement {
  constructor(public readonly info: BranchInfo) {}
}

/** Folder in the changed-files tree (path prefix like "src" or "src/utils"). May be a merged path like "fish/.config/fish". */
export class FolderElement {
  constructor(
    /** Path prefix for this folder, e.g. "src" or "fish/.config/fish" */
    public readonly pathPrefix: string,
    public readonly info: BranchInfo,
    /** When true (root-level only), label shows full path with " / " between segments. */
    public readonly isRootLevel = false,
  ) {}
  /** Display label: root-level shows "fish / .config / fish"; nested shows last segment only (e.g. "functions"). */
  get label(): string {
    if (this.isRootLevel && this.pathPrefix.includes('/')) {
      return this.pathPrefix.split('/').join(' / ');
    }
    return this.pathPrefix.includes('/') ? this.pathPrefix.split('/').pop()! : this.pathPrefix;
  }
  /** Whether any changed file is under this folder (or is this path). */
  hasChanges(): boolean {
    const prefix = this.pathPrefix + '/';
    return this.info.changedFiles.some(
      (f) => f.path === this.pathPrefix || f.path.startsWith(prefix),
    );
  }
}

export class ChangedFileElement {
  constructor(
    public readonly file: ChangedFile,
    public readonly repoRoot: string,
  ) {}
}

function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    A: 'added',
    M: 'modified',
    D: 'deleted',
    R: 'renamed',
    C: 'copied',
    U: 'unmerged',
    '?': 'unknown',
  };
  return labels[kind] ?? kind;
}

function workingStatusLabel(s: string): string {
  const labels: Record<string, string> = {
    staged: 'staged',
    modified: 'modified',
    untracked: 'untracked',
    unchanged: '',
  };
  return labels[s] ?? '';
}

function getViewMode(): 'flat' | 'tree' {
  return vscode.workspace.getConfiguration('whatChanged').get<'flat' | 'tree'>('viewMode') ?? 'flat';
}

/** Root-level and direct children under a path prefix. */
function getChildPaths(
  changedFiles: ChangedFile[],
  pathPrefix: string,
): { folders: string[]; files: ChangedFile[] } {
  const prefix = pathPrefix ? pathPrefix + '/' : '';
  const folders = new Set<string>();
  const files: ChangedFile[] = [];
  for (const f of changedFiles) {
    if (!f.path.startsWith(prefix) && (prefix !== '' || f.path.includes('/'))) continue;
    const rest = prefix ? f.path.slice(prefix.length) : f.path;
    if (rest.includes('/')) {
      folders.add(rest.split('/')[0]!);
    } else {
      files.push(f);
    }
  }
  return {
    folders: Array.from(folders).sort(),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Collapse single-folder chains: return merged path (e.g. fish/.config/fish) so empty intermediates are grouped. */
function mergeSingleFolderChain(
  changedFiles: ChangedFile[],
  pathPrefix: string,
  firstSegment: string,
): string {
  let full = pathPrefix ? `${pathPrefix}/${firstSegment}` : firstSegment;
  for (;;) {
    const { folders, files } = getChildPaths(changedFiles, full);
    if (files.length > 0 || folders.length !== 1) return full;
    full = `${full}/${folders[0]!}`;
  }
}

/** Like getChildPaths but folder list is merged (single-folder chains collapsed). */
function getChildPathsMerged(
  changedFiles: ChangedFile[],
  pathPrefix: string,
): { folders: string[]; files: ChangedFile[] } {
  const raw = getChildPaths(changedFiles, pathPrefix);
  const mergedFolders = raw.folders.map((seg) =>
    mergeSingleFolderChain(changedFiles, pathPrefix, seg),
  );
  const unique = Array.from(new Set(mergedFolders)).sort();
  return { folders: unique, files: raw.files };
}

export class WhatChangedProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private branchInfo: BranchInfo | null = null;

  refresh(): void {
    void this.load();
  }

  async load(): Promise<void> {
    const { getBranchInfo } = await import('./git');
    this.branchInfo = await getBranchInfo();
    this._onDidChangeTreeData.fire();
  }

  /** Root tree element (branch info row), or null if not loaded. Used for expand-all. */
  getRootElement(): BranchInfoElement | null {
    return this.branchInfo ? new BranchInfoElement(this.branchInfo) : null;
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element instanceof BranchInfoElement) {
      const info = element.info;
      const label = info.error
        ? `Error: ${info.error}`
        : `${info.currentBranch} ← ${info.mainBranch}`;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = info.error ? undefined : `${info.changedFiles.length} file(s) changed`;
      item.contextValue = 'branchInfo';
      item.tooltip = info.error
        ? info.error
        : `Current branch: ${info.currentBranch}\nBase branch: ${info.mainBranch}\n${info.changedFiles.length} file(s) changed`;
      return item;
    }

    if (element instanceof FolderElement) {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.contextValue = 'folder';
      if (element.hasChanges()) {
        item.iconPath = new vscode.ThemeIcon(
          'folder',
          new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'),
        );
        item.resourceUri = vscode.Uri.file(path.join(element.info.repoRoot, element.pathPrefix));
      } else {
        item.iconPath = vscode.ThemeIcon.Folder;
      }
      item.tooltip = element.pathPrefix;
      return item;
    }

    if (element instanceof ChangedFileElement) {
      const { file, repoRoot } = element;
      const parts: string[] = [kindLabel(file.kind)];
      const ws = workingStatusLabel(file.workingStatus);
      if (ws) parts.push(ws);
      const isTree = getViewMode() === 'tree';
      const label = isTree && file.path.includes('/') ? file.path.split('/').pop()! : file.path;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.description = parts.join(' · ');
      item.tooltip = `${file.path}\n${parts.join(' · ')}`;
      item.resourceUri = vscode.Uri.file(path.resolve(repoRoot, file.path));
      item.contextValue = 'changedFile';
      item.command = {
        command: 'whatChanged.openFile',
        title: 'Open',
        arguments: [element],
      };
      return item;
    }

    return new vscode.TreeItem('', vscode.TreeItemCollapsibleState.None);
  }

  getParent(element: TreeElement): TreeElement | undefined {
    if (!this.branchInfo) return undefined;
    const info = this.branchInfo;
    if (element instanceof BranchInfoElement) return undefined;
    if (element instanceof FolderElement) {
      const idx = element.pathPrefix.lastIndexOf('/');
      if (idx === -1) return new BranchInfoElement(info);
      return new FolderElement(element.pathPrefix.slice(0, idx), info);
    }
    if (element instanceof ChangedFileElement) {
      if (getViewMode() === 'flat') return new BranchInfoElement(info);
      const dir = element.file.path.includes('/')
        ? element.file.path.split('/').slice(0, -1).join('/')
        : '';
      if (!dir) return new BranchInfoElement(info);
      return new FolderElement(dir, info);
    }
    return undefined;
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!this.branchInfo) {
      await this.load();
    }
    const info = this.branchInfo;
    if (!info) {
      return [];
    }

    if (!element) {
      return [new BranchInfoElement(info)];
    }

    if (element instanceof BranchInfoElement) {
      if (getViewMode() === 'flat') {
        return info.changedFiles.map((f) => new ChangedFileElement(f, info.repoRoot));
      }
      const { folders, files } = getChildPathsMerged(info.changedFiles, '');
      const folderEls = folders.map((mergedPath) => new FolderElement(mergedPath, info, true));
      const fileEls = files.map((f) => new ChangedFileElement(f, info.repoRoot));
      return [...folderEls, ...fileEls];
    }

    if (element instanceof FolderElement) {
      const { folders, files } = getChildPathsMerged(
        element.info.changedFiles,
        element.pathPrefix,
      );
      const folderEls = folders.map((mergedPath) => new FolderElement(mergedPath, element.info));
      const fileEls = files.map((f) => new ChangedFileElement(f, element.info.repoRoot));
      return [...folderEls, ...fileEls];
    }

    return [];
  }
}
