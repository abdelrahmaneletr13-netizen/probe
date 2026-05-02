import * as vscode from "vscode";
import type { FindingsStore } from "./store.js";
import type { Finding, Severity } from "./types.js";

/**
 * Singleton webview panel that shows all findings in a rich HTML table.
 * Opens (or reveals) with `pentestIde.openFindings`.
 */
export class FindingsPanel {
  private static instance?: FindingsPanel;
  private panel: vscode.WebviewPanel;
  private disposeStore: () => void;

  static open(context: vscode.ExtensionContext, store: FindingsStore) {
    if (FindingsPanel.instance) {
      FindingsPanel.instance.panel.reveal();
      return;
    }
    FindingsPanel.instance = new FindingsPanel(context, store);
  }

  private constructor(context: vscode.ExtensionContext, store: FindingsStore) {
    this.panel = vscode.window.createWebviewPanel(
      "pentestIdeFindings",
      "Pentest Findings",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    context.subscriptions.push(this.panel);

    this.disposeStore = store.onDidChange(() => this.render(store));

    this.panel.webview.onDidReceiveMessage((msg: { command: string; payload?: unknown }) => {
      if (msg.command === "delete") {
        store.delete((msg.payload as { id: string }).id);
      } else if (msg.command === "update") {
        const { id, ...patch } = msg.payload as Finding;
        store.update(id, patch);
      }
    });

    this.panel.onDidDispose(() => {
      this.disposeStore();
      FindingsPanel.instance = undefined;
    });

    this.render(store);
  }

  private render(store: FindingsStore) {
    this.panel.webview.html = buildHtml(store.getAll());
  }
}

const SEV_COLOR: Record<Severity, string> = {
  critical: "#d32f2f",
  high: "#f57c00",
  medium: "#f9a825",
  low: "#388e3c",
  info: "#1565c0",
};

function buildHtml(findings: Finding[]): string {
  const rows =
    findings.length === 0
      ? `<tr><td colspan="6" style="text-align:center;padding:2rem;color:#888">No findings yet. Use <strong>Pentest IDE: Add finding</strong> after a run.</td></tr>`
      : findings.map((f) => `
        <tr data-id="${f.id}">
          <td><span class="sev" style="background:${SEV_COLOR[f.severity]}">${f.severity}</span></td>
          <td>${esc(f.target)}</td>
          <td>${esc(f.toolId)}</td>
          <td>${esc(f.title)}</td>
          <td style="max-width:300px;white-space:pre-wrap">${esc(f.notes)}</td>
          <td>
            <button onclick="del('${f.id}')">🗑</button>
          </td>
        </tr>`).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); font-size: 13px; margin: 0; padding: 1rem; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
  h2 { margin-top: 0; }
  table { border-collapse: collapse; width: 100%; }
  th { background: var(--vscode-editorGroupHeader-tabsBackground); padding: .5rem; text-align: left; }
  td { padding: .4rem .5rem; border-bottom: 1px solid var(--vscode-editorWidget-border, #333); vertical-align: top; }
  .sev { color: #fff; padding: 2px 6px; border-radius: 3px; font-weight: bold; font-size: 11px; white-space: nowrap; }
  button { background: none; border: none; cursor: pointer; font-size: 14px; }
  .count { color: #888; font-size: 12px; }
</style>
</head>
<body>
<h2>Findings <span class="count">(${findings.length})</span></h2>
<table>
  <thead>
    <tr><th>Severity</th><th>Target</th><th>Tool</th><th>Title</th><th>Notes</th><th></th></tr>
  </thead>
  <tbody>${rows}</tbody>
</table>
<script>
  const vscode = acquireVsCodeApi();
  function del(id) {
    if (!confirm('Delete this finding?')) return;
    vscode.postMessage({ command: 'delete', payload: { id } });
  }
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
