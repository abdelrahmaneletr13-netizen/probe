#!/usr/bin/env bash
# End-to-end demo: hits the running backend, creates a session, runs a few
# scans against scanme.nmap.org (a public test target maintained by the Nmap
# project), and streams the results.

set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-dev-key-change-me}"
TARGET="${TARGET:-scanme.nmap.org}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
dim()  { printf "\033[2m%s\033[0m\n" "$*"; }
ok()   { printf "\033[32m%s\033[0m\n" "$*"; }

echo
bold "═══════════════════════════════════════════════════════════════════"
bold "  Pentest IDE — end-to-end demo"
bold "═══════════════════════════════════════════════════════════════════"
echo
dim "Backend: $BACKEND_URL"
dim "Target:  $TARGET (public test target maintained by Nmap project)"
echo

# 1. Health check
bold "1. Healthcheck"
curl -fsS "$BACKEND_URL/healthz" | python3 -m json.tool
echo

# 2. List tools
bold "2. List available tools"
curl -fsS -H "Authorization: Bearer $API_KEY" "$BACKEND_URL/v1/tools" \
  | python3 -c "import sys,json; [print(f\"   {t['id']:20} ({t['category']:6}) {t['label']}\") for t in json.load(sys.stdin)['tools']]"
echo

# 3. Create session
bold "3. Create a session scoped to $TARGET"
SESSION_JSON=$(curl -fsS -X POST -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"demo-$(date +%s)\",\"scope\":[\"$TARGET\"]}" \
  "$BACKEND_URL/v1/sessions")
SESSION_ID=$(echo "$SESSION_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
ok "   created session: $SESSION_ID"
echo

# helper that runs one tool and streams its output
run_tool() {
  local tool="$1"
  bold "▶ Running $tool against $TARGET"
  echo

  RUN_JSON=$(curl -fsS -X POST -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"toolId\":\"$tool\",\"target\":\"$TARGET\",\"args\":{}}" \
    "$BACKEND_URL/v1/sessions/$SESSION_ID/runs")
  local RUN_ID
  RUN_ID=$(echo "$RUN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

  curl -fsSN -H "Authorization: Bearer $API_KEY" \
    "$BACKEND_URL/v1/sessions/$SESSION_ID/runs/$RUN_ID/stream" 2>/dev/null \
    | python3 -c "
import sys, json
buf = ''
for chunk in iter(lambda: sys.stdin.read(1), ''):
    buf += chunk
    while '\n\n' in buf:
        raw, buf = buf.split('\n\n', 1)
        event, data = 'message', ''
        for line in raw.split('\n'):
            if line.startswith('event: '): event = line[7:]
            elif line.startswith('data: '): data += line[6:]
        if not data: continue
        try:
            payload = json.loads(data)
        except: continue
        if event == 'chunk':
            sys.stdout.write(payload.get('data', ''))
            sys.stdout.flush()
        elif event == 'end':
            print(f\"\n[{payload.get('status','?')} — exit {payload.get('exitCode','n/a')}]\n\")
            sys.exit(0)
"
  echo
}

# 4. Run several tools end-to-end
bold "4. DNS recon"
run_tool dig-recon

bold "5. WHOIS lookup"
run_tool whois-lookup

bold "6. HTTP headers"
run_tool curl-headers

bold "7. Quick port probe"
run_tool port-probe

bold "8. TLS certificate inspect"
run_tool tls-cert

echo
bold "═══════════════════════════════════════════════════════════════════"
ok "Demo complete. Open the web console at: $BACKEND_URL"
bold "═══════════════════════════════════════════════════════════════════"
echo
