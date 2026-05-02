import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import type { Finding, Severity } from "./types.js";

const KEY = "pentest-ide.findings";

/**
 * Persists findings in VS Code's globalState so they survive editor restarts
 * but are stored locally on the user's machine (no backend required).
 */
export class FindingsStore {
  private listeners = new Set<() => void>();

  constructor(private ctx: Pick<vscode.ExtensionContext, "globalState">) {}

  getAll(): Finding[] {
    return this.ctx.globalState.get<Finding[]>(KEY) ?? [];
  }

  forSession(sessionId: string): Finding[] {
    return this.getAll().filter((f) => f.sessionId === sessionId);
  }

  add(input: Omit<Finding, "id" | "createdAt">): Finding {
    const finding: Finding = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const all = [finding, ...this.getAll()];
    this.ctx.globalState.update(KEY, all);
    this.emit();
    return finding;
  }

  update(id: string, patch: Partial<Pick<Finding, "title" | "notes" | "severity">>): boolean {
    const all = this.getAll().map((f) => (f.id === id ? { ...f, ...patch } : f));
    const changed = all.some((f) => f.id === id);
    if (changed) {
      this.ctx.globalState.update(KEY, all);
      this.emit();
    }
    return changed;
  }

  delete(id: string): boolean {
    const prev = this.getAll();
    const next = prev.filter((f) => f.id !== id);
    if (next.length === prev.length) return false;
    this.ctx.globalState.update(KEY, next);
    this.emit();
    return true;
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }
}
