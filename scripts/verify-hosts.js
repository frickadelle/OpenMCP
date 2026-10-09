// Optional acceptance proof against installed CLIs, with an isolated temporary home.
// No model request: Codex's app-server API drives its actual MCP connection.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { hostTargets, connectHost } from '../src/hosts.js';

const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'openmcp-installed-hosts-'));
let calls = 0;
const api = createServer((req, res) => {
  if (req.url !== '/notes/1' || req.headers.authorization !== 'Bearer synthetic-proof-token') {
    res.writeHead(403); res.end(); return;
  }
  calls++; res.setHeader('Content-Type', 'application/json');
  res.end('{"note":"host proof"}');
});
let child;
try {
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const config = { version: 1, name: 'host-proof', timeoutMs: 2000,
    sources: [{ id: 'api', baseUrl: `http://127.0.0.1:${api.address().port}`,
      auth: { type: 'bearer', env: 'HOST_PROOF_TOKEN' }, endpoints: [{ id: 'read',
        method: 'GET', path: '/notes/{id}', parameters: [{ name: 'id', in: 'path',
          required: true, schema: { type: 'string' } }] }] }],
    tools: [{ source: 'api', operation: 'read', name: 'read_note' }] };
  const configPath = join(directory, 'project.yaml');
  await writeFile(configPath, JSON.stringify(config));
  const env = { HOME: directory, PATH: process.env.PATH, TERM: 'xterm',
    CODEX_HOME: join(directory, '.codex'), XDG_CONFIG_HOME: join(directory, '.config'),
    XDG_DATA_HOME: join(directory, '.local/share'), XDG_CACHE_HOME: join(directory, '.cache'),
    HOST_PROOF_TOKEN: 'synthetic-proof-token', OTEL_SDK_DISABLED: 'true',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true' };
  const hosts = await hostTargets({ home: directory, env, appDirs: [] });
  for (const host of hosts.filter(h => h.id !== 'claude-desktop' && h.executable && !h.error)) {
    await connectHost(host, configPath);
  }
  const codex = hosts.find(h => h.id === 'codex');
  if (!codex.executable) throw new Error('Installed Codex CLI is required for real list/call proof.');
  child = spawn(codex.executable, ['app-server', '--stdio'], { env, cwd: directory,
    stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let buffer = ''; let id = 0;
  child.stderr.on('data', () => {});
  const failPending = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on('error', failPending);
  child.on('exit', () => failPending(new Error('Codex app-server exited before answering.')));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error('Codex app-server request failed.'));
      else request.resolve(message.result);
    }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const number = ++id;
    const timer = setTimeout(() => { pending.delete(number); reject(new Error(`${method} timed out.`)); }, 15000);
    pending.set(number, { resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id: number, method, params }) + '\n');
  });
  await request('initialize', { clientInfo: { name: 'openmcp-host-proof', version: '1' },
    capabilities: { experimentalApi: true } });
  child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const { thread } = await request('thread/start', { cwd: directory, ephemeral: true,
    approvalPolicy: 'on-request', sandbox: 'read-only' });
  const list = await request('mcpServerStatus/list', { threadId: thread.id, serverName: 'openmcp_host-proof' });
  if (!list.data?.some(server => server.name === 'openmcp_host-proof' && server.tools?.read_note)) {
    throw new Error('Codex did not list the configured tool.');
  }
  const result = await request('mcpServer/tool/call', { threadId: thread.id,
    server: 'openmcp_host-proof', tool: 'read_note', arguments: { path: { id: '1' } } });
  if (result.isError || !JSON.stringify(result).includes('host proof') || calls !== 1) {
    throw new Error('Codex did not perform the single authenticated API read.');
  }
  console.log('PASS Codex: real tool list and authenticated read; no LLM request.');
  child.kill('SIGTERM'); await once(child, 'exit'); child = undefined;
  for (const host of hosts.filter(h => ['claude-code', 'opencode'].includes(h.id))) {
    if (!host.executable || host.error) { console.log(`SKIP ${host.name}: compatible CLI unavailable.`); continue; }
    const { stdout } = await exec(host.executable, ['mcp', 'list', ...(host.id === 'opencode' ? ['--pure'] : [])],
      { env, cwd: directory, timeout: 15000 });
    const line = stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split('\n').find(line => line.includes('openmcp_host-proof'));
    if (!line || !/\bconnected\b/i.test(line) || /disconnected|not connected|failed/i.test(line)) {
      throw new Error(`${host.name} did not report the fixture connected.`);
    }
    console.log(`PASS ${host.name}: connected status (tool call not tested).`);
  }
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
