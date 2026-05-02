import * as vscode from "vscode";
import type { RunRecord } from "./api/types.js";

/**
 * Each run gets its own output channel so users can compare results side by
 * side. Channels are cached and reused on later opens.
 */
export class OutputManager {
  private channels = new Map<string, vscode.OutputChannel>();

  constructor(private context: vscode.ExtensionContext) {}

  channelFor(run: RunRecord): vscode.OutputChannel {
    const existing = this.channels.get(run.id);
    if (existing) return existing;
    const channel = vscode.window.createOutputChannel(`Pentest: ${run.toolId} ${run.target}`);
    this.channels.set(run.id, channel);
    this.context.subscriptions.push(channel);
    channel.appendLine(`# ${run.command.join(" ")}`);
    channel.appendLine(`# started ${run.startedAt}`);
    channel.appendLine("");
    return channel;
  }
}
