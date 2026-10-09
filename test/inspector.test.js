import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDemoApi } from '../examples/api.js';
import { loadConfig } from '../src/config.js';
import { temp, exec, root, manual, api } from './helpers.js';

const inspector = join(root, 'node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js');
for (const example of ['openapi', 'manual']) test(`MCP Inspector 2.10.1 consumes exported ${example} configuration and lists/calls tools`, async t => {
  const demo = createDemoApi(); demo.listen(0, '127.0.0.1'); await once(demo, 'listening');
  t.after(() => new Promise(resolve => { demo.closeAllConnections(); demo.close(resolve); }));
  const { config } = await loadConfig(join(root, `examples/${example}.config.yaml`));
  config.sources[0].baseUrl = `http://127.0.0.1:${demo.address().port}`;
  if (config.sources[0].spec) config.sources[0].spec = join(root, 'examples/openapi.yaml');
  const dir = await temp(t); const configPath = join(dir, 'config.json'); await writeFile(configPath, JSON.stringify(config));
  const exported = await exec(process.execPath, [join(root, 'src/cli.js'), 'export', '-c', configPath]);
  const clientPath = join(dir, 'mcp.json'); await writeFile(clientPath, exported.stdout);
  const run = args => exec(process.execPath, [inspector, '--cli', '--config', clientPath, '--server', config.name, '--format', 'json', ...args], { timeout: 20000, env: { ...process.env, MCP_INSPECTOR_SECRET_STORE: 'memory' } });
  const list = JSON.parse((await run(['--method', 'tools/list'])).stdout).result;
  assert.deepEqual(list.tools.map(t => t.name), config.tools.map(t => t.name));
  const read = JSON.parse((await run(['--method', 'tools/call', '--tool-name', config.tools[0].name, '--tool-args-json', '{"path":{"id":"1"}}'])).stdout).result;
  assert(!read.isError); assert.equal(JSON.parse(read.content[0].text).title, 'Hello MCP');
  const write = JSON.parse((await run(['--method', 'tools/call', '--tool-name', config.tools[1].name, '--tool-args-json', '{"body":{"title":"Inspector note"}}'])).stdout).result;
  assert(!write.isError); assert.equal(JSON.parse(write.content[0].text).title, 'Inspector note');
});
test('Inspector authenticated launch uses runtime env override; exported file contains no secrets', async t => {
  const server = await api(t, (req, res) => { const authorized = req.headers.authorization === 'Bearer fixture-token'; res.writeHead(authorized ? 200 : 401, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); });
  const config = manual(); config.sources[0].baseUrl = server.baseUrl; config.sources[0].auth = { type: 'bearer', env: 'FIXTURE_TOKEN' };
  const dir = await temp(t); const path = join(dir, 'config.json'); await writeFile(path, JSON.stringify(config));
  const exported = await exec(process.execPath, [join(root, 'src/cli.js'), 'export', '-c', path]); assert(!exported.stdout.includes('fixture-token'));
  const clientPath = join(dir, 'mcp.json'); await writeFile(clientPath, exported.stdout);
  const result = await exec(process.execPath, [inspector, '--cli', '--config', clientPath, '--server', config.name, '-e', 'FIXTURE_TOKEN=fixture-token', '--format', 'json', '--method', 'tools/call', '--tool-name', 'read_item', '--tool-args-json', '{"path":{"id":"1"}}'], { timeout: 20000, env: { ...process.env, MCP_INSPECTOR_SECRET_STORE: 'memory' } });
  assert.equal(JSON.parse(result.stdout).result.content[0].text, '{"status":"ok"}'); assert.equal(server.requests.length, 1);
});
