# What Changed

A VS Code extension that shows what branch you're on, which base branch you're comparing to (e.g. `main` or `develop`), and all files changed in your branch—with their current state (modified, staged, etc.). Open files quickly and view diffs against the base branch.

## Features

- **Branch info** – Current branch and configurable base branch (default: `main`)
- **Changed files list** – All files that differ from the base branch, with status:
  - In-branch status: added, modified, deleted, renamed, etc.
  - Working tree state: staged, modified, untracked, or unchanged
- **Quick open** – Click a file (or use the Open action) to open it for editing
- **Diff** – Use "Compare with Base Branch" on a file to open a side-by-side diff against the base branch

## Configuration

- **`whatChanged.mainBranch`** – The base branch to compare against (e.g. `main`, `develop`, `master`). Default: `main`.
- **`whatChanged.viewMode`** – How to show changed files: `flat` (single list) or `tree` (collapsible folders). Default: `flat`. You can also toggle this with the button in the view title.
- **`whatChanged.pathFilter`** – Only show files whose path contains this text. Leave empty to show all.
- **`whatChanged.copyPathsFormat`** – When copying changed file paths: `relative`, `absolute`, or `prompt` (ask each time). Default: `prompt`.

## Usage

1. Open the **What Changed** view from the Activity Bar (branch/diff icon).
2. The view shows: `your-branch ← main` and the list of changed files.
3. Click a file to open it, or use the diff icon to compare with the base branch.
4. Use the refresh icon in the view title to reload.
5. Use the **...** menu in the view title → **Change comparison branch...** to compare against a different base (e.g. `develop` instead of `main`).

## Ideas for future improvements

**Quick wins** *(implemented)*
- **Commit count** – Branch row shows "X ahead" and "Y behind" when relevant.
- **Copy paths** – Use **...** → **Copy changed file paths...** to copy relative or absolute paths.
- **Focus view** – **Alt+Shift+W** (Option+Shift+W on Mac) focuses the view; customize in Keyboard Shortcuts.
- **Stash hint** – When you have stashes, the branch row shows "N stash(es)".

**Filtering & display**
- **Filter by path** – Text box or setting to only show paths matching a pattern (e.g. `src/`, `*.ts`).
- **Filter by status** – Toggle to show only modified, only staged, or only untracked.
- **Sort options** – Sort by path, status, or “recently changed” (if we can get mtime).

**Diff & compare**
- **Open all diffs** – Command to open the diff view for every changed file (e.g. in a second editor group).
- **Diff stats** – Show +/- line counts per file in the tree (from `git diff --stat`).
- **Compare with another branch** – Quick pick to temporarily compare against a branch other than the configured base.

**Workflow**
- **Per-workspace base branch** – Store comparison branch per workspace (e.g. `develop` here, `main` there).
- **Open all changed files** – Open all changed files in the editor at once (current group or new group).
- **Stage / unstage from view** – Inline or context menu to stage or unstage the selected file.
- **Reveal in Explorer** – Context menu to show the file in the file explorer.

**Polish**
- **Badge on activity bar icon** – Show the number of changed files on the What Changed icon.
- **Empty state** – Friendly message and “Change comparison branch” when there are no changes.
- **Multi-root workspace** – Support multiple repo roots (one What Changed section per folder or a single merged list).

## Development

This project uses [pnpm](https://pnpm.io/). Install dependencies and build:

```bash
pnpm install
pnpm run compile
```

### Running in Cursor / VS Code

**Option A – Run from source (recommended)**  
Open this folder in Cursor, press **F5**. A new window (Extension Development Host) opens with the extension loaded. Use the What Changed view there. No install step.

**Option B – Install as an extension (use in any window)**  
Build a `.vsix` and install it so the extension is available in every Cursor window:

```bash
pnpm install
pnpm run package
```

Then in Cursor:

1. **Command Palette** (`Cmd+Shift+P` / `Ctrl+Shift+P`) → **Extensions: Install from VSIX...**
2. Select the generated `what-changed-0.1.0.vsix` in the project root.

Or from the terminal (Cursor only):

```bash
cursor --install-extension /path/to/what-changed/what-changed-0.1.0.vsix
```

If `pnpm run package` fails (e.g. due to a vsce secret-scan bug), use **Option A** (F5) to run from source.

## Before committing

Run the checklist so the tree compiles and passes lint:

```bash
pnpm run check
```

This runs `compile` then `lint` (Biome). Use `pnpm run format` to format code with Biome. Optionally run the extension (F5) and click through the view to confirm nothing is broken.

## Requirements

- VS Code 1.74+
- Git in `PATH`
- A workspace folder that is a Git repository (or inside one)
