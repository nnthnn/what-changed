import * as path from "node:path";
import * as vscode from "vscode";
import { registerGitDocumentProvider, uriForRef } from "./gitDocumentProvider";
import { type ChangedFileElement, WhatChangedProvider } from "./tree";

let treeFullyExpanded = true;

function updateBadge(
  provider: import("./tree").WhatChangedProvider,
  treeView: vscode.TreeView<import("./tree").TreeElement>,
): void {
  const count = provider.getDisplayedFileCount();
  if (count > 0) {
    treeView.badge = { value: count, tooltip: `${count} changed file(s)` };
  } else {
    treeView.badge = undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new WhatChangedProvider();

  const treeView = vscode.window.createTreeView("whatChangedFiles", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });

  context.subscriptions.push(
    treeView,
    registerGitDocumentProvider(),
    vscode.commands.registerCommand("whatChanged.refresh", async () => {
      await provider.load();
      updateBadge(provider, treeView);
    }),
    vscode.commands.registerCommand(
      "whatChanged.collapseOrExpandAll",
      async () => {
        if (treeFullyExpanded) {
          await vscode.commands.executeCommand(
            "workbench.actions.treeView.whatChangedFiles.collapseAll",
          );
          treeFullyExpanded = false;
        } else {
          const root = provider.getRootElement();
          if (root) {
            await treeView.reveal(root, { expand: 10 });
            treeFullyExpanded = true;
          }
        }
      },
    ),
    vscode.commands.registerCommand("whatChanged.toggleViewMode", async () => {
      const config = vscode.workspace.getConfiguration("whatChanged");
      const current = config.get<"flat" | "tree">("viewMode") ?? "flat";
      await config.update(
        "viewMode",
        current === "flat" ? "tree" : "flat",
        vscode.ConfigurationTarget.Global,
      );
      provider.refresh();
    }),
    vscode.commands.registerCommand("whatChanged.copyPaths", async () => {
      await provider.load();
      const config = vscode.workspace.getConfiguration("whatChanged");
      const format = config.get<string>("copyPathsFormat") ?? "prompt";
      let absolute: boolean;
      if (format === "relative") absolute = false;
      else if (format === "absolute") absolute = true;
      else {
        const choice = await vscode.window.showQuickPick(
          [
            { label: "Relative paths", value: false },
            { label: "Absolute paths", value: true },
          ],
          {
            title: "Copy changed file paths as...",
            placeHolder: "Relative paths",
          },
        );
        if (choice === undefined) return;
        absolute = choice.value;
      }
      let paths = provider.getChangedFilePaths(absolute);
      const pathFilter = (config.get<string>("pathFilter") ?? "").trim();
      if (pathFilter) paths = paths.filter((p) => p.includes(pathFilter));
      if (paths.length === 0) {
        vscode.window.showInformationMessage(
          pathFilter
            ? "No paths match the current filter."
            : "No changed files to copy.",
        );
        return;
      }
      await vscode.env.clipboard.writeText(paths.join("\n"));
      vscode.window.showInformationMessage(
        `Copied ${paths.length} path(s) to clipboard.`,
      );
    }),
    vscode.commands.registerCommand("whatChanged.focusView", () => {
      vscode.commands.executeCommand("workbench.view.extension.what-changed");
    }),
    vscode.commands.registerCommand("whatChanged.setPathFilter", async () => {
      const config = vscode.workspace.getConfiguration("whatChanged");
      const current = config.get<string>("pathFilter") ?? "";
      const value = await vscode.window.showInputBox({
        title: "Filter by path",
        prompt:
          "Only show files whose path contains this text (e.g. src/, .ts). Leave empty to show all.",
        value: current,
        placeHolder: "e.g. src/ or .ts",
      });
      if (value !== undefined) {
        await config.update(
          "pathFilter",
          value.trim(),
          vscode.ConfigurationTarget.Workspace,
        );
        provider.refresh();
        updateBadge(provider, treeView);
      }
    }),
    vscode.commands.registerCommand("whatChanged.setStatusFilter", async () => {
      const config = vscode.workspace.getConfiguration("whatChanged");
      const current =
        config.get<"all" | "modified" | "staged" | "untracked">(
          "statusFilter",
        ) ?? "all";
      const choice = await vscode.window.showQuickPick(
        [
          { label: "All", value: "all" as const },
          { label: "Modified", value: "modified" as const },
          { label: "Staged", value: "staged" as const },
          { label: "Untracked", value: "untracked" as const },
        ],
        {
          title: "Filter by status",
          placeHolder: current === "all" ? "All" : current,
        },
      );
      if (choice !== undefined) {
        await config.update(
          "statusFilter",
          choice.value,
          vscode.ConfigurationTarget.Workspace,
        );
        provider.refresh();
        updateBadge(provider, treeView);
      }
    }),
    vscode.commands.registerCommand(
      "whatChanged.setComparisonBranch",
      async () => {
        const config = vscode.workspace.getConfiguration("whatChanged");
        const current = config.get<string>("mainBranch") ?? "main";
        const branch = await vscode.window.showInputBox({
          title: "Comparison branch",
          prompt: "Branch to compare against (e.g. main, develop)",
          value: current,
          placeHolder: "main",
        });
        if (branch !== undefined && branch.trim() !== "") {
          await config.update(
            "mainBranch",
            branch.trim(),
            vscode.ConfigurationTarget.Global,
          );
          await provider.load();
          updateBadge(provider, treeView);
        }
      },
    ),
    vscode.commands.registerCommand(
      "whatChanged.openFile",
      (element: ChangedFileElement) => {
        if (!element) return;
        const fsPath = path.resolve(element.repoRoot, element.file.path);
        vscode.window.showTextDocument(vscode.Uri.file(fsPath));
      },
    ),
    vscode.commands.registerCommand(
      "whatChanged.diffWithMain",
      async (element?: ChangedFileElement) => {
        let target = element;
        if (!target && treeView.selection.length > 0) {
          const sel = treeView.selection[0];
          if (sel && "file" in sel && "repoRoot" in sel)
            target = sel as ChangedFileElement;
        }
        if (!target) return;
        const fsPath = path.resolve(target.repoRoot, target.file.path);
        const mainBranch =
          vscode.workspace
            .getConfiguration("whatChanged")
            .get<string>("mainBranch") ?? "main";
        const leftUri = uriForRef(
          target.repoRoot,
          mainBranch,
          target.file.path,
        );
        const hasUncommitted = ["modified", "staged", "untracked"].includes(
          target.file.workingStatus,
        );
        const rightUri = hasUncommitted
          ? vscode.Uri.file(fsPath)
          : uriForRef(target.repoRoot, "HEAD", target.file.path);
        const rightLabel = hasUncommitted ? "working" : "branch";
        const title = `${target.file.path} (${mainBranch} ↔ ${rightLabel})`;
        await vscode.commands.executeCommand(
          "vscode.diff",
          leftUri,
          rightUri,
          title,
        );
      },
    ),
  );

  void provider.load().then(() => {
    updateBadge(provider, treeView);
  });

  vscode.workspace.onDidChangeConfiguration((e) => {
    if (
      e.affectsConfiguration("whatChanged.pathFilter") ||
      e.affectsConfiguration("whatChanged.statusFilter")
    ) {
      provider.refresh();
      updateBadge(provider, treeView);
    }
  });
}

export function deactivate(): void {}
