import * as vscode from "vscode";
import { BackendClient } from "./api/client.js";
import { ChatPanel } from "./chat/panel.js";
import { registerCommands } from "./commands.js";
import { FindingsStore } from "./findings/store.js";
import { OutputManager } from "./output.js";
import { SessionManager } from "./session/manager.js";
import { RunsTreeProvider } from "./views/runsView.js";
import { SessionsTreeProvider } from "./views/sessionsView.js";
import { ToolsTreeProvider } from "./views/toolsView.js";

export async function activate(context: vscode.ExtensionContext) {
  const client = new BackendClient(readConfig());
  const manager = new SessionManager(client);
  const output = new OutputManager(context);
  const findings = new FindingsStore(context);

  const sessions = new SessionsTreeProvider(manager);
  const tools = new ToolsTreeProvider(manager);
  const runs = new RunsTreeProvider(manager);

  const refreshConfig = async () => {
    client.update(readConfig());
  };

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("pentestIde.sessions", sessions),
    vscode.window.registerTreeDataProvider("pentestIde.tools", tools),
    vscode.window.registerTreeDataProvider("pentestIde.runs", runs),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("pentestIde")) client.update(readConfig());
    }),
    vscode.commands.registerCommand("pentestIde.openChat", () => {
      ChatPanel.open({
        client,
        manager,
        output,
        findings,
        context,
        refreshConfig,
      });
    }),
  );

  registerCommands(context, client, manager, output, findings, refreshConfig);

  if (readConfig().apiKey) {
    manager.refresh().catch((err) => {
      vscode.window.showWarningMessage(`Pentest IDE: initial refresh failed (${(err as Error).message})`);
    });
  } else {
    vscode.window
      .showInformationMessage(
        "Pentest IDE is installed. Open the chat to get started.",
        "Open Chat",
      )
      .then((choice) => {
        if (choice === "Open Chat") {
          vscode.commands.executeCommand("pentestIde.openChat");
        }
      });
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
