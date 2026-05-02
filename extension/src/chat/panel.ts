import * as vscode from "vscode";
import {
  ChatRouter,
  type ChatBus,
  type ChatState,
  type ReplyKind,
  type ReportCardPayload,
  type RouterDeps,
} from "./router.js";

type ServerMessage =
  | {
      type: "message";
      kind: ReplyKind | "user";
      text: string;
      id: string;
      ts: string;
    }
  | {
      type: "streamStart";
      runId: string;
      header: string;
      ts: string;
      runningLabel?: string;
    }
  | {
      type: "streamChunk";
      runId: string;
      data: string;
      stream: "stdout" | "stderr";
    }
  | { type: "streamEnd"; runId: string; footer: string; ok: boolean }
  | { type: "state"; state: ChatState }
  | { type: "clear" }
  | { type: "reportCard"; payload: ReportCardPayload };

type ClientMessage =
  | { type: "ready" }
  | { type: "submit"; text: string }
  | { type: "clear" };

let counter = 0;
const nextId = () => `m${Date.now().toString(36)}${(++counter).toString(36)}`;

/**
 * Singleton chat-style webview panel for Pentest IDE. Lets the user drive
 * the backend (sessions, tools, runs) by typing natural language or short
 * commands instead of hunting through the command palette.
 */
export class ChatPanel implements ChatBus {
  private static instance?: ChatPanel;
  private panel: vscode.WebviewPanel;
  private router: ChatRouter;
  private streamTail = new Map<string, string>();
  private streamQueues = new Map<string, Promise<void>>();

  /** After palette `pentestIde.resetDemo` clears credentials, sync open chat UI. */
  static touchPaletteDemoReset(): void {
    ChatPanel.instance?.syncAfterPaletteDemoReset();
  }

  static open(deps: RouterDeps): ChatPanel {
    if (ChatPanel.instance) {
      ChatPanel.instance.panel.reveal(vscode.ViewColumn.Active);
      return ChatPanel.instance;
    }
    const inst = new ChatPanel(deps);
    ChatPanel.instance = inst;
    return inst;
  }

  private constructor(private deps: RouterDeps) {
    this.panel = vscode.window.createWebviewPanel(
      "pentestIdeChat",
      "Pentest IDE Chat",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    deps.context.subscriptions.push(this.panel);

    this.panel.iconPath = new vscode.ThemeIcon("comment-discussion");
    this.panel.webview.html = buildHtml();

    this.router = new ChatRouter(this, deps);

    this.panel.webview.onDidReceiveMessage(
      async (msg: ClientMessage) => {
        if (msg.type === "ready") {
          this.router.publishState();
          this.greet();
          return;
        }
        if (msg.type === "submit") {
          const text = (msg.text ?? "").trim();
          if (!text) return;
          this.postMessageToWebview({
            type: "message",
            kind: "user",
            text,
            id: nextId(),
            ts: new Date().toISOString(),
          });
          await this.router.handle(text);
          return;
        }
        if (msg.type === "clear") {
          this.postMessageToWebview({ type: "clear" });
          this.greet();
          return;
        }
      },
      undefined,
      deps.context.subscriptions,
    );

    this.panel.onDidDispose(() => {
      ChatPanel.instance = undefined;
    });
  }

  // ---------- ChatBus ----------

  reply(text: string, kind: ReplyKind = "assistant"): void {
    this.postMessageToWebview({
      type: "message",
      kind,
      text,
      id: nextId(),
      ts: new Date().toISOString(),
    });
  }

  streamStart(runId: string, header: string, runningLabel?: string): void {
    this.streamTail.delete(runId);
    this.streamQueues.delete(runId);
    this.postMessageToWebview({
      type: "streamStart",
      runId,
      header,
      ts: new Date().toISOString(),
      runningLabel,
    });
  }

  streamChunk(
    runId: string,
    data: string,
    stream: "stdout" | "stderr",
  ): void {
    const prev = this.streamTail.get(runId) ?? "";
    let buf = prev + data;
    const parts = buf.split("\n");
    const rest = parts.pop() ?? "";
    this.streamTail.set(runId, rest);
    for (const line of parts) {
      this.enqueueStreamLine(runId, stream, `${line}\n`);
    }
  }

  streamEnd(runId: string, footer: string, ok: boolean): void {
    const tail = this.streamTail.get(runId) ?? "";
    this.streamTail.delete(runId);
    if (tail) {
      this.enqueueStreamLine(runId, "stdout", tail);
    }
    const chain = this.streamQueues.get(runId) ?? Promise.resolve();
    const done = chain.then(() => {
      this.streamQueues.delete(runId);
      this.postMessageToWebview({ type: "streamEnd", runId, footer, ok });
    });
    this.streamQueues.set(runId, done);
  }

  setState(state: ChatState): void {
    this.postMessageToWebview({ type: "state", state });
  }

  reportCard(payload: ReportCardPayload): void {
    this.postMessageToWebview({ type: "reportCard", payload });
  }

  resetDemoUi(): void {
    this.streamTail.clear();
    this.streamQueues.clear();
    this.postMessageToWebview({ type: "clear" });
    this.greet();
  }

  syncAfterPaletteDemoReset(): void {
    this.router.clearActiveSessionAndPublish();
    this.resetDemoUi();
  }

  // ---------- internals ----------

  private enqueueStreamLine(
    runId: string,
    stream: "stdout" | "stderr",
    text: string,
  ): void {
    const prev = this.streamQueues.get(runId) ?? Promise.resolve();
    const next = prev
      .then(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 30);
          }),
      )
      .then(() => {
        this.postMessageToWebview({ type: "streamChunk", runId, data: text, stream });
      });
    this.streamQueues.set(runId, next);
  }

  private postMessageToWebview(msg: ServerMessage) {
    this.panel.webview.postMessage(msg).then(undefined, () => {
      /* webview disposed mid-flight – ignore */
    });
  }

  private greet() {
    this.reply(
      [
        "**Welcome to Pentest IDE chat.** Type natural language or shortcuts.",
        "",
        "Try:",
        "- `connect http://localhost:8787 <api-key>`",
        "- `create session acme-engagement`",
        "- `tools` to see what's available",
        "- `run nmap-quick 10.0.0.1`",
        "- `help` for the full list",
      ].join("\n"),
      "system",
    );
  }
}

// ---------------------------------------------------------------------
// Webview HTML / CSS / JS
// ---------------------------------------------------------------------

function buildHtml(): string {
  // Simple inline CSP — styles + scripts inline only, no remote anything.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;" />
<title>Pentest IDE Chat</title>
<style>
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --muted: var(--vscode-descriptionForeground, #888);
    --border: var(--vscode-editorWidget-border, #333);
    --accent: var(--vscode-textLink-foreground, #3794ff);
    --bubble-user: var(--vscode-button-background, #0e639c);
    --bubble-user-fg: var(--vscode-button-foreground, #fff);
    --bubble-assistant: var(--vscode-editorWidget-background, #252526);
    --bubble-system: var(--vscode-editorInfo-background, rgba(64,140,255,0.08));
    --bubble-error-bg: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    --bubble-error-border: var(--vscode-inputValidation-errorBorder, #be1100);
    --bubble-success-bg: rgba(45, 160, 80, 0.12);
    --bubble-success-border: rgba(45, 160, 80, 0.4);
    --code-bg: var(--vscode-textCodeBlock-background, rgba(255,255,255,0.06));
    --input-bg: var(--vscode-input-background);
    --input-fg: var(--vscode-input-foreground);
    --input-border: var(--vscode-input-border, transparent);
  }
  html, body {
    height: 100%;
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    overflow: hidden;
  }
  body {
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--vscode-sideBar-background, var(--bg));
    flex: 0 0 auto;
  }
  header .title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
  }
  header .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #888;
  }
  header .dot.ok { background: #2ea043; }
  header .dot.warn { background: #d29922; }
  .conn-badge {
    color: #2ea043;
    font-size: 11px;
    font-weight: 500;
    display: none;
  }
  .conn-badge.show { display: inline; }
  .session-badge {
    color: #58a6ff;
    font-size: 11px;
    font-weight: 500;
  }
  header .meta {
    color: var(--muted);
    font-size: 11px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  header button {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
  }
  header button:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.06));
  }

  .chips {
    display: flex;
    gap: 6px;
    padding: 8px 12px 0 12px;
    flex-wrap: wrap;
    flex: 0 0 auto;
  }
  .chip {
    background: var(--code-bg);
    border: 1px solid var(--border);
    color: var(--fg);
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  main {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .row {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .row.user { justify-content: flex-end; }
  .row .avatar {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bubble-assistant);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--muted);
    flex: 0 0 auto;
  }
  .row.user .avatar {
    background: var(--bubble-user);
    color: var(--bubble-user-fg);
  }

  .bubble {
    max-width: 85%;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid transparent;
    line-height: 1.45;
    word-wrap: break-word;
  }
  .bubble p { margin: 0 0 8px 0; }
  .bubble p:last-child { margin-bottom: 0; }
  .bubble code {
    background: var(--code-bg);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
    font-size: 12px;
  }
  .bubble pre {
    background: var(--code-bg);
    padding: 8px 10px;
    border-radius: 4px;
    overflow-x: auto;
    margin: 6px 0;
    font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
    font-size: 12px;
    white-space: pre-wrap;
  }
  .bubble ul, .bubble ol {
    margin: 4px 0 4px 20px;
    padding: 0;
  }
  .bubble h3 {
    margin: 0 0 4px 0;
    font-size: 13px;
  }
  .bubble strong { font-weight: 600; }
  .bubble a { color: var(--accent); }
  .bubble.user {
    background: var(--bubble-user);
    color: var(--bubble-user-fg);
  }
  .bubble.user code,
  .bubble.user pre {
    background: rgba(255,255,255,0.18);
    color: inherit;
  }
  .bubble.assistant {
    background: var(--bubble-assistant);
  }
  .bubble.system {
    background: var(--bubble-system);
    border-color: var(--accent);
  }
  .bubble.info {
    background: var(--bubble-system);
  }
  .bubble.success {
    background: var(--bubble-success-bg);
    border-color: var(--bubble-success-border);
  }
  .bubble.error {
    background: var(--bubble-error-bg);
    border-color: var(--bubble-error-border);
  }

  .run {
    background: var(--bubble-assistant);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0;
    overflow: hidden;
    max-width: 95%;
    width: 100%;
  }
  .run .run-head,
  .run .run-foot {
    padding: 6px 10px;
    font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
    font-size: 11px;
    color: var(--muted);
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid var(--border);
    white-space: pre-wrap;
  }
  .run .run-foot {
    border-top: 1px solid var(--border);
    border-bottom: none;
  }
  .run .run-foot.ok { color: #2ea043; }
  .run .run-foot.bad { color: #f85149; }
  .run pre.body {
    margin: 0;
    padding: 8px 10px;
    max-height: 320px;
    overflow: auto;
    font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .run pre.body .err { color: #f85149; }
  .run pre.body .port { color: #d29922; font-weight: 600; }
  .run-spin-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--muted);
    border-bottom: 1px solid var(--border);
    background: rgba(255,255,255,0.03);
  }
  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--muted);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: pspin 0.75s linear infinite;
    flex-shrink: 0;
  }
  @keyframes pspin { to { transform: rotate(360deg); } }

  .finding-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    background: var(--bubble-assistant);
    max-width: 95%;
    line-height: 1.5;
  }
  .finding-card h3 { margin: 0 0 8px 0; font-size: 14px; }
  .finding-card .meta-row { font-size: 12px; color: var(--muted); margin-bottom: 10px; }
  .finding-card pre.evidence {
    margin: 0 0 10px 0;
    padding: 8px 10px;
    background: var(--code-bg);
    border-radius: 4px;
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 200px;
    overflow: auto;
  }
  .sev-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    margin-right: 8px;
  }
  .sev-pill.critical { background: rgba(248,81,73,0.25); color: #ff7b72; }
  .sev-pill.high { background: rgba(248,81,73,0.18); color: #f85149; }
  .sev-pill.medium { background: rgba(210,153,34,0.22); color: #d29922; }
  .sev-pill.low { background: rgba(46,160,67,0.18); color: #3fb950; }
  .bubble .sev-crit { color: #ff7b72; font-weight: 700; }
  .bubble .sev-high { color: #f85149; font-weight: 600; }
  .bubble .sev-med { color: #d29922; font-weight: 600; }
  .bubble .sev-low { color: #3fb950; font-weight: 600; }

  footer {
    flex: 0 0 auto;
    border-top: 1px solid var(--border);
    padding: 8px 12px;
    background: var(--vscode-sideBar-background, var(--bg));
  }
  .input-wrap {
    display: flex;
    gap: 6px;
    align-items: flex-end;
  }
  textarea {
    flex: 1 1 auto;
    background: var(--input-bg);
    color: var(--input-fg);
    border: 1px solid var(--input-border);
    border-radius: 4px;
    padding: 8px 10px;
    resize: none;
    font-family: inherit;
    font-size: inherit;
    line-height: 1.4;
    min-height: 36px;
    max-height: 160px;
    outline: none;
  }
  textarea:focus {
    border-color: var(--accent);
  }
  button.send {
    background: var(--bubble-user);
    color: var(--bubble-user-fg);
    border: none;
    padding: 0 14px;
    height: 36px;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }
  button.send:hover { filter: brightness(1.1); }
  button.send:disabled { opacity: 0.5; cursor: not-allowed; }
  .hint {
    color: var(--muted);
    font-size: 10px;
    margin-top: 4px;
  }
</style>
</head>
<body>
  <header>
    <div class="title">
      <span class="dot" id="dot"></span>
      <span>Pentest IDE</span>
    </div>
    <div class="meta" id="meta">
      <span id="connBadge" class="conn-badge">● Connected</span>
      <span id="metaUrl">not connected</span>
      <span id="metaSession"></span>
      <span id="metaCounts"></span>
      <button id="clearBtn" title="Clear chat">Clear</button>
    </div>
  </header>

  <div class="chips" id="chips">
    <button class="chip" data-cmd="connect">connect</button>
    <button class="chip" data-cmd="status">status</button>
    <button class="chip" data-cmd="sessions">sessions</button>
    <button class="chip" data-cmd="tools">tools</button>
    <button class="chip" data-cmd="runs">runs</button>
    <button class="chip" data-cmd="help">help</button>
  </div>

  <main id="log" aria-live="polite"></main>

  <footer>
    <div class="input-wrap">
      <textarea
        id="input"
        rows="1"
        placeholder="Type a command or natural language… (Enter to send, Shift+Enter for newline)"
        autofocus
      ></textarea>
      <button class="send" id="send">Send</button>
    </div>
    <div class="hint">
      Examples: <code>create session acme</code> · <code>run nmap-quick 10.0.0.1</code> · <code>show recent runs</code>
    </div>
  </footer>

<script>
(() => {
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const clearBtn = document.getElementById('clearBtn');
  const dot = document.getElementById('dot');
  const connBadge = document.getElementById('connBadge');
  const metaUrl = document.getElementById('metaUrl');
  const metaSession = document.getElementById('metaSession');
  const metaCounts = document.getElementById('metaCounts');
  const chips = document.getElementById('chips');

  const runEls = new Map();   // runId -> { wrap, body, spinRow }
  const history = [];
  let historyIdx = -1;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Tiny markdown-ish renderer: bold, italic, code, headings, bullets, line breaks.
  function renderMd(text) {
    const lines = String(text).split('\\n');
    const out = [];
    let inList = false;
    let inOlist = false;
    for (let raw of lines) {
      let line = raw;
      // Headings.
      const h = /^### (.+)$/.exec(line) || /^## (.+)$/.exec(line) || /^# (.+)$/.exec(line);
      if (h) {
        if (inList) { out.push('</ul>'); inList = false; }
        if (inOlist) { out.push('</ol>'); inOlist = false; }
        out.push('<h3>' + inlineMd(h[1]) + '</h3>');
        continue;
      }
      const ol = /^(\\d+)\\.\\s+(.*)$/.exec(line);
      if (ol) {
        if (inList) { out.push('</ul>'); inList = false; }
        if (!inOlist) { out.push('<ol>'); inOlist = true; }
        out.push('<li>' + inlineMd(ol[2]) + '</li>');
        continue;
      }
      if (/^[-*]\\s+/.test(line)) {
        if (inOlist) { out.push('</ol>'); inOlist = false; }
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inlineMd(line.replace(/^[-*]\\s+/, '')) + '</li>');
        continue;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (inOlist) { out.push('</ol>'); inOlist = false; }
      if (line.trim() === '') {
        out.push('<br>');
      } else {
        out.push('<p>' + inlineMd(line) + '</p>');
      }
    }
    if (inList) out.push('</ul>');
    if (inOlist) out.push('</ol>');
    return out.join('');
  }
  function paintSeverityTokens(html) {
    return String(html)
      .replace(/\bCritical\b/g, '<span class="sev-crit">Critical</span>')
      .replace(/\bHigh\b/g, '<span class="sev-high">High</span>')
      .replace(/\bMedium\b/g, '<span class="sev-med">Medium</span>')
      .replace(/\bLow\b/g, '<span class="sev-low">Low</span>');
  }
  function inlineMd(s) {
    let t = escapeHtml(s);
    t = t.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    t = t.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    t = t.replace(/(?:^|\\s)_([^_]+)_/g, (m, p1) => m.replace('_' + p1 + '_', '<em>' + p1 + '</em>'));
    return paintSeverityTokens(t);
  }

  function appendBubble(kind, text) {
    const row = document.createElement('div');
    row.className = 'row ' + (kind === 'user' ? 'user' : 'assistant');
    const isUser = kind === 'user';
    if (!isUser) {
      const av = document.createElement('div');
      av.className = 'avatar';
      av.textContent = '🛡';
      row.appendChild(av);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + kind;
    bubble.innerHTML = renderMd(text);
    row.appendChild(bubble);
    if (isUser) {
      const av = document.createElement('div');
      av.className = 'avatar';
      av.textContent = 'you';
      row.appendChild(av);
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function decorateRunChunk(plain, stream) {
    let t = escapeHtml(plain);
    if (stream !== 'stderr') {
      t = t.replace(/\b(\d{1,5})\/(tcp|udp)\b/gi, '<span class="port">$1/$2</span>');
      t = t.replace(/:(\d{2,5})\b/g, ':<span class="port">$1</span>');
      t = paintSeverityTokens(t);
    }
    return t;
  }

  function appendRun(runId, header, runningLabel) {
    const row = document.createElement('div');
    row.className = 'row';
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = '⚡';
    row.appendChild(av);
    const wrap = document.createElement('div');
    wrap.className = 'run';
    const head = document.createElement('div');
    head.className = 'run-head';
    head.textContent = header;
    wrap.appendChild(head);
    let spinRow = null;
    if (runningLabel) {
      spinRow = document.createElement('div');
      spinRow.className = 'run-spin-row';
      spinRow.innerHTML = '<span class="spinner"></span><span>' + escapeHtml(runningLabel) + '</span>';
      wrap.appendChild(spinRow);
    }
    const body = document.createElement('pre');
    body.className = 'body';
    wrap.appendChild(body);
    row.appendChild(wrap);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    runEls.set(runId, { wrap, body, spinRow });
  }

  function appendChunk(runId, data, stream) {
    const ent = runEls.get(runId);
    if (!ent) return;
    if (ent.spinRow) {
      ent.spinRow.remove();
      ent.spinRow = null;
    }
    const wrap = document.createElement('span');
    if (stream === 'stderr') wrap.className = 'err';
    wrap.innerHTML = decorateRunChunk(data, stream);
    ent.body.appendChild(wrap);
    const nearBottom =
      log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    if (nearBottom) log.scrollTop = log.scrollHeight;
  }

  function appendReportCard(p) {
    const row = document.createElement('div');
    row.className = 'row';
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = '📋';
    row.appendChild(av);
    const sev = (p.severity || '').toLowerCase();
    let pillClass = 'medium';
    if (sev === 'critical') pillClass = 'critical';
    else if (sev === 'high') pillClass = 'high';
    else if (sev === 'low') pillClass = 'low';
    const card = document.createElement('div');
    card.className = 'finding-card';
    card.innerHTML =
      '<h3>' + escapeHtml(p.finding) + '</h3>' +
      '<div class="meta-row"><span class="sev-pill ' + pillClass + '">' + escapeHtml(p.severity) + '</span>' +
      '<span>CVSS ' + escapeHtml(p.cvss) + '</span></div>' +
      '<div style="font-size:11px;color:var(--muted);margin:0 0 4px 0">Evidence</div>' +
      '<pre class="evidence">' + escapeHtml(p.evidence) + '</pre>' +
      '<div style="font-size:12px;margin-bottom:6px"><strong>Remediation</strong><br/>' + escapeHtml(p.remediation) + '</div>' +
      '<div style="font-size:11px;color:var(--muted)"><strong>MITRE</strong> · ' + escapeHtml(p.mitre) + '</div>';
    row.appendChild(card);
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  function appendFooter(runId, footer, ok) {
    const ent = runEls.get(runId);
    if (!ent) return;
    const f = document.createElement('div');
    f.className = 'run-foot ' + (ok ? 'ok' : 'bad');
    f.textContent = footer;
    ent.wrap.appendChild(f);
  }

  function setState(state) {
    const connected = !!state.connected;
    dot.className = 'dot ' + (connected ? 'ok' : (state.baseUrl ? 'warn' : ''));
    if (connBadge) {
      connBadge.className = 'conn-badge' + (connected ? ' show' : '');
    }
    const targetHint = state.probeTarget ? ' · scope: ' + state.probeTarget : '';
    metaUrl.textContent = state.baseUrl
      ? (connected ? state.baseUrl + targetHint : state.baseUrl + ' (no key)')
      : 'not connected';
    const sess = state.activeSessionName || '';
    const sessActive = state.sessionActive && sess;
    metaSession.textContent = sess
      ? (sessActive ? '● Session Active · ' + sess : 'session: ' + sess)
      : '';
    metaCounts.textContent =
      '· ' + (state.sessionCount || 0) + ' sessions / ' + (state.toolCount || 0) + ' tools';
  }

  function send(text) {
    const value = (text || input.value).trim();
    if (!value) return;
    history.push(value);
    if (history.length > 50) history.shift();
    historyIdx = history.length;
    if (!text) input.value = '';
    autoSize();
    vscode.postMessage({ type: 'submit', text: value });
  }

  function autoSize() {
    input.style.height = 'auto';
    input.style.height = Math.min(160, input.scrollHeight) + 'px';
  }

  input.addEventListener('input', autoSize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp' && input.value === '' && history.length) {
      historyIdx = Math.max(0, historyIdx - 1);
      input.value = history[historyIdx] || '';
      autoSize();
      e.preventDefault();
    } else if (e.key === 'ArrowDown' && history.length) {
      historyIdx = Math.min(history.length, historyIdx + 1);
      input.value = history[historyIdx] || '';
      autoSize();
    }
  });
  sendBtn.addEventListener('click', () => send());
  clearBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clear' });
  });
  chips.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('chip')) {
      send(t.dataset.cmd);
    }
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'message') {
      appendBubble(msg.kind, msg.text);
    } else if (msg.type === 'streamStart') {
      appendRun(msg.runId, msg.header, msg.runningLabel);
    } else if (msg.type === 'streamChunk') {
      appendChunk(msg.runId, msg.data, msg.stream);
    } else if (msg.type === 'streamEnd') {
      appendFooter(msg.runId, msg.footer, msg.ok);
    } else if (msg.type === 'state') {
      setState(msg.state);
    } else if (msg.type === 'reportCard') {
      appendReportCard(msg.payload);
    } else if (msg.type === 'clear') {
      log.innerHTML = '';
      runEls.clear();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
}
