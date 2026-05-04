# PenTest IDE 🛡️

> **FOR AUTHORIZED PENETRATION TESTING ONLY. Unauthorized use against systems 
> you do not own or have explicit written permission to test is illegal.**

---

## What is this?

PenTest IDE is a VS Code extension that acts as an AI copilot for penetration 
testers. Think Cursor, but for offensive security. Instead of jumping between 
20 different tools and terminals, you type plain English inside your editor and 
the AI handles the rest — recon, vulnerability discovery, exploit planning, and 
report generation.

Powered by **Heretic** — an open source abliteration framework that removes 
safety restrictions from LLMs at the weight level — giving you an AI that 
actually understands offensive security without fighting you at every step.

---

## Demo

> "Watch us find a real vulnerability in 60 seconds"The AI runs real security tools, reads the output, and hands back a 
CVSS-scored, MITRE ATT&CK-mapped findings report ready to send to a client.

---

## How it works

┌─────────────────────────────────────────┐
│           VS Code Sidebar               │
│         (Plain English Chat)            │
└──────────────┬──────────────────────────┘
│
┌──────────────▼──────────────────────────┐
│           Extension Core               │
│   Context builder · Session state      │
│   Scope enforcer · Audit logger        │
└──────────────┬──────────────────────────┘
│
┌──────────────▼──────────────────────────┐
│         Heretic Bridge                  │
│  Abliterated model running via Ollama   │
│  Task router · MITRE context injector   │
│  100% local — no data leaves machine    │
└──────────────┬──────────────────────────┘
│
┌──────────────▼──────────────────────────┐
│          Tool Layer (Docker)            │
│  Nmap · Nikto · WhatWeb · sqlmap        │
│  Metasploit · Hashcat · theHarvester    │
└─────────────────────────────────────────┘
---

## Why Heretic?

Every mainstream AI model refuses to discuss offensive security techniques. 
Heretic surgically removes those refusals at the model weight level before 
deployment — not a jailbreak, not a prompt trick, a permanent model-level 
change. The result is an AI that understands exploit chains, CVEs, and payload 
construction the way a senior pentester does.

The abliterated model runs entirely locally via Ollama. Client data, target 
scope, and vulnerability findings never touch a third party server.

---

## Stack

- **VS Code Extension** — TypeScript
- **AI Backend** — Heretic + Ollama (local)
- **Sidecar** — Python FastAPI (streaming SSE)
- **Tools** — Docker sandboxed MCP servers
- **Knowledge Base** — MITRE ATT&CK + NVD + Exploit DB
- **Memory** — ChromaDB vector store

---

## Features

- 🧠 Plain English → real tool execution
- 🔒 Scope enforcer — validates targets before any tool fires
- 📋 Auto-generated CVSS + MITRE ATT&CK reports
- 🖥️ 100% local — air-gap capable
- 📁 Audit log on every action for legal cover
- ⚡ Inline ghost text suggestions on `// pentest:` comments

---

## Setup

### Prerequisites
- VS Code 1.85+
- Docker + Docker Compose
- Ollama (https://ollama.ai)
- Python 3.11+
- Node.js 18+

### 1. Run Heretic on your base model (offline, one time)
```bash
# Clone Heretic
git clone https://github.com/ggerganov/llama.cpp
# Follow Heretic abliteration instructions to process your base model
# Load the output into Ollama
ollama create pentest-model -f ./Modelfile
```

### 2. Start the backend
```bash
cp .env.example .env
# Fill in your Ollama URL and model name
docker compose up -d
```

### 3. Install the extension
```bash
cd extension
npm install
npm run package
# Install the generated .vsix in VS Code
```

### 4. Start a session
---

## Environment Variables

```bash
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_DEFAULT_MODEL=pentest-model
RECON_MODEL=pentest-model
EXPLOIT_MODEL=pentest-model
BRIDGE_PORT=8765
SHODAN_API_KEY=
LOG_LEVEL=info
```

---

## Legal

This tool is built for **authorized penetration testing, bug bounty hunting, 
and security research only**. Every tool execution is validated against a 
signed engagement scope before running. Every action is audit logged.

Unauthorized use is illegal under the CFAA and equivalent laws worldwide. 
The authors take no responsibility for misuse.

---

## Built at Eureka 2025

Built by Abdel
