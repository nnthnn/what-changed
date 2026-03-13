import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execAsync = promisify(exec);

const SCHEME = "whatchanged";

/** URI format: whatchanged://diff?ref=...&repo=...&path=... (all in query to avoid path-segment issues) */
export function uriForRef(
  repoRoot: string,
  ref: string,
  relativePath: string,
): vscode.Uri {
  const q = new URLSearchParams({
    ref,
    repo: repoRoot,
    path: relativePath,
  });
  return vscode.Uri.parse(`${SCHEME}://diff?${q.toString()}`);
}

function parseDiffUri(
  uri: vscode.Uri,
): { ref: string; repoRoot: string; relativePath: string } | null {
  const q = new URLSearchParams(uri.query);
  const ref = q.get("ref") ?? "HEAD";
  const repoRoot = q.get("repo") ?? "";
  const relativePath = q.get("path") ?? "";
  if (!repoRoot || !relativePath) return null;
  return { ref, repoRoot, relativePath };
}

export function registerGitDocumentProvider(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    provideTextDocumentContent: async (uri: vscode.Uri): Promise<string> => {
      const parsed = parseDiffUri(uri);
      if (!parsed) return "";
      const { ref, repoRoot, relativePath } = parsed;
      try {
        const { stdout } = await execAsync(`git show ${ref}:${relativePath}`, {
          cwd: repoRoot,
          maxBuffer: 5 * 1024 * 1024,
        });
        return stdout;
      } catch {
        return "(file not in this ref or binary)";
      }
    },
  });
}
