# Pentest IDE

A small **plug-and-play** workbench for security testing from inside your editor.

> **Hosted API** (for the extension): https://pentest-ide-backend.onrender.com — there is no built-in browser console; use the **VS Code / Cursor extension** (or `curl` against `/v1/*` with a bearer key).

```
┌─────────────────────────┐         HTTPS + SSE          ┌────────────────────────────┐
│ VS Code / Cursor        │ ───────────────────────────► │ Cloud backend (Fastify)    │
│ extension/              │     Bearer API key           │ backend/                   │
│  • Sessions sidebar     │                              │  • /v1/sessions            │
│  • Tools sidebar        │ ◄─────────────────────────── │  • /v1/tools               │
│  • Live run output      │     Streamed run chunks      │  • /v1/sessions/:id/runs   │
└─────────────────────────┘                              │  • Container w/ tools      │
                                                         └────────────────────────────┘
```

The backend is a single Docker image that **bundles the API and the
pentesting tools** (`nmap`, `httpx`, `nikto`, `whatweb`). One `fly deploy` and
the extension can connect over the internet — no local toolchain required.

---

## Layout

| Path        | What                                                            |
|-------------|-----------------------------------------------------------------|
| `backend/`  | Fastify API, tool registry, SSE streaming, vitest tests         |
| `extension/`| VS Code / Cursor extension (TypeScript, esbuild, vitest tests)  |
| `docker/`   | `Dockerfile.backend`, `Dockerfile.tools`, `docker-compose.yml`  |
| `deploy/`   | `fly.toml`, `railway.json`, `render.yaml`                       |

---

## Plug-and-play (recommended)

1. **Deploy the backend.** Pick one:
   - **Fly.io** → `cd deploy && fly launch --copy-config --no-deploy && fly secrets set PENTEST_IDE_API_KEYS=$(openssl rand -hex 32) && fly deploy`
   - **Railway** → import the repo, point at `deploy/railway.json`, set `PENTEST_IDE_API_KEYS` secret.
   - **Render** → connect repo, use `deploy/render.yaml`, set `PENTEST_IDE_API_KEYS` secret.
2. **Install the extension** (VSIX): `cd extension && npm install && npm run build && npm run package` then `code --install-extension pentest-ide-0.1.0.vsix` (works in Cursor too).
3. **Connect** via the command palette → `Pentest IDE: Connect to backend`. Paste the deploy URL and your API key.
4. **Create a session**, pick a tool, enter a target — output streams live into a dedicated VS Code output channel.

---

## Local development

```bash
# Backend, with hot reload
cd backend
cp .env.example .env
npm install
npm run dev

# Tests
npm test

# Or the full stack in Docker
docker compose -f docker/docker-compose.yml up --build
```

```bash
# Extension
cd extension
npm install
npm run build      # bundle
npm test           # unit tests for client / SSE / manager
```

To debug the extension live, open `extension/` in VS Code and press `F5`
("Run Extension" — works in Cursor too).

---

## Safety / scope controls

- API-key auth on every endpoint except `/healthz`.
- Targets are validated (no shell metacharacters, optional public-only mode,
  optional allowlist).
- `MAX_CONCURRENT_RUNS` and per-run wall-clock timeout cap blast radius.
- Sessions have an optional `scope` list — runs whose target is not in scope
  are rejected.
- The container runs as non-root.

> **You are responsible for only scanning systems you have explicit
> permission to test.** The defaults make it harder to misuse this on
> private/loopback addresses, but they are not a substitute for written
> authorization.

---

## Extending

Add a new tool by appending to `backend/src/tools/registry.ts`:

```ts
{
  id: "subfinder",
  label: "Subfinder",
  description: "Passive subdomain enumeration",
  binary: "subfinder",
  category: "recon",
  argsSchema: [],
  buildCommand: (target) => ["-d", target, "-silent"],
}
```

Then add the binary to `docker/Dockerfile.backend`. The extension will pick it
up on the next `Refresh`.
