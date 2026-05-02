/**
 * Minimal vscode shim so unit tests can import modules that pull in vscode
 * indirectly. Tests must not exercise tree views or commands.
 */
export const window = {
  showErrorMessage: () => undefined,
  showInformationMessage: () => undefined,
  showWarningMessage: () => undefined,
};
export const workspace = {
  getConfiguration: () => ({ get: () => undefined, update: async () => undefined }),
};
export const commands = {
  registerCommand: () => ({ dispose: () => undefined }),
};
export class EventEmitter<T> {
  event = (_l: (e: T) => void) => ({ dispose: () => undefined });
  fire(_e: T) {}
}
export class ThemeIcon {
  constructor(public id: string) {}
}
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
export class TreeItem {
  constructor(public label: string, public collapsibleState?: number) {}
}
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
