import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export type FileChangeKind = 'A' | 'M' | 'D' | 'R' | 'C' | 'U' | '?';
export type WorkingTreeStatus = 'staged' | 'modified' | 'untracked' | 'unchanged';

export interface ChangedFile {
  /** Path relative to repo root */
  path: string;
  /** Status in branch diff: A=added, M=modified, D=deleted, etc. */
  kind: FileChangeKind;
  /** Working tree state (staged, modified, untracked, or unchanged) */
  workingStatus: WorkingTreeStatus;
  /** Rename/copy target path if kind is R or C */
  renamePath?: string;
}

export interface BranchInfo {
  currentBranch: string;
  mainBranch: string;
  repoRoot: string;
  changedFiles: ChangedFile[];
  error?: string;
}

function getMainBranch(): string {
  return vscode.workspace.getConfiguration('whatChanged').get<string>('mainBranch') ?? 'main';
}

function getRepoRoot(workspaceRoot: string): Promise<string> {
  return execAsync('git rev-parse --show-toplevel', { cwd: workspaceRoot })
    .then(({ stdout }) => stdout.trim())
    .catch(() => workspaceRoot);
}

function getCurrentBranch(repoRoot: string): Promise<string> {
  return execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot })
    .then(({ stdout }) => stdout.trim())
    .catch(() => '');
}

/** Returns list of files changed vs main branch: path, kind (A/M/D/...). Includes committed, staged, and unstaged changes. */
function getBranchDiffFiles(repoRoot: string, mainBranch: string): Promise<Array<{ path: string; kind: FileChangeKind; renamePath?: string }>> {
  return execAsync(`git diff --name-status ${mainBranch}`, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 })
    .then(({ stdout }) => {
      const lines = stdout.trim().split('\n').filter(Boolean);
      return lines.map((line): { path: string; kind: FileChangeKind; renamePath?: string } => {
        const tab = line.indexOf('\t');
        const status = tab >= 0 ? line.slice(0, tab) : line;
        const rest = tab >= 0 ? line.slice(tab + 1) : '';
        const kind = (status[0] ?? '?') as FileChangeKind;
        const paths = rest.split('\t').filter(Boolean);
        const path1 = paths[0] ?? '';
        const path2 = paths[1];
        if (kind === 'R' || kind === 'C') {
          return { path: path2 ?? path1, kind, renamePath: path1 };
        }
        return { path: path1, kind };
      });
    })
    .catch(() => []);
}

export interface StatusEntry {
  path: string;
  workingStatus: WorkingTreeStatus;
  /** X and Y from short status (e.g. ' M', 'A ', '??') */
  indexStatus: string;
  workTreeStatus: string;
}

/** Parses git status --porcelain; returns working tree status per file and the list of all changed paths. */
function getWorkingTreeStatus(repoRoot: string): Promise<{ statusMap: Map<string, WorkingTreeStatus>; statusEntries: StatusEntry[] }> {
  return execAsync('git status --porcelain -u', { cwd: repoRoot, maxBuffer: 2 * 1024 * 1024 })
    .then(({ stdout }) => {
      const statusMap = new Map<string, WorkingTreeStatus>();
      const statusEntries: StatusEntry[] = [];
      for (const line of stdout.trim().split('\n').filter(Boolean)) {
        const indexStatus = line.slice(0, 1);
        const workTreeStatus = line.slice(1, 2);
        const raw = line.slice(2);
        const file = raw.replace(/^\s+/, '').replace(/^"|"$/g, '').trim();
        const filePath = file.split(' -> ').pop() ?? file;
        let workingStatus: WorkingTreeStatus;
        if (line.startsWith('??')) {
          workingStatus = 'untracked';
        } else if (indexStatus !== ' ' && indexStatus !== '.') {
          workingStatus = 'staged';
        } else if (workTreeStatus !== ' ' && workTreeStatus !== '.') {
          workingStatus = 'modified';
        } else {
          workingStatus = 'unchanged';
        }
        statusMap.set(filePath, workingStatus);
        statusEntries.push({ path: filePath, workingStatus, indexStatus, workTreeStatus });
      }
      return { statusMap, statusEntries };
    })
    .catch(() => ({ statusMap: new Map(), statusEntries: [] }));
}

/** Infer diff kind from git status XY (e.g. M=modified, A=added, D=deleted). */
function statusToKind(index: string, workTree: string): FileChangeKind {
  const c = index !== ' ' && index !== '?' ? index : workTree;
  if (c === 'A' || c === '?') return 'A';
  if (c === 'D') return 'D';
  if (c === 'M' || c === 'U') return 'M';
  if (c === 'R' || c === 'C') return c;
  return 'M';
}

export async function getBranchInfo(): Promise<BranchInfo | null> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return null;
  }
  const workspaceRoot = folder.uri.fsPath;
  const mainBranch = getMainBranch();

  try {
    const repoRoot = await getRepoRoot(workspaceRoot);
    const [currentBranch, diffFiles, statusResult] = await Promise.all([
      getCurrentBranch(repoRoot),
      getBranchDiffFiles(repoRoot, mainBranch),
      getWorkingTreeStatus(repoRoot),
    ]);
    const { statusMap, statusEntries } = statusResult;

    if (!currentBranch) {
      return {
        currentBranch: '(no branch)',
        mainBranch,
        repoRoot,
        changedFiles: [],
        error: 'Not a git repository or detached HEAD',
      };
    }

    const byPath = new Map<string, ChangedFile>();
    for (const f of diffFiles) {
      byPath.set(f.path, {
        path: f.path,
        kind: f.kind,
        renamePath: f.renamePath,
        workingStatus: statusMap.get(f.path) ?? 'unchanged',
      });
    }
    for (const e of statusEntries) {
      if (!byPath.has(e.path)) {
        byPath.set(e.path, {
          path: e.path,
          kind: statusToKind(e.indexStatus, e.workTreeStatus),
          workingStatus: e.workingStatus,
        });
      }
    }
    const changedFiles = Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));

    return {
      currentBranch,
      mainBranch,
      repoRoot,
      changedFiles,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      currentBranch: '',
      mainBranch,
      repoRoot: workspaceRoot,
      changedFiles: [],
      error: message,
    };
  }
}

/** Resolve full path for a file relative to repo. */
export function resolveRepoPath(repoRoot: string, relativePath: string): string {
  return path.resolve(repoRoot, relativePath);
}
