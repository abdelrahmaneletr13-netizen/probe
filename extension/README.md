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

### LLM (Cursor-style natural language)

Fuzzy chat (“nmap my wifi for vulns…”) is handled by an **optional planner** that
calls any **OpenAI-compatible** `POST /v1/chat/completions` (OpenAI, Groq,
Together, Azure OpenAI gateway, OpenRouter, local proxies, …).

1. `⌘⇧P` → **Pentest IDE: Configure LLM** → enable and paste provider key / URL / model.
2. Planner receives your message plus the live **tools** and **sessions** list and returns structured JSON mapped to Pentest IDE actions (`run`, `create_session`, etc.).

Secrets: **`pentestIde.llmApiKey`** is sent **only** to your LLM host — not to the pentest backend. Turn off **`pentestIde.llmResponseJsonMode`** if your server rejects JSON-mode (some Ollama setups).

### Chat is inside Cursor / VS Code (not Chrome)

The chat panel uses a **VS Code Webview**: HTML runs **inside an editor tab**,
not in an external browser. That is how custom UIs work in VS Code extensions;
there is no separate “pure native” chat widget exposed to extensions.

After you reinstall a VSIX or change extension code locally:

1. **`⌘⇧P`** → **Developer: Reload Window** (Cursor and VS Code both have this).

Or, when developing:

2. **`F5`** on the extension project again (Extension Development Host restarts).

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
