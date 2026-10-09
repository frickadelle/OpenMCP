import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer as httpsServer } from 'node:https';
import { request } from 'node:http';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startHttpServer } from '../src/http-server.js';
import { createDeployment, publicDomain } from '../src/deploy.js';
import { validateConfig, loadConfig } from '../src/config.js';
import { compileProject } from '../src/importer.js';
import { exportClient } from '../src/client.js';
import { hostEntry, requiredHostEnv } from '../src/hosts.js';
import { api, manual, temp, exec, root } from './helpers.js';
import { parse } from 'yaml';

const token = 'synthetic-access-token-with-64-characters-for-self-host-proof-only';
async function service(t, config = manual(), env = {}) {
  const instance = await startHttpServer(config, root, { port: 0, publicUrl: 'https://mcp.example.com/mcp', env: { OPEN_MCP_ACCESS_TOKEN: token, ...env } });
  t.after(() => instance.close()); return { ...instance, url: `http://127.0.0.1:${instance.port}/mcp` };
}
test('real HTTP SDK client lists selected tools, validates input, maps authenticated read/write and does not retry writes', async t => {
  const fixture = await api(t, (req, res) => { assert.equal(req.headers.authorization, 'Bearer api-fixture-secret'); res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); });
  const config = manual(); config.sources[0].baseUrl = fixture.baseUrl; config.sources[0].auth = { type: 'bearer', env: 'API_TOKEN' };
  config.tools.push({ source: 'api', operation: 'create', name: 'create_item' });
  const server = await service(t, config, { API_TOKEN: 'api-fixture-secret' });
  const client = new Client({ name: 'self-host-test', version: '1' }); t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  assert.deepEqual((await client.listTools()).tools.map(t => t.name), ['read_item', 'create_item']);
  assert.equal((await client.callTool({ name: 'read_item', arguments: { path: { id: 3 } } })).isError, true);
  assert.equal((await client.callTool({ name: 'unknown', arguments: {} })).isError, true); assert.equal(fixture.requests.length, 0);
  assert.equal((await client.callTool({ name: 'read_item', arguments: { path: { id: 'a/b' }, query: { limit: 2 } } })).isError, undefined);
  assert.equal(fixture.requests[0].url, '/items/a%2Fb?limit=2');
  assert.equal((await client.callTool({ name: 'create_item', arguments: { body: { title: 'test' } } })).isError, undefined);
  assert.equal(fixture.requests.length, 2); assert.equal(fixture.requests[1].method, 'POST');
});
test('HTTP denies missing/wrong access tokens, foreign host/origin and query tokens before any API side effects', async t => {
  const fixture = await api(t, (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{}'); });
  const config = manual(); config.sources[0].baseUrl = fixture.baseUrl;
  const server = await service(t, config);
  const payload = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_item', arguments: { path: { id: '1' } } } };
  for (const headers of [{}, { Authorization: 'Bearer wrong' }]) {
    const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload) });
    assert.equal(response.status, 401); assert(!(await response.text()).includes(token));
  }
  for (const headers of [{ Host: 'evil.example' }, { Origin: 'https://evil.example' }]) {
    const status = await new Promise((resolve, reject) => {
      const req = request(server.url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, ...headers } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(status, 403);
  }
  assert.equal((await fetch(server.url + '?token=' + token)).status, 404);
  const health = await fetch(server.url.replace('/mcp', '/healthz')); assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(fixture.requests.length, 0);
});
test('HTTP refuses weak/missing tokens and bounds request bodies through the SDK', async t => {
  for (const value of [undefined, 'short']) await assert.rejects(startHttpServer(manual(), root, { publicUrl: 'https://mcp.example.com/mcp', env: { OPEN_MCP_ACCESS_TOKEN: value } }), /random token/);
  const server = await service(t);
  const response = await fetch(server.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: 'x'.repeat(1024 * 1024 + 1) });
  assert.equal(response.status, 413);
});
test('reusable deployment bundles manual and OpenAPI sources, preserves selections and excludes unrelated files/secrets', async t => {
  const directory = await temp(t); const path = join(directory, 'project.yaml');
  const config = manual(); config.sources.push({ id: 'notes', baseUrl: 'https://api.example.com', auth: { type: 'none' }, spec: join(root, 'examples/openapi.yaml') });
  config.tools.push({ source: 'notes', operation: 'getNote', name: 'note', enabled: false });
  await writeFile(path, JSON.stringify(config)); await writeFile(join(directory, '.env'), 'SECRET=never-copy-this');
  const before = await readFile(path, 'utf8'); const output = join(directory, 'deployment');
  const result = await createDeployment(path, { domain: 'mcp.example.com', output, apiUrls: { api: 'https://api.example.com/v1' } });
  assert.equal(await readFile(path, 'utf8'), before);
  const deployed = await loadConfig(join(output, 'project/open-mcp.yaml'));
  assert.equal(deployed.config.hosting.publicUrl, 'https://mcp.example.com/mcp');
  assert.equal((await compileProject(deployed.config, deployed.directory)).selected.length, 1);
  assert.equal(deployed.config.tools[1].enabled, false); assert(!deployed.config.sources[1].spec.startsWith('/'));
  assert.equal((await stat(join(output, 'project/open-mcp.yaml'))).mode & 0o777, 0o600);
  const compose = parse(await readFile(join(output, 'compose.yaml'), 'utf8'));
  assert.equal(compose.services.openmcp.ports, undefined); assert.deepEqual(compose.services.caddy.ports, ['80:80', '443:443']);
  assert.match(compose.services.openmcp.environment.OPEN_MCP_ACCESS_TOKEN, /Set OPEN_MCP_ACCESS_TOKEN/);
  assert(!Object.keys(compose.services.openmcp.environment).includes('SECRET'));
  assert(!(await readdir(output)).includes('.env')); assert.deepEqual(result.tokenNames, ['OPEN_MCP_ACCESS_TOKEN']);
  await assert.rejects(createDeployment(path, { domain: 'mcp.example.com', output }), /already exists/);
  await assert.rejects(createDeployment(path, { domain: 'mcp.example.com', output: join(directory, 'bad'), tokenEnv: 'HOME', apiUrls: { api: 'https://api.example.com' } }), /system\/runtime/);
});
test('deployment validates domain, inaccessible loopback API and credential collisions before writing', async t => {
  for (const value of ['https://mcp.example.com', 'localhost', '127.0.0.1', 'mcp.example.com/evil', '*.example.com', 'x\n}']) assert.throws(() => publicDomain(value));
  const dir = await temp(t); const path = join(dir, 'project.yaml'); await writeFile(path, JSON.stringify(manual()));
  await assert.rejects(createDeployment(path, { domain: 'mcp.example.com', output: join(dir, 'out') }), /localhost/);
  await assert.rejects(stat(join(dir, 'out')), { code: 'ENOENT' });
  const config = manual(); config.hosting = { publicUrl: 'https://mcp.example.com/mcp', tokenEnv: 'API_TOKEN' }; config.sources[0].auth = { type: 'bearer', env: 'API_TOKEN' };
  assert.throws(() => validateConfig(config), /differ/);
});
test('remote host/export configuration uses only the access-token name and never forwards API credentials', () => {
  const config = manual(); config.hosting = { publicUrl: 'https://mcp.example.com/mcp', tokenEnv: 'MCP_ACCESS' };
  config.sources[0].auth = { type: 'bearer', env: 'API_TOKEN' };
  assert.deepEqual(requiredHostEnv(config), ['MCP_ACCESS']);
  for (const id of ['codex', 'claude-code', 'opencode']) {
    const entry = hostEntry({ id }, '/private/project.yaml', config); const text = JSON.stringify(entry);
    assert(text.includes('bridge')); assert(text.includes('MCP_ACCESS')); assert(!text.includes('API_TOKEN')); assert(!text.includes(token));
  }
  assert(exportClient('/project.yaml', config.name, config.hosting).mcpServers[config.name].args.includes('bridge'));
});
test('remote stdio bridge verifies HTTPS, forwards list/call and works with a real SDK stdio client', async t => {
  const dir = await temp(t); const key = join(dir, 'key.pem'); const cert = join(dir, 'cert.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost']);
  const apiSecret = 'private-api-credential-never-needed-on-client';
  const fixture = await api(t, (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${apiSecret}`);
    res.setHeader('Content-Type', 'text/plain'); res.end(`bridge reached API ${apiSecret} ${token}`);
  });
  const config = manual(); config.sources[0].baseUrl = fixture.baseUrl;
  config.sources[0].auth = { type: 'bearer', env: 'API_TOKEN' };
  const server = await service(t, config, { API_TOKEN: apiSecret });
  let redirect = false; let redirects = 0;
  const proxy = httpsServer({ key: await readFile(key), cert: await readFile(cert) }, (incoming, outgoing) => {
    if (redirect) { redirects++; incoming.resume(); outgoing.writeHead(307, { Location: '/mcp' }); outgoing.end(); return; }
    const headers = { ...incoming.headers, host: `127.0.0.1:${server.port}` }; delete headers.origin;
    const upstream = request(server.url, { method: incoming.method, headers }, response => { outgoing.writeHead(response.statusCode, response.headers); response.pipe(outgoing); });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); }); incoming.pipe(upstream);
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); t.after(() => { proxy.closeAllConnections(); return new Promise(resolve => proxy.close(resolve)); });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/cli.js'), 'bridge', '--url', `https://localhost:${proxy.address().port}/mcp`],
    env: { OPEN_MCP_ACCESS_TOKEN: token, NODE_EXTRA_CA_CERTS: cert }, stderr: 'pipe' });
  let logs = ''; transport.stderr.on('data', chunk => { logs += chunk; });
  const client = new Client({ name: 'bridge-proof', version: '1' }); t.after(() => client.close()); await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, 'read_item');
  const result = await client.callTool({ name: 'read_item', arguments: { path: { id: '1' } } });
  assert(result.content[0].text.includes('bridge reached API')); assert.equal(fixture.requests.length, 1);
  assert(!result.content[0].text.includes(token)); assert(!result.content[0].text.includes(apiSecret)); assert(!logs.includes(token));
  redirect = true;
  await assert.rejects(client.listTools(), /Remote MCP request failed/);
  assert.equal(redirects, 1); assert.equal(fixture.requests.length, 1);
});
