import * as vscode from "vscode";
import { BackendError, type BackendClient } from "../api/client.js";
import type { RunRecord, Session, ToolDescriptor } from "../api/types.js";
import type { SessionManager } from "../session/manager.js";
import type { OutputManager } from "../output.js";
import type { FindingsStore } from "../findings/store.js";
import { FindingsPanel } from "../findings/panel.js";
import type { Severity } from "../findings/types.js";

/**
 * Bus that the router uses to talk back to the chat webview. Implementations
 * forward to `webview.postMessage`. Kept abstract so the router can be unit
 * tested without a real panel.
 */
export interface ChatBus {
  reply(text: string, kind?: ReplyKind): void;
  streamStart(runId: string, header: string): void;
  streamChunk(runId: string, data: string, stream: "stdout" | "stderr"): void;
  streamEnd(runId: string, footer: string, ok: boolean): void;
  setState(state: ChatState): void;
}

export type ReplyKind =
  | "assistant"
  | "system"
  | "error"
  | "success"
  | "info"
  | "markdown";

export interface ChatState {
  connected: boolean;
  baseUrl: string;
  activeSessionId?: string;
  activeSessionName?: string;
  sessionCount: number;
  toolCount: number;
}

export interface RouterDeps {
  client: BackendClient;
  manager: SessionManager;
  output: OutputManager;
  findings: FindingsStore;
  context: vscode.ExtensionContext;
  refreshConfig: () => Promise<void>;
}

/**
 * Parses chat input (slash commands or natural language) and dispatches to
 * the existing BackendClient / SessionManager. Designed so each command is a
 * small async method on the class.
 */
export class ChatRouter {
  private activeSessionId?: string;

  constructor(
    private bus: ChatBus,
    private deps: RouterDeps,
  ) {
    deps.manager.onDidChange(() => this.publishState());
  }

  publishState(): void {
    const sessions = this.deps.manager.getSessions();
    const tools = this.deps.manager.getTools();
    const active = this.activeSessionId
      ? sessions.find((s) => s.id === this.activeSessionId)
      : undefined;
    if (this.activeSessionId && !active) {
      // active session was deleted elsewhere
      this.activeSessionId = undefined;
    }
    this.bus.setState({
      connected: Boolean(this.deps.client.baseUrl) && this.hasApiKey(),
      baseUrl: this.deps.client.baseUrl,
      activeSessionId: active?.id,
      activeSessionName: active?.name,
      sessionCount: sessions.length,
      toolCount: tools.length,
    });
  }

  /** Top-level dispatcher. */
  async handle(rawInput: string): Promise<void> {
    const text = rawInput.trim();
    if (!text) return;

    try {
      const intent = parseIntent(text);
      switch (intent.kind) {
        case "help":
          this.replyHelp();
          return;
        case "status":
          await this.cmdStatus();
          return;
        case "connect":
          await this.cmdConnect(intent.url, intent.apiKey);
          return;
        case "disconnect":
          await this.cmdDisconnect();
          return;
        case "refresh":
          await this.cmdRefresh();
          return;
        case "listSessions":
          this.cmdListSessions();
          return;
        case "listTools":
          this.cmdListTools();
          return;
        case "listRuns":
          this.cmdListRuns();
          return;
        case "createSession":
          await this.cmdCreateSession(intent.name, intent.scope);
          return;
        case "deleteSession":
          await this.cmdDeleteSession(intent.target);
          return;
        case "useSession":
          this.cmdUseSession(intent.target);
          return;
        case "run":
          await this.cmdRun(intent.tool, intent.target, intent.args);
          return;
        case "openOutput":
          this.cmdOpenOutput(intent.index);
          return;
        case "cancel":
          await this.cmdCancel(intent.index);
          return;
        case "findings":
          this.cmdFindings();
          return;
        case "addFinding":
          await this.cmdAddFinding(intent.title, intent.severity, intent.notes);
          return;
        case "unknown":
          this.bus.reply(
            `I didn't recognize \`${text}\`. Type \`help\` to see what I understand.`,
            "info",
          );
          return;
      }
    } catch (err) {
      this.bus.reply(formatError(err), "error");
    }
  }

  // ---------- commands ----------

  private async cmdConnect(url?: string, apiKey?: string) {
    let nextUrl = url ?? "";
    let nextKey = apiKey ?? "";
    if (!nextUrl) {
      const input = await vscode.window.showInputBox({
        prompt: "Backend URL",
        value:
          this.deps.client.baseUrl ||
          (vscode.workspace
            .getConfiguration("pentestIde")
            .get<string>("backendUrl") ?? ""),
        ignoreFocusOut: true,
      });
      if (!input) {
        this.bus.reply("Connect cancelled.", "info");
        return;
      }
      nextUrl = input.trim();
    }
    if (!nextKey) {
      const input = await vscode.window.showInputBox({
        prompt: "API key",
        password: true,
        ignoreFocusOut: true,
      });
      if (!input) {
        this.bus.reply("Connect cancelled.", "info");
        return;
      }
      nextKey = input.trim();
    }

    const normalized = normalizeBackendUrl(nextUrl);
    if (!normalized) {
      this.bus.reply(
        `\`${nextUrl}\` does not look like a valid URL. Try \`http://localhost:8787\`.`,
        "error",
      );
      return;
    }

    const cfg = vscode.workspace.getConfiguration("pentestIde");
    await cfg.update("backendUrl", normalized, vscode.ConfigurationTarget.Global);
    await cfg.update("apiKey", nextKey, vscode.ConfigurationTarget.Global);
    await this.deps.refreshConfig();

    this.bus.reply(`Connecting to \`${normalized}\`…`, "info");
    await this.deps.manager.refresh();
    this.publishState();
    this.bus.reply(
      `Connected. Loaded **${this.deps.manager.getSessions().length}** session(s) and **${this.deps.manager.getTools().length}** tool(s).`,
      "success",
    );
  }

  private async cmdDisconnect() {
    const cfg = vscode.workspace.getConfiguration("pentestIde");
    await cfg.update("apiKey", "", vscode.ConfigurationTarget.Global);
    await this.deps.refreshConfig();
    this.activeSessionId = undefined;
    this.publishState();
    this.bus.reply("Cleared API key. Use `connect` to sign back in.", "info");
  }

  private async cmdStatus() {
    const sessions = this.deps.manager.getSessions();
    const tools = this.deps.manager.getTools();
    const active = this.getActiveSession();
    const lines = [
      `**Backend**: \`${this.deps.client.baseUrl || "(not set)"}\``,
      `**Auth**: ${this.hasApiKey() ? "API key configured" : "no key — run `connect`"}`,
      `**Sessions**: ${sessions.length}`,
      `**Tools**: ${tools.length}`,
      `**Active session**: ${active ? `\`${active.name}\` (${active.id})` : "none — use `use <name>`"}`,
    ];
    this.bus.reply(lines.join("\n"), "markdown");
  }

  private async cmdRefresh() {
    if (!this.hasApiKey()) {
      this.bus.reply(
        "Not connected yet. Run `connect <url> <api-key>` first.",
        "error",
      );
      return;
    }
    await this.deps.manager.refresh();
    this.publishState();
    this.bus.reply(
      `Refreshed: ${this.deps.manager.getSessions().length} session(s), ${this.deps.manager.getTools().length} tool(s), ${this.deps.manager.getRuns().length} run(s) cached.`,
      "success",
    );
  }

  private cmdListSessions() {
    const sessions = this.deps.manager.getSessions();
    if (sessions.length === 0) {
      this.bus.reply(
        "No sessions yet. Try `create session acme-engagement`.",
        "info",
      );
      return;
    }
    const active = this.activeSessionId;
    const lines = sessions.map((s, i) => {
      const marker = s.id === active ? "▶" : " ";
      const scope = s.scope.length ? s.scope.join(", ") : "no scope";
      return `${marker} **${i + 1}.** \`${s.name}\` — ${scope}`;
    });
    this.bus.reply(`### Sessions\n${lines.join("\n")}`, "markdown");
  }

  private cmdListTools() {
    const tools = this.deps.manager.getTools();
    if (tools.length === 0) {
      this.bus.reply(
        "No tools loaded yet. Run `refresh` after connecting.",
        "info",
      );
      return;
    }
    const grouped = new Map<string, ToolDescriptor[]>();
    for (const t of tools) {
      const arr = grouped.get(t.category) ?? [];
      arr.push(t);
      grouped.set(t.category, arr);
    }
    const sections: string[] = ["### Tools"];
    for (const [cat, list] of grouped) {
      sections.push(`**${cat}**`);
      for (const t of list) {
        sections.push(`- \`${t.id}\` — ${t.label}: ${t.description}`);
      }
    }
    sections.push(
      "",
      "_To run, type:_ `run <tool-id> <target>` _e.g._ `run nmap-quick 10.0.0.1`",
    );
    this.bus.reply(sections.join("\n"), "markdown");
  }

  private cmdListRuns() {
    const runs = this.deps.manager.getRuns();
    if (runs.length === 0) {
      this.bus.reply("No runs recorded.", "info");
      return;
    }
    const lines = runs.slice(0, 10).map((r, i) => {
      const when = new Date(r.startedAt).toLocaleTimeString();
      return `**${i + 1}.** [${r.status}] \`${r.toolId}\` → \`${r.target}\` _(${when})_`;
    });
    this.bus.reply(
      `### Recent runs\n${lines.join("\n")}\n\n_To open output:_ \`output 1\``,
      "markdown",
    );
  }

  private async cmdCreateSession(name: string, scope: string[]) {
    if (!this.hasApiKey()) {
      this.bus.reply(
        "Not connected. Run `connect <url> <api-key>` first.",
        "error",
      );
      return;
    }
    if (!name) {
      this.bus.reply("Usage: `create session <name> [scope=host1,host2]`", "error");
      return;
    }
    const session = await this.deps.manager.createSession({ name, scope });
    this.activeSessionId = session.id;
    this.publishState();
    this.bus.reply(
      `Created session \`${session.name}\` and made it active. ${
        scope.length ? `Scope: ${scope.join(", ")}` : "No scope."
      }`,
      "success",
    );
  }

  private async cmdDeleteSession(target: string) {
    const session = this.findSession(target);
    if (!session) {
      this.bus.reply(`No session matches \`${target}\`.`, "error");
      return;
    }
    await this.deps.manager.deleteSession(session.id);
    if (this.activeSessionId === session.id) this.activeSessionId = undefined;
    this.publishState();
    this.bus.reply(`Deleted session \`${session.name}\`.`, "success");
  }

  private cmdUseSession(target: string) {
    const session = this.findSession(target);
    if (!session) {
      this.bus.reply(
        `No session matches \`${target}\`. Type \`sessions\` to list.`,
        "error",
      );
      return;
    }
    this.activeSessionId = session.id;
    this.publishState();
    this.bus.reply(
      `Now using session \`${session.name}\`. Subsequent \`run\` commands will use it.`,
      "success",
    );
  }

  private async cmdRun(
    toolRef: string,
    target: string,
    rawArgs: Record<string, string>,
  ) {
    if (!this.hasApiKey()) {
      this.bus.reply("Not connected. Run `connect` first.", "error");
      return;
    }
    const session = this.getActiveSession();
    if (!session) {
      const sessions = this.deps.manager.getSessions();
      if (sessions.length === 0) {
        this.bus.reply(
          "Create a session first: `create session my-engagement`.",
          "error",
        );
        return;
      }
      this.bus.reply(
        `Pick an active session first: \`use <name>\`. Available: ${sessions.map((s) => `\`${s.name}\``).join(", ")}`,
        "error",
      );
      return;
    }

    const tool = this.findTool(toolRef);
    if (!tool) {
      const known = this.deps.manager.getTools().map((t) => t.id).slice(0, 8);
      this.bus.reply(
        `Unknown tool \`${toolRef}\`. Try one of: ${known.map((t) => `\`${t}\``).join(", ") || "(none — try `tools`)"}`,
        "error",
      );
      return;
    }

    if (!target) {
      this.bus.reply(
        `Usage: \`run ${tool.id} <target> [arg=value ...]\``,
        "error",
      );
      return;
    }

    const args = coerceArgs(tool, rawArgs);
    if (args.error) {
      this.bus.reply(args.error, "error");
      return;
    }

    this.bus.reply(
      `Starting **${tool.label}** against \`${target}\` in session \`${session.name}\`…`,
      "info",
    );

    let run: RunRecord;
    try {
      run = await this.deps.client.startRun({
        sessionId: session.id,
        toolId: tool.id,
        target,
        args: args.value,
      });
    } catch (err) {
      this.bus.reply(formatError(err), "error");
      return;
    }
    this.deps.manager.recordRun(run);

    this.bus.streamStart(
      run.id,
      `$ ${run.command.join(" ")}\n# run ${run.id} • started ${new Date(run.startedAt).toLocaleTimeString()}`,
    );

    // Open the dedicated output channel too so users can grep / search.
    const channel = this.deps.output.channelFor(run);

    this.deps.client
      .streamRun(run.sessionId, run.id, {
        onChunk: (c) => {
          channel.append(c.data);
          const stream = c.type === "stderr" ? "stderr" : "stdout";
          this.bus.streamChunk(run.id, c.data, stream);
        },
        onEnd: (final) => {
          this.deps.manager.recordRun(final);
          const ok = final.status === "succeeded";
          const footer = `# finished: ${final.status} (exit ${final.exitCode ?? "n/a"})`;
          channel.appendLine("");
          channel.appendLine(footer);
          this.bus.streamEnd(run.id, footer, ok);
        },
        onError: (err) => {
          this.bus.streamEnd(run.id, `# stream error: ${err.message}`, false);
        },
      })
      .catch((err) => {
        this.bus.streamEnd(
          run.id,
          `# stream failed: ${(err as Error).message}`,
          false,
        );
      });
  }

  private cmdOpenOutput(index?: number) {
    const runs = this.deps.manager.getRuns();
    if (runs.length === 0) {
      this.bus.reply("No runs to open.", "info");
      return;
    }
    const idx = index !== undefined ? index - 1 : 0;
    const run = runs[idx];
    if (!run) {
      this.bus.reply(`No run #${index}. Type \`runs\` to list.`, "error");
      return;
    }
    this.deps.output.channelFor(run).show(true);
    this.bus.reply(
      `Opened output channel for \`${run.toolId} ${run.target}\` (run ${run.id}).`,
      "success",
    );
  }

  private async cmdCancel(index?: number) {
    const runs = this.deps.manager.getRuns();
    const candidates =
      index !== undefined
        ? [runs[index - 1]]
        : runs.filter((r) => r.status === "running" || r.status === "queued");
    const target = candidates[0];
    if (!target) {
      this.bus.reply("No running run to cancel.", "info");
      return;
    }
    await this.deps.client.cancelRun(target.sessionId, target.id);
    this.bus.reply(
      `Cancellation requested for \`${target.toolId} ${target.target}\`.`,
      "success",
    );
    await this.deps.manager.refresh();
  }

  private cmdFindings() {
    FindingsPanel.open(this.deps.context, this.deps.findings);
    this.bus.reply("Opened findings panel.", "info");
  }

  private async cmdAddFinding(
    title: string,
    severity: Severity,
    notes: string,
  ) {
    const session = this.getActiveSession();
    const lastRun = this.deps.manager.getRuns()[0];
    this.deps.findings.add({
      sessionId: session?.id ?? lastRun?.sessionId ?? "unknown",
      runId: lastRun?.id ?? "manual",
      toolId: lastRun?.toolId ?? "manual",
      target: lastRun?.target ?? "unknown",
      title,
      severity,
      notes,
    });
    this.bus.reply(
      `Recorded finding **${severity}** _${title}_.`,
      "success",
    );
    FindingsPanel.open(this.deps.context, this.deps.findings);
  }

  private replyHelp() {
    this.bus.reply(
      [
        "### Pentest IDE chat",
        "Type natural language or shortcuts:",
        "",
        "**Connection**",
        "- `connect [url] [api-key]` — set backend + auth",
        "- `status` — show current connection",
        "- `refresh` — reload sessions/tools/runs",
        "- `disconnect` — clear API key",
        "",
        "**Sessions**",
        "- `sessions` — list sessions",
        "- `create session <name> [scope=host1,host2]`",
        "- `use <name>` — pick the active session",
        "- `delete session <name>`",
        "",
        "**Tools & runs**",
        "- `tools` — list available tools",
        "- `run <tool-id> <target> [arg=value …]`",
        "- `runs` — recent runs",
        "- `output [n]` — open output for run #n",
        "- `cancel [n]` — cancel run #n (default: last running)",
        "",
        "**Findings**",
        "- `findings` — open findings panel",
        "- `add finding <title> sev=<critical|high|medium|low|info>`",
        "",
        "**Natural language examples**",
        "- _Create a new session named acme-engagement_",
        "- _Run nmap-quick against 10.0.0.1_",
        "- _Show recent runs_",
        "- _Open output for the last run_",
      ].join("\n"),
      "markdown",
    );
  }

  // ---------- helpers ----------

  private hasApiKey(): boolean {
    const cfg = vscode.workspace.getConfiguration("pentestIde");
    return Boolean(cfg.get<string>("apiKey"));
  }

  private getActiveSession(): Session | undefined {
    if (!this.activeSessionId) return undefined;
    return this.deps.manager
      .getSessions()
      .find((s) => s.id === this.activeSessionId);
  }

  private findSession(ref: string): Session | undefined {
    const all = this.deps.manager.getSessions();
    const lower = ref.toLowerCase();
    return (
      all.find((s) => s.id === ref) ??
      all.find((s) => s.name.toLowerCase() === lower) ??
      all.find((s) => s.name.toLowerCase().startsWith(lower))
    );
  }

  private findTool(ref: string): ToolDescriptor | undefined {
    const all = this.deps.manager.getTools();
    const lower = ref.toLowerCase();
    return (
      all.find((t) => t.id.toLowerCase() === lower) ??
      all.find((t) => t.label.toLowerCase() === lower) ??
      all.find((t) => t.id.toLowerCase().startsWith(lower)) ??
      all.find((t) => t.label.toLowerCase().includes(lower))
    );
  }
}

// =====================================================================
// Intent parsing — pure, exported for testability.
// =====================================================================

export type Intent =
  | { kind: "help" }
  | { kind: "status" }
  | { kind: "connect"; url?: string; apiKey?: string }
  | { kind: "disconnect" }
  | { kind: "refresh" }
  | { kind: "listSessions" }
  | { kind: "listTools" }
  | { kind: "listRuns" }
  | { kind: "createSession"; name: string; scope: string[] }
  | { kind: "deleteSession"; target: string }
  | { kind: "useSession"; target: string }
  | {
      kind: "run";
      tool: string;
      target: string;
      args: Record<string, string>;
    }
  | { kind: "openOutput"; index?: number }
  | { kind: "cancel"; index?: number }
  | { kind: "findings" }
  | {
      kind: "addFinding";
      title: string;
      severity: Severity;
      notes: string;
    }
  | { kind: "unknown" };

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];

export function parseIntent(raw: string): Intent {
  const stripped = raw.replace(/^\/+/, "").trim();
  if (!stripped) return { kind: "unknown" };

  // Single-word shortcuts.
  const single = stripped.toLowerCase();
  if (single === "help" || single === "?") return { kind: "help" };
  if (single === "status") return { kind: "status" };
  if (single === "refresh" || single === "reload") return { kind: "refresh" };
  if (single === "disconnect" || single === "logout")
    return { kind: "disconnect" };
  if (single === "sessions" || single === "list sessions")
    return { kind: "listSessions" };
  if (single === "tools" || single === "list tools")
    return { kind: "listTools" };
  if (
    single === "runs" ||
    single === "recent runs" ||
    single === "list runs" ||
    single === "show runs" ||
    single === "show recent runs"
  )
    return { kind: "listRuns" };
  if (single === "findings") return { kind: "findings" };
  if (single === "connect") return { kind: "connect" };

  // connect <url> [key]
  const connectMatch = /^connect\s+(\S+)(?:\s+(\S+))?$/i.exec(stripped);
  if (connectMatch) {
    return { kind: "connect", url: connectMatch[1], apiKey: connectMatch[2] };
  }

  // create (a) (new) session (named|called) <name> [with scope|scope=] <scope>
  const createMatch =
    /^create\s+(?:a\s+|an\s+)?(?:new\s+)?session(?:\s+(?:named|called))?\s+(.+?)(?:\s+(?:with\s+scope\s+|scope=|in\s+scope\s+)(.+))?$/i.exec(
      stripped,
    );
  if (createMatch) {
    const name = createMatch[1].trim().replace(/^["']|["']$/g, "");
    const scopeRaw = (createMatch[2] ?? "").trim();
    const scope = scopeRaw
      ? scopeRaw
          .split(/[\s,]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    return { kind: "createSession", name, scope };
  }

  // delete session <name|id>
  const delMatch = /^(?:delete|remove)\s+session\s+(.+)$/i.exec(stripped);
  if (delMatch) return { kind: "deleteSession", target: delMatch[1].trim() };

  // use|select|switch (to) (session) <name>
  const useMatch =
    /^(?:use|select|switch(?:\s+to)?)\s+(?:session\s+)?(.+)$/i.exec(stripped);
  if (useMatch) {
    const target = useMatch[1].trim();
    if (target) return { kind: "useSession", target };
  }

  // run <tool> <target> [k=v ...]   |   run <tool> against|on|for <target> [k=v ...]
  const runMatch =
    /^run\s+(\S+)\s+(?:against\s+|on\s+|for\s+|on\s+target\s+|target\s+)?(\S+)(?:\s+(.*))?$/i.exec(
      stripped,
    );
  if (runMatch) {
    const tool = runMatch[1];
    const target = runMatch[2];
    const argString = runMatch[3] ?? "";
    return {
      kind: "run",
      tool,
      target,
      args: parseKeyValues(argString),
    };
  }

  // open output [for the last run] | output [n]
  const outputMatch =
    /^(?:open\s+)?output(?:\s+for\s+(?:the\s+)?(?:last\s+)?run)?(?:\s+(\d+))?$/i.exec(
      stripped,
    );
  if (outputMatch) {
    const n = outputMatch[1] ? Number(outputMatch[1]) : undefined;
    return { kind: "openOutput", index: n };
  }

  // cancel [n] | cancel (the) (last) run
  const cancelMatch =
    /^cancel(?:\s+(?:the\s+)?(?:last\s+)?run)?(?:\s+(\d+))?$/i.exec(stripped);
  if (cancelMatch) {
    const n = cancelMatch[1] ? Number(cancelMatch[1]) : undefined;
    return { kind: "cancel", index: n };
  }

  // show|list runs
  if (/^(?:show|list|view)\s+(?:recent\s+)?runs$/i.test(stripped))
    return { kind: "listRuns" };
  if (/^(?:show|list|view)\s+sessions$/i.test(stripped))
    return { kind: "listSessions" };
  if (/^(?:show|list|view)\s+tools$/i.test(stripped))
    return { kind: "listTools" };

  // add finding <title> sev=<sev>
  const findingMatch =
    /^add\s+finding\s+(.+?)(?:\s+sev(?:erity)?=(\w+))?(?:\s+notes?=(.+))?$/i.exec(
      stripped,
    );
  if (findingMatch) {
    const title = findingMatch[1].trim().replace(/^["']|["']$/g, "");
    const sev = (findingMatch[2] ?? "info").toLowerCase() as Severity;
    const severity: Severity = SEVERITIES.includes(sev) ? sev : "info";
    const notes = (findingMatch[3] ?? "").trim();
    return { kind: "addFinding", title, severity, notes };
  }

  return { kind: "unknown" };
}

function parseKeyValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.trim()) return out;
  // Match key=value where value can be quoted or unquoted (no spaces).
  const re = /(\w+)=(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return out;
}

interface CoerceArgsResult {
  value: Record<string, string | number | boolean>;
  error?: string;
}

function coerceArgs(
  tool: ToolDescriptor,
  raw: Record<string, string>,
): CoerceArgsResult {
  const out: Record<string, string | number | boolean> = {};
  for (const arg of tool.argsSchema) {
    const provided = raw[arg.name];
    if (provided === undefined) {
      if (arg.required && arg.default === undefined) {
        return {
          value: out,
          error: `Tool \`${tool.id}\` requires \`${arg.name}\` (${arg.label}). Pass with \`${arg.name}=…\`.`,
        };
      }
      continue;
    }
    if (arg.type === "boolean") {
      const v = provided.toLowerCase();
      if (v === "true" || v === "1" || v === "yes") out[arg.name] = true;
      else if (v === "false" || v === "0" || v === "no") out[arg.name] = false;
      else
        return {
          value: out,
          error: `Argument \`${arg.name}\` must be true/false, got \`${provided}\`.`,
        };
    } else if (arg.type === "number") {
      const n = Number(provided);
      if (!Number.isFinite(n))
        return {
          value: out,
          error: `Argument \`${arg.name}\` must be a number, got \`${provided}\`.`,
        };
      out[arg.name] = n;
    } else if (arg.type === "enum") {
      if (arg.options && !arg.options.includes(provided))
        return {
          value: out,
          error: `Argument \`${arg.name}\` must be one of: ${arg.options.join(", ")}.`,
        };
      out[arg.name] = provided;
    } else {
      out[arg.name] = provided;
    }
  }
  return { value: out };
}

function normalizeBackendUrl(value: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.replace(/\/+$|\s+/g, "");
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return undefined;
    return parsed.href.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function formatError(err: unknown): string {
  if (err instanceof BackendError)
    return `Backend error (${err.status}): ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
