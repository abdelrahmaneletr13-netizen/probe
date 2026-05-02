import * as vscode from "vscode";
import type { SessionManager } from "../session/manager.js";
import type { Session } from "../api/types.js";

export class SessionsTreeProvider implements vscode.TreeDataProvider<Session> {
  private _onDidChange = new vscode.EventEmitter<Session | undefined>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private manager: SessionManager) {
    manager.onDidChange(() => this._onDidChange.fire(undefined));
  }

  getTreeItem(s: Session): vscode.TreeItem {
    const item = new vscode.TreeItem(s.name, vscode.TreeItemCollapsibleState.None);
    item.description = s.scope.length ? s.scope.join(", ") : "no scope";
    item.tooltip = `${s.id}\nCreated ${s.createdAt}`;
    item.contextValue = "session";
    item.id = s.id;
    item.iconPath = new vscode.ThemeIcon("folder-active");
    return item;
  }

  getChildren(): Session[] {
    return this.manager.getSessions();
  }
}
