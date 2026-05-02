import * as vscode from "vscode";
import type { RunRecord } from "../api/types.js";
import type { SessionManager } from "../session/manager.js";

const STATUS_ICON: Record<RunRecord["status"], string> = {
  queued: "clock",
  running: "sync~spin",
  succeeded: "pass",
  failed: "error",
  cancelled: "circle-slash",
  timeout: "warning",
};

export class RunsTreeProvider implements vscode.TreeDataProvider<RunRecord> {
  private _onDidChange = new vscode.EventEmitter<RunRecord | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private manager: SessionManager) {
    manager.onDidChange(() => this._onDidChange.fire(undefined));
  }

  getTreeItem(r: RunRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(`${r.toolId} → ${r.target}`, vscode.TreeItemCollapsibleState.None);
    item.description = r.status;
    item.tooltip = `${r.command.join(" ")}\nstarted ${r.startedAt}`;
    item.contextValue = "run";
    item.id = r.id;
    item.iconPath = new vscode.ThemeIcon(STATUS_ICON[r.status] ?? "circle-outline");
    item.command = {
      command: "pentestIde.openRunOutput",
      title: "Open output",
      arguments: [r],
    };
    return item;
  }

  getChildren(): RunRecord[] {
    return this.manager.getRuns();
  }
}
