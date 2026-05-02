import * as vscode from "vscode";
import { BackendError, type BackendClient } from "./api/client.js";
import type { RunRecord, Session, ToolDescriptor } from "./api/types.js";
import type { SessionManager } from "./session/manager.js";
import type { OutputManager } from "./output.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  client: BackendClient,
  manager: SessionManager,
  output: OutputManager,
  refreshConfig: () => Promise<void>,
) {
  const reg = (id: string, fn: (...args: unknown[]) => Promise<void>) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...args) => {
        try {
          await fn(...args);
        } catch (err) {
          showError(err);
        }
      }),
    );

  reg("pentestIde.signIn", async () => {
    const url = await vscode.window.showInputBox({
      prompt: "Backend URL",
      value: vscode.workspace.getConfiguration("pentestIde").get("backendUrl") ?? "",
      ignoreFocusOut: true,
    });
    if (!url) return;
    const apiKey = await vscode.window.showInputBox({
      prompt: "API key",
      password: true,
      ignoreFocusOut: true,
    });
    if (!apiKey) return;

    const cfg = vscode.workspace.getConfiguration("pentestIde");
    await cfg.update("backendUrl", url.trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("apiKey", apiKey.trim(), vscode.ConfigurationTarget.Global);
    await refreshConfig();
    await manager.refresh();
    vscode.window.showInformationMessage("Connected to Pentest IDE backend.");
  });

  reg("pentestIde.refresh", async () => {
    await manager.refresh();
  });

  reg("pentestIde.createSession", async () => {
    const name = await vscode.window.showInputBox({
      prompt: "Session name",
      placeHolder: "acme-engagement",
      ignoreFocusOut: true,
    });
    if (!name) return;

    const scopeRaw = await vscode.window.showInputBox({
      prompt: "Scope (comma-separated hostnames or IPs, optional)",
      placeHolder: "example.com, 203.0.113.10",
      ignoreFocusOut: true,
    });
    const scope = (scopeRaw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const session = await manager.createSession({ name, scope });
    vscode.window.showInformationMessage(`Created session "${session.name}".`);
  });

  reg("pentestIde.deleteSession", async (...args) => {
    const session = pickSession(args);
    if (!session) return;
    const ok = await vscode.window.showWarningMessage(
      `Delete session "${session.name}" and its run history?`,
      { modal: true },
      "Delete",
    );
    if (ok !== "Delete") return;
    await manager.deleteSession(session.id);
  });

  reg("pentestIde.runTool", async (...args) => {
    const tool = pickTool(args);
    if (!tool) return;

    const sessions = manager.getSessions();
    if (sessions.length === 0) {
      vscode.window.showWarningMessage("Create a session first.");
      return;
    }

    const sessionPick = await vscode.window.showQuickPick(
      sessions.map((s) => ({ label: s.name, description: s.scope.join(", "), session: s })),
      { placeHolder: "Choose a session" },
    );
    if (!sessionPick) return;

    const target = await vscode.window.showInputBox({
      prompt: `Target for ${tool.label}`,
      value: sessionPick.session.scope[0] ?? "",
      ignoreFocusOut: true,
    });
    if (!target) return;

    const collected: Record<string, string | number | boolean> = {};
    for (const arg of tool.argsSchema) {
      const val = await promptArg(arg);
      if (val === undefined) return;
      if (val !== "") collected[arg.name] = val;
    }

    const run = await client.startRun({
      sessionId: sessionPick.session.id,
      toolId: tool.id,
      target,
      args: collected,
    });
    manager.recordRun(run);
    streamRun(client, manager, output, run);
  });

  reg("pentestIde.cancelRun", async (...args) => {
    const run = pickRun(args);
    if (!run) return;
    await client.cancelRun(run.sessionId, run.id);
    vscode.window.showInformationMessage(`Cancelled ${run.toolId} ${run.target}.`);
    await manager.refresh();
  });

  reg("pentestIde.openRunOutput", async (...args) => {
    const run = pickRun(args);
    if (!run) return;
    output.channelFor(run).show(true);
  });
}

function streamRun(
  client: BackendClient,
  manager: SessionManager,
  output: OutputManager,
  run: RunRecord,
) {
  const channel = output.channelFor(run);
  channel.show(true);

  client
    .streamRun(run.sessionId, run.id, {
      onChunk: (c) => channel.append(c.data),
      onEnd: (final) => {
        channel.appendLine("");
        channel.appendLine(`# finished: ${final.status} (exit ${final.exitCode ?? "n/a"})`);
        manager.recordRun(final);
      },
      onError: (err) => {
        channel.appendLine(`# stream error: ${err.message}`);
      },
    })
    .catch((err) => {
      // toErr handled above; surface only the unexpected
      channel.appendLine(`# stream failed: ${(err as Error).message}`);
    });
}

async function promptArg(arg: ToolDescriptor["argsSchema"][number]): Promise<string | number | boolean | undefined> {
  if (arg.type === "boolean") {
    const pick = await vscode.window.showQuickPick(["true", "false"], {
      placeHolder: `${arg.label}${arg.help ? ` — ${arg.help}` : ""}`,
    });
    if (pick === undefined) return undefined;
    return pick === "true";
  }
  if (arg.type === "enum") {
    const pick = await vscode.window.showQuickPick(arg.options ?? [], {
      placeHolder: `${arg.label}${arg.help ? ` — ${arg.help}` : ""}`,
    });
    return pick;
  }
  const value = await vscode.window.showInputBox({
    prompt: `${arg.label}${arg.help ? ` — ${arg.help}` : ""}`,
    value: arg.default !== undefined ? String(arg.default) : "",
    ignoreFocusOut: true,
  });
  if (value === undefined) return undefined;
  if (arg.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      vscode.window.showErrorMessage(`${arg.label} must be a number`);
      return undefined;
    }
    return n;
  }
  return value;
}

function pickSession(args: unknown[]): Session | undefined {
  const candidate = args[0] as Partial<Session> | undefined;
  if (candidate && typeof candidate.id === "string") return candidate as Session;
  return undefined;
}

function pickTool(args: unknown[]): ToolDescriptor | undefined {
  const candidate = args[0] as Partial<ToolDescriptor> | undefined;
  if (candidate && typeof candidate.id === "string" && Array.isArray(candidate.argsSchema)) {
    return candidate as ToolDescriptor;
  }
  return undefined;
}

function pickRun(args: unknown[]): RunRecord | undefined {
  const candidate = args[0] as Partial<RunRecord> | undefined;
  if (candidate && typeof candidate.id === "string" && typeof candidate.sessionId === "string") {
    return candidate as RunRecord;
  }
  return undefined;
}

function showError(err: unknown) {
  if (err instanceof BackendError) {
    vscode.window.showErrorMessage(`Pentest IDE: ${err.message} (${err.status})`);
  } else if (err instanceof Error) {
    vscode.window.showErrorMessage(`Pentest IDE: ${err.message}`);
  } else {
    vscode.window.showErrorMessage("Pentest IDE: unknown error");
  }
}
