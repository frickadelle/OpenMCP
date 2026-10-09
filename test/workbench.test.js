import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { manual, temp, exec, root } from './helpers.js';
import { discoverProjects, readProjects, readProject, toolsFor, sourceRows, toggleTool, updateSettings } from '../src/workbench-store.js';
import { createViewState, frameLines, formFor } from '../src/workbench.js';
import { compileProject } from '../src/importer.js';
import { exportClient } from '../src/client.js';

async function project(t, config = manual()) {
  const dir = await temp(t); const path = join(dir, 'project.yaml'); await writeFile(path, JSON.stringify(config)); return readProject(path);
}
test('project discovery finds local versioned configurations, skips unrelated files and shows invalid projects', async t => {
  const dir = await temp(t);
  await writeFile(join(dir, 'one.yaml'), JSON.stringify(manual()));
  await writeFile(join(dir, 'two.json'), JSON.stringify(manual({ name: 'second' })));
  await writeFile(join(dir, 'package.json'), '{"name":"unrelated"}');
  await writeFile(join(dir, 'api.yaml'), 'openapi: 3.1.0\ninfo: {}');
  await writeFile(join(dir, 'open-mcp-broken.yaml'), '{broken');
  await mkdir(join(dir, 'nested')); await writeFile(join(dir, 'nested', 'hidden.yaml'), JSON.stringify(manual()));
  assert.equal((await discoverProjects(dir)).length, 3);
  const projects = await readProjects(dir); assert.equal(projects.filter(p => p.config).length, 2); assert.equal(projects.filter(p => !p.config).length, 1);
  assert.equal(sourceRows(projects).length, 3);
  assert.deepEqual(await discoverProjects(dir, [join(dir, 'one.yaml'), join(dir, 'one.yaml')]), [join(dir, 'one.yaml')]);
});
test('toggle persists enabled state and preserves customized name, description and input schema across restarts', async t => {
  const config = manual(); config.tools[0].name = 'custom_read'; config.tools[0].description = 'Our own description'; config.tools[0].inputSchema = { type: 'object' };
  let p = await project(t, config);
  p = await toggleTool(p, 'api', 'read');
  assert.equal(p.config.tools[0].enabled, false);
  assert.equal((await compileProject(p.config, p.directory)).selected.length, 0);
  p = await readProject(p.path); assert.equal(toolsFor(p, 'api')[0].enabled, false);
  p = await toggleTool(p, 'api', 'read');
  assert.deepEqual(p.config.tools[0], { ...config.tools[0], enabled: true });
  assert.equal((await compileProject(p.config, p.directory)).selected[0].name, 'custom_read');
});
test('enabling an unselected operation adds its definition without enabling other tools', async t => {
  let p = await project(t, manual({ tools: [] })); p = await toggleTool(p, 'api', 'create');
  assert.deepEqual((await compileProject(p.config, p.directory)).selected.map(t => t.operation), ['create']);
  assert.equal(toolsFor(p, 'api').find(t => t.operation === 'read').enabled, false);
});
test('stale config and invalid settings leave disk unchanged', async t => {
  const p = await project(t); const changed = JSON.stringify({ ...p.config, name: 'edited-outside' }); await writeFile(p.path, changed);
  await assert.rejects(toggleTool(p, 'api', 'read'), /ausserhalb/); assert.equal(await readFile(p.path, 'utf8'), changed);
  const fresh = await readProject(p.path);
  await assert.rejects(updateSettings(fresh, 'api', { baseUrl: 'https://user:password@example.com', auth: { type: 'none' }, timeoutMs: 1000 }), /credentials/);
  assert.equal(await readFile(p.path, 'utf8'), changed);
  await assert.rejects(updateSettings(fresh, 'api', { baseUrl: 'https://example.com', auth: { type: 'bearer', env: 'TOKEN', token: 'never-store' }, timeoutMs: 1000 }), /additional properties/);
  assert.equal(await readFile(p.path, 'utf8'), changed);
});
test('settings store base URL, timeout and credential variable name without a secret value', async t => {
  let p = await project(t);
  p = await updateSettings(p, 'api', { baseUrl: 'https://api.example.test/v1', auth: { type: 'bearer', env: 'API_TOKEN' }, timeoutMs: 12000 });
  const config = (await readProject(p.path)).config;
  assert.equal(config.timeoutMs, 12000); assert.equal(config.sources[0].baseUrl, 'https://api.example.test/v1');
  assert.deepEqual(config.sources[0].auth, { type: 'bearer', env: 'API_TOKEN' });
});
test('UI frames animate the MCP name left, support small terminals and keep Settings save visible', async t => {
  const p = await project(t); const state = createViewState([p]);
  const before = frameLines(state, 90, 28).find(l => l.text === state.rows[0].title);
  state.progress = 1;
  const after = frameLines(state, 90, 28).find(l => l.text === state.rows[0].title);
  assert(before.x > after.x); assert.equal(after.x, 2);
  assert(frameLines(state, 40, 10).some(l => l.text.includes('vergroessern')));
  state.mode = 'settings'; state.form = formFor(p, 'api', true);
  for (const height of [18, 24, 28, 40]) {
    const lines = frameLines(state, 80, height);
    assert(lines.some(l => l.text.includes('Speichern') && l.y < height - 3));
    assert(lines.every(l => l.y < height));
  }
  p.config.sources[0].id = 'malicious\x1b[2J';
  assert(frameLines(createViewState([p], false), 90, 28).every(l => !l.text.includes('\x1b')));
});
test('no-argument launch refuses pipes without terminal control sequences', async () => {
  await assert.rejects(exec(process.execPath, [join(root, 'src/cli.js')]), error => {
    assert.equal(error.stdout, ''); assert(!error.stderr.includes('\x1b')); assert.match(error.stderr, /interaktives Terminal/); return true;
  });
});
test('a restarted SDK MCP client cannot list or call a disabled tool', async t => {
  let p = await project(t); p = await toggleTool(p, 'api', 'read');
  const entry = exportClient(p.path, p.config.name).mcpServers[p.config.name];
  const transport = new StdioClientTransport({ ...entry, stderr: 'pipe' }); transport.stderr.on('data', () => {});
  const client = new Client({ name: 'dashboard-toggle-test', version: '1' }); t.after(() => client.close());
  await client.connect(transport);
  assert.equal(client.getServerVersion().name, p.config.name);
  assert.deepEqual((await client.listTools()).tools, []);
  assert.equal((await client.callTool({ name: 'read_item', arguments: { path: { id: '1' } } })).isError, true);
});
