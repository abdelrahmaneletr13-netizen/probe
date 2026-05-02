import * as vscode from "vscode";
import type { ToolDescriptor } from "../api/types.js";
import type { SessionManager } from "../session/manager.js";

export class ToolsTreeProvider implements vscode.TreeDataProvider<ToolDescriptor> {
  private _onDidChange = new vscode.EventEmitter<ToolDescriptor | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private manager: SessionManager) {
    manager.onDidChange(() => this._onDidChange.fire(undefined));
  }

  getTreeItem(t: ToolDescriptor): vscode.TreeItem {
    const item = new vscode.TreeItem(t.label, vscode.TreeItemCollapsibleState.None);
    item.description = t.category;
    item.tooltip = t.description;
    item.contextValue = "tool";
    item.id = t.id;
    item.iconPath = new vscode.ThemeIcon("zap");
    item.command = {
      command: "pentestIde.runTool",
      title: "Run",
      arguments: [t],
    };
    return item;
  }

  getChildren(): ToolDescriptor[] {
    return this.manager.getTools();
  }
}
