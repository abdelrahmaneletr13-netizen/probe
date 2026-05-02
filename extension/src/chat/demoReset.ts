import * as vscode from "vscode";
import { clearProbeEvidence } from "./probeEvidence.js";
import { clearProbeCanonicalTarget } from "./probeState.js";

export type DemoResetDeps = {
  refreshConfig: () => Promise<void>;
  manager: { refresh: () => Promise<void> };
};

/** Clears probe artifacts, API key, and refreshes the session manager (offline-safe). */

export async function clearDemoBackendState(deps: DemoResetDeps): Promise<void> {
  clearProbeEvidence();
  clearProbeCanonicalTarget();
  const cfg = vscode.workspace.getConfiguration("pentestIde");
  await cfg.update("apiKey", "", vscode.ConfigurationTarget.Global);
  await deps.refreshConfig();
  await deps.manager.refresh().catch(() => {
    /* backend may be unreachable after disconnect */
  });
}
