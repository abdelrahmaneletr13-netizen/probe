import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { BackendError, type BackendClient } from "./api/client.js";
import type { RunRecord, Session, ToolDescriptor } from "./api/types.js";
import type { SessionManager } from "./session/manager.js";
import type { OutputManager } from "./output.js";
import type { FindingsStore } from "./findings/store.js";
import { FindingsPanel } from "./findings/panel.js";
import type { Severity } from "./findings/types.js";
import { clearDemoBackendState } from "./chat/demoReset.js";
import { ChatPanel } from "./chat/panel.js";

export function registerCommands(
  context: vscode.ExtensionContext,
  client: BackendClient,
  manager: SessionManager,
  output: OutputManager,
  findings: FindingsStore,
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

  reg("pentestIde.resetDemo", async () => {
    await clearDemoBackendState({ refreshConfig, manager });
    ChatPanel.touchPaletteDemoReset();
  });

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

    const normalizedUrl = normalizeBackendUrl(url.trim());
    if (!normalizedUrl) {
      vscode.window.showErrorMessage("Pentest IDE: Invalid backend URL. Use http://localhost:8787");
      return;
    }

    const cfg = vscode.workspace.getConfiguration("pentestIde");
    await cfg.update("backendUrl", normalizedUrl, vscode.ConfigurationTarget.Global);
    await cfg.update("apiKey", apiKey.trim(), vscode.ConfigurationTarget.Global);
    await refreshConfig();
    await manager.refresh();
    vscode.window.showInformationMessage("Connected to Pentest IDE backend.");
  });

  reg("pentestIde.configureLlm", async () => {
    const pick = await vscode.window.showQuickPick(
      [{ label: "Enable + set LLM API key…" }, { label: "Disable LLM planner" }],
      {
        title: "Pentest IDE chat — LLM",
        placeHolder: "Uses OpenAI-compatible POST …/v1/chat/completions",
      },
    );
    if (!pick) return;
    const workspaceCfg = vscode.workspace.getConfiguration("pentestIde");

    if (pick.label.startsWith("Disable")) {
      await workspaceCfg.update("llmEnabled", false, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        "Pentest IDE: LLM disabled. Chat falls back to command patterns.",
      );
      return;
    }

    const llmKey = await vscode.window.showInputBox({
      prompt: "LLM API key (sent only to the LLM provider, not Pentest IDE backend)",
      password: true,
      ignoreFocusOut: true,
      value: workspaceCfg.get<string>("llmApiKey") ?? "",
    });
    if (!llmKey?.trim()) {
      vscode.window.showWarningMessage("No key — unchanged.");
      return;
    }

    const baseRaw = await vscode.window.showInputBox({
      prompt: "Chat completions API base URL",
      ignoreFocusOut: true,
      value: workspaceCfg.get<string>("llmApiBaseUrl") ?? "https://api.openai.com/v1",
    });
    const modelPick = await vscode.window.showInputBox({
      prompt: "Model ID",
      ignoreFocusOut: true,
      value: workspaceCfg.get<string>("llmModel") ?? "gpt-4o-mini",
    });
    await workspaceCfg.update("llmApiKey", llmKey.trim(), vscode.ConfigurationTarget.Global);
    await workspaceCfg.update("llmEnabled", true, vscode.ConfigurationTarget.Global);
    if (baseRaw?.trim()) {
      await workspaceCfg.update(
        "llmApiBaseUrl",
        baseRaw.trim(),
        vscode.ConfigurationTarget.Global,
      );
    }
    if (modelPick?.trim()) {
      await workspaceCfg.update(
        "llmModel",
        modelPick.trim(),
        vscode.ConfigurationTarget.Global,
      );
    }
    vscode.window.showInformationMessage(
      "Pentest IDE: LLM chat planner enabled.",
    );
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

  reg("pentestIde.openFindings", async () => {
    FindingsPanel.open(context, findings);
  });

  reg("pentestIde.addFinding", async (...args) => {
    const run = pickRun(args);
    const sessions = manager.getSessions();
    const session = run
      ? sessions.find((s) => s.id === run.sessionId)
      : undefined;

    const title = await vscode.window.showInputBox({
      prompt: "Finding title",
      placeHolder: "e.g. Open port 8080 — Tomcat manager exposed",
      ignoreFocusOut: true,
    });
    if (!title) return;

    const severityPick = await vscode.window.showQuickPick(
      ["critical", "high", "medium", "low", "info"] as Severity[],
      { placeHolder: "Severity" },
    );
    if (!severityPick) return;

    const notes = await vscode.window.showInputBox({
      prompt: "Notes (optional)",
      ignoreFocusOut: true,
    });

    findings.add({
      sessionId: session?.id ?? run?.sessionId ?? "unknown",
      runId: run?.id ?? "manual",
      toolId: run?.toolId ?? "manual",
      target: run?.target ?? "unknown",
      title,
      severity: severityPick as Severity,
      notes: notes ?? "",
    });
    vscode.window.showInformationMessage(`Finding "${title}" recorded.`);
    FindingsPanel.open(context, findings);
  });

  reg("pentestIde.exportFindings", async () => {
    const all = findings.getAll();
    if (all.length === 0) {
      vscode.window.showInformationMessage("No findings to export.");
      return;
    }
    const md = [
      "# Pentest Findings\n",
      `_exported ${new Date().toISOString()}_\n`,
      "| Severity | Target | Tool | Title | Notes |",
      "| --- | --- | --- | --- | --- |",
      ...all.map((f) =>
        `| **${f.severity}** | ${f.target} | ${f.toolId} | ${f.title} | ${f.notes.replace(/\n/g, "<br>")} |`,
      ),
    ].join("\n");

    const dest = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(process.env.HOME ?? "~", "findings.md")),
      filters: { Markdown: ["md"] },
    });
    if (!dest) return;
    fs.writeFileSync(dest.fsPath, md, "utf-8");
    vscode.window.showInformationMessage(`Findings exported to ${dest.fsPath}`);
    vscode.env.openExternal(dest);
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

function normalizeBackendUrl(value: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\/+$|\s+/g, "");
  const url = /^https?:\/\//i.test(normalized) ? normalized : `http://${normalized}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}
