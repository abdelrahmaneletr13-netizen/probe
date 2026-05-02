# Pentest IDE — VS Code / Cursor extension

A sidebar workbench that drives the Pentest IDE backend: create sessions,
run tools, watch output stream live.

## Setup

1. `Pentest IDE: Connect to backend` — set the backend URL and API key.
2. `Pentest IDE: New session` — name the engagement and (optionally) declare scope.
3. Click any tool in the **Tools** sidebar to start a run. Output appears in
   a dedicated `Pentest: <tool> <target>` output channel.

## Settings

| Setting                    | Default                          | Description                       |
|----------------------------|----------------------------------|-----------------------------------|
| `pentestIde.backendUrl`    | `https://pentest-ide.fly.dev`    | Base URL of the deployed backend. |
| `pentestIde.apiKey`        | _(empty)_                        | Bearer token for the backend.     |
| `pentestIde.requestTimeoutMs` | `15000`                       | HTTP request timeout.             |
