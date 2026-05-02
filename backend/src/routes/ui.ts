import type { FastifyInstance } from "fastify";

/**
 * Single-page web UI served from the backend root. Lets a user create a
 * session, pick a tool, and watch live scan output without installing the
 * VS Code extension. All HTML/JS is inlined so there are zero static assets
 * to host or version.
 */
export function registerUiRoutes(app: FastifyInstance) {
  app.get("/", async (_req, reply) => {
    reply.type("text/html").send(HTML);
  });
  app.get("/ui", async (_req, reply) => {
    reply.type("text/html").send(HTML);
  });
}

const HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pentest IDE — Web Console</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #0d1117; color: #c9d1d9; min-height: 100vh;
  }
  header {
    background: linear-gradient(135deg, #1f6feb 0%, #8957e5 100%);
    padding: 24px 32px; color: #fff;
    border-bottom: 1px solid #30363d;
  }
  header h1 { margin: 0; font-size: 24px; font-weight: 600; }
  header p { margin: 4px 0 0; opacity: .85; font-size: 14px; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 32px; display: grid; grid-template-columns: 380px 1fr; gap: 24px; }
  @media (max-width: 900px) { main { grid-template-columns: 1fr; } }
  .panel { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; }
  .panel h2 { margin: 0 0 16px; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #8b949e; font-weight: 600; }
  label { display: block; font-size: 12px; color: #8b949e; margin: 12px 0 4px; text-transform: uppercase; letter-spacing: .04em; }
  input, select, textarea, button {
    width: 100%; padding: 8px 12px; font-size: 14px; font-family: inherit;
    background: #0d1117; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px;
  }
  input:focus, select:focus { outline: none; border-color: #1f6feb; }
  button {
    background: #238636; color: #fff; border-color: #238636; font-weight: 600;
    cursor: pointer; transition: background .15s;
  }
  button:hover:not(:disabled) { background: #2ea043; }
  button:disabled { opacity: .5; cursor: not-allowed; }
  button.secondary { background: #21262d; color: #c9d1d9; border-color: #30363d; }
  button.secondary:hover:not(:disabled) { background: #30363d; }
  button.danger { background: #da3633; border-color: #da3633; }
  .row { display: flex; gap: 8px; }
  .row > * { flex: 1; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .pill.recon { background: #1f6feb33; color: #79c0ff; }
  .pill.scan { background: #fb950033; color: #ffa657; }
  .pill.web { background: #8957e533; color: #d2a8ff; }
  .pill.infra { background: #23863633; color: #7ee787; }
  .tool-card {
    padding: 12px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px; cursor: pointer;
    transition: border-color .15s, background .15s;
  }
  .tool-card:hover { border-color: #1f6feb; background: #1f6feb11; }
  .tool-card.selected { border-color: #1f6feb; background: #1f6feb22; }
  .tool-card .name { font-weight: 600; font-size: 14px; }
  .tool-card .desc { font-size: 12px; color: #8b949e; margin-top: 4px; }
  pre.output {
    background: #010409; color: #c9d1d9; padding: 16px; border-radius: 6px; overflow: auto;
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 12.5px; line-height: 1.5;
    min-height: 400px; max-height: 600px; white-space: pre-wrap; word-break: break-all;
    border: 1px solid #30363d;
  }
  .status-bar {
    display: flex; gap: 8px; align-items: center; padding: 8px 12px; background: #0d1117; border-radius: 6px;
    margin-bottom: 12px; font-size: 13px; border: 1px solid #30363d;
  }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; }
  .status-dot.queued { background: #8b949e; }
  .status-dot.running { background: #fb9500; animation: pulse 1.2s ease-in-out infinite; }
  .status-dot.succeeded { background: #2ea043; }
  .status-dot.failed { background: #da3633; }
  .status-dot.cancelled { background: #8b949e; }
  .status-dot.timeout { background: #fb9500; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  .empty { color: #8b949e; font-size: 13px; text-align: center; padding: 32px 16px; }
  .session-card {
    padding: 10px 12px; border: 1px solid #30363d; border-radius: 6px; margin-bottom: 8px;
    cursor: pointer; display: flex; justify-content: space-between; align-items: center;
  }
  .session-card.active { border-color: #1f6feb; background: #1f6feb22; }
  .session-card .name { font-weight: 600; font-size: 14px; }
  .session-card .scope { font-size: 11px; color: #8b949e; margin-top: 2px; }
  .demo-banner {
    background: #1f6feb22; border: 1px solid #1f6feb55; padding: 12px 16px; border-radius: 6px;
    margin-bottom: 16px; font-size: 13px;
  }
  .demo-banner strong { color: #79c0ff; }
  .small { font-size: 12px; color: #8b949e; }
</style>
</head>
<body>
<header>
  <h1>🛡 Pentest IDE — Web Console</h1>
  <p>Run reconnaissance and scanning tools against authorized targets, watch results stream live.</p>
</header>

<main>
  <aside>
    <div class="panel">
      <h2>1. Connect</h2>
      <label>Backend URL</label>
      <input id="backend-url" value="" placeholder="http://localhost:8787">
      <label>API key</label>
      <input id="api-key" type="password" placeholder="dev-key-change-me">
      <div class="row" style="margin-top: 12px;">
        <button id="connect-btn">Connect</button>
      </div>
      <div id="connect-status" class="small" style="margin-top: 8px;"></div>
    </div>

    <div class="panel" style="margin-top: 16px;" id="sessions-panel" hidden>
      <h2>2. Sessions</h2>
      <div id="sessions-list"></div>
      <label>New session name</label>
      <input id="new-session-name" placeholder="acme-engagement">
      <label>Scope (comma-separated, optional)</label>
      <input id="new-session-scope" placeholder="scanme.nmap.org">
      <div style="margin-top: 8px;">
        <button id="create-session-btn" class="secondary">Create session</button>
      </div>
    </div>

    <div class="panel" style="margin-top: 16px;" id="demo-panel" hidden>
      <h2>Quick demo</h2>
      <div class="demo-banner">
        <strong>scanme.nmap.org</strong> is a public test target maintained by the Nmap project.
        Click below to create a session, scan it, and watch the results.
      </div>
      <button id="demo-btn">▶ Run quick demo (DNS recon)</button>
    </div>
  </aside>

  <section>
    <div class="panel" id="tools-panel" hidden>
      <h2>3. Pick a tool</h2>
      <div id="tools-list"></div>

      <div id="run-form" style="margin-top: 16px;" hidden>
        <label>Target</label>
        <input id="run-target" placeholder="scanme.nmap.org">
        <div id="tool-args"></div>
        <div style="margin-top: 12px;">
          <button id="run-btn">▶ Run</button>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top: 16px;" id="output-panel" hidden>
      <h2>4. Live output</h2>
      <div class="status-bar">
        <span class="status-dot" id="run-status-dot"></span>
        <span id="run-status-text">idle</span>
        <span style="flex:1"></span>
        <button id="cancel-btn" class="secondary danger" style="width: auto; padding: 4px 12px;" hidden>Cancel</button>
      </div>
      <pre class="output" id="run-output"></pre>
    </div>
  </section>
</main>

<script>
const $ = (id) => document.getElementById(id);
const state = {
  baseUrl: '',
  apiKey: '',
  session: null,
  selectedTool: null,
  currentRun: null,
  abortStream: null,
};

(function init() {
  $('backend-url').value = location.origin;
  const savedKey = localStorage.getItem('pentest-ide.apiKey');
  if (savedKey) $('api-key').value = savedKey;
})();

async function api(method, path, body) {
  const res = await fetch(state.baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + state.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.message || err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

$('connect-btn').onclick = async () => {
  state.baseUrl = $('backend-url').value.trim().replace(/\/+$/, '');
  state.apiKey = $('api-key').value.trim();
  if (!state.baseUrl || !state.apiKey) {
    $('connect-status').textContent = '❌ URL and API key are required';
    return;
  }
  localStorage.setItem('pentest-ide.apiKey', state.apiKey);
  try {
    await api('GET', '/v1/sessions');
    $('connect-status').textContent = '✓ connected to ' + state.baseUrl;
    $('connect-status').style.color = '#7ee787';
    $('sessions-panel').hidden = false;
    $('demo-panel').hidden = false;
    await loadSessions();
    await loadTools();
  } catch (err) {
    $('connect-status').textContent = '❌ ' + err.message;
    $('connect-status').style.color = '#ffa198';
  }
};

async function loadSessions() {
  const { sessions } = await api('GET', '/v1/sessions');
  const html = sessions.length === 0
    ? '<div class="empty">No sessions yet — create one below.</div>'
    : sessions.map(s => 
        '<div class="session-card ' + (state.session?.id === s.id ? 'active' : '') + '" onclick="selectSession(\'' + s.id + '\')">' +
        '<div><div class="name">' + escapeHtml(s.name) + '</div><div class="scope">' + (s.scope.length ? escapeHtml(s.scope.join(', ')) : 'no scope') + '</div></div>' +
        '<button class="secondary danger" style="width: auto; padding: 4px 8px;" onclick="event.stopPropagation();deleteSession(\'' + s.id + '\')">×</button>' +
        '</div>'
      ).join('');
  $('sessions-list').innerHTML = html;
  // store sessions globally for selectSession
  state.allSessions = sessions;
}

window.selectSession = (id) => {
  state.session = state.allSessions.find(s => s.id === id);
  loadSessions();
  $('tools-panel').hidden = false;
};

window.deleteSession = async (id) => {
  if (!confirm('Delete this session?')) return;
  await api('DELETE', '/v1/sessions/' + id);
  if (state.session?.id === id) state.session = null;
  await loadSessions();
};

$('create-session-btn').onclick = async () => {
  const name = $('new-session-name').value.trim();
  if (!name) return;
  const scope = $('new-session-scope').value.split(',').map(s => s.trim()).filter(Boolean);
  await api('POST', '/v1/sessions', { name, scope });
  $('new-session-name').value = '';
  $('new-session-scope').value = '';
  await loadSessions();
};

async function loadTools() {
  const { tools } = await api('GET', '/v1/tools');
  state.allTools = tools;
  $('tools-list').innerHTML = tools.map(t =>
    '<div class="tool-card" onclick="selectTool(\'' + t.id + '\')">' +
    '<div class="name">' + escapeHtml(t.label) + ' <span class="pill ' + t.category + '">' + t.category + '</span></div>' +
    '<div class="desc">' + escapeHtml(t.description) + '</div>' +
    '</div>'
  ).join('');
}

window.selectTool = (id) => {
  state.selectedTool = state.allTools.find(t => t.id === id);
  document.querySelectorAll('.tool-card').forEach(el => el.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  $('run-form').hidden = false;
  if (state.session?.scope?.[0]) $('run-target').value = state.session.scope[0];
  // build arg inputs
  const argsHtml = state.selectedTool.argsSchema.map(a => {
    if (a.type === 'enum') {
      return '<label>' + escapeHtml(a.label) + '</label><select id="arg-' + a.name + '">' +
        a.options.map(o => '<option value="' + o + '"' + (a.default == o ? ' selected' : '') + '>' + o + '</option>').join('') +
        '</select>';
    }
    return '<label>' + escapeHtml(a.label) + (a.help ? ' <span class="small">— ' + escapeHtml(a.help) + '</span>' : '') + '</label>' +
      '<input id="arg-' + a.name + '" value="' + (a.default !== undefined ? a.default : '') + '" placeholder="' + escapeHtml(a.label) + '">';
  }).join('');
  $('tool-args').innerHTML = argsHtml;
};

$('run-btn').onclick = async () => {
  if (!state.session) { alert('Pick a session first'); return; }
  if (!state.selectedTool) { alert('Pick a tool first'); return; }
  const target = $('run-target').value.trim();
  if (!target) { alert('Enter a target'); return; }

  const args = {};
  for (const a of state.selectedTool.argsSchema) {
    const el = $('arg-' + a.name);
    if (!el || !el.value) continue;
    if (a.type === 'number') args[a.name] = Number(el.value);
    else if (a.type === 'boolean') args[a.name] = el.value === 'true';
    else args[a.name] = el.value;
  }

  $('output-panel').hidden = false;
  $('run-output').textContent = '';
  await startRun({ sessionId: state.session.id, toolId: state.selectedTool.id, target, args });
};

async function startRun(payload) {
  const run = await api('POST', '/v1/sessions/' + payload.sessionId + '/runs', {
    toolId: payload.toolId,
    target: payload.target,
    args: payload.args || {},
  });
  state.currentRun = run;
  setStatus(run.status);
  $('cancel-btn').hidden = false;
  $('run-output').textContent = '$ ' + run.command.join(' ') + '\n\n';
  await streamRun(run);
}

async function streamRun(run) {
  const url = state.baseUrl + '/v1/sessions/' + run.sessionId + '/runs/' + run.id + '/stream';
  const ctrl = new AbortController();
  state.abortStream = ctrl;

  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + state.apiKey },
    signal: ctrl.signal,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message', data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === 'chunk') {
        $('run-output').textContent += parsed.data;
        $('run-output').scrollTop = $('run-output').scrollHeight;
      } else if (event === 'end') {
        setStatus(parsed.status);
        $('cancel-btn').hidden = true;
        $('run-output').textContent += '\n[run ' + parsed.status + ' — exit ' + (parsed.exitCode ?? 'n/a') + ']\n';
      }
    }
  }
}

$('cancel-btn').onclick = async () => {
  if (!state.currentRun) return;
  await api('DELETE', '/v1/sessions/' + state.currentRun.sessionId + '/runs/' + state.currentRun.id);
  if (state.abortStream) state.abortStream.abort();
};

function setStatus(status) {
  $('run-status-dot').className = 'status-dot ' + status;
  $('run-status-text').textContent = status;
}

$('demo-btn').onclick = async () => {
  $('demo-btn').disabled = true;
  $('demo-btn').textContent = 'Running…';
  try {
    let session = (state.allSessions || []).find(s => s.name === 'quick-demo');
    if (!session) {
      session = await api('POST', '/v1/sessions', { name: 'quick-demo', scope: ['scanme.nmap.org'] });
      await loadSessions();
    }
    state.session = session;
    await loadSessions();
    $('tools-panel').hidden = false;
    $('output-panel').hidden = false;
    $('run-output').textContent = '';
    await startRun({ sessionId: session.id, toolId: 'dig-recon', target: 'scanme.nmap.org' });
  } catch (err) {
    alert('Demo failed: ' + err.message);
  } finally {
    $('demo-btn').disabled = false;
    $('demo-btn').textContent = '▶ Run quick demo (DNS recon)';
  }
};

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
</script>
</body>
</html>`;
