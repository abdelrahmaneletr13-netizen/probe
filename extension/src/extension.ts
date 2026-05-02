import * as vscode from "vscode";
import { BackendClient } from "./api/client.js";
import { registerCommands } from "./commands.js";
import { OutputManager } from "./output.js";
import { SessionManager } from "./session/manager.js";
import { RunsTreeProvider } from "./views/runsView.js";
import { SessionsTreeProvider } from "./views/sessionsView.js";
import { ToolsTreeProvider } from "./views/toolsView.js";

export async function activate(context: vscode.ExtensionContext) {
  const client = new BackendClient(readConfig());
  const manager = new SessionManager(client);
  const output = new OutputManager(context);

  const sessions = new SessionsTreeProvider(manager);
  const tools = new ToolsTreeProvider(manager);
  const runs = new RunsTreeProvider(manager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pentestIde.sessions", sessions),
    vscode.window.registerTreeDataProvider("pentestIde.tools", tools),
    vscode.window.registerTreeDataProvider("pentestIde.runs", runs),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pentestIde")) client.update(readConfig());
    }),
  );

  registerCommands(context, client, manager, output, async () => {
    client.update(readConfig());
  });

  if (readConfig().apiKey) {
    manager.refresh().catch((err) => {
      vscode.window.showWarningMessage(`Pentest IDE: initial refresh failed (${(err as Error).message})`);
    });
  } else {
    vscode.window.showInformationMessage(
      "Pentest IDE is installed. Run 'Pentest IDE: Connect to backend' to get started.",
    );
  }
}

export function deactivate() {
  /* nothing to clean up beyond context.subscriptions */
}

function readConfig() {
  const cfg = vscode.workspace.getConfiguration("pentestIde");
  return {
    baseUrl: (cfg.get<string>("backendUrl") ?? "").replace(/\/+$/, ""),
    apiKey: cfg.get<string>("apiKey") ?? "",
    timeoutMs: cfg.get<number>("requestTimeoutMs") ?? 15_000,
  };
}
