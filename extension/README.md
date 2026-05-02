# Pentest IDE — VS Code / Cursor extension

A chat-style workbench that drives the Pentest IDE backend: connect, create
sessions, run tools, and watch output stream live — all from one text window.

## Quick start (chat)

1. `⌘⇧P` → **Pentest IDE: Open chat** (or click the chat icon on the
   **Sessions** view title bar).
2. In the chat, type `connect http://localhost:8787 <api-key>`.
3. Type `create session acme-engagement`.
4. Type `tools` to see what's available, then `run nmap-quick 10.0.0.1`.

Live run output streams into the same chat window. Type `help` for the full
list of commands.

### Chat commands

| Intent | Examples |
|--------|----------|
| Connection | `connect <url> <key>`, `status`, `refresh`, `disconnect` |
| Sessions | `sessions`, `create session acme scope=example.com,10.0.0.0/24`, `use acme`, `delete session acme` |
| Tools | `tools`, `run nmap-quick 10.0.0.1`, `run httpx example.com timeout=10` |
| Runs | `runs`, `output 1`, `cancel`, `cancel 2` |
| Findings | `findings`, `add finding "open admin panel" sev=high` |
| Misc | `help`, `clear` |

Natural language works too: _"Create a new session named acme-engagement"_,
_"Run nmap-quick against 10.0.0.1"_, _"Show recent runs"_, _"Open output for
the last run"_.

## Sidebar (legacy)

The original tree views (Sessions / Tools / Recent runs) still ship for
quick clicks; every action is also available via the command palette.

## Settings

| Setting                    | Default                          | Description                       |
|----------------------------|----------------------------------|-----------------------------------|
| `pentestIde.backendUrl`    | `https://pentest-ide.fly.dev`    | Base URL of the deployed backend. |
| `pentestIde.apiKey`        | _(empty)_                        | Bearer token for the backend.     |
| `pentestIde.requestTimeoutMs` | `15000`                       | HTTP request timeout.             |
