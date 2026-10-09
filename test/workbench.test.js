import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { manual, temp, exec, root } from './helpers.js';
import { discoverProjects, readProjects, readProject, toolsFor, sourceRows, toggleTool, updateSettings } from '../src/workbench-store.js';
import { createViewState, frameLines, formFor, openToolPane, advanceBuild, moveSelection, listMouse, quitKey } from '../src/workbench.js';
import { compileProject } from '../src/importer.js';
import { projectFileForName } from '../src/wizard.js';
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
  await assert.rejects(toggleTool(p, 'api', 'read'), /outside/); assert.equal(await readFile(p.path, 'utf8'), changed);
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
test('UI title stays fixed, supports small terminals and keeps Settings save visible', async t => {
  const p = await project(t); const state = createViewState([p]);
  state.progress = 0.12;
  const before = frameLines(state, 90, 28).find(l => l.text === state.rows[0].title);
  state.progress = 1;
  const after = frameLines(state, 90, 28).find(l => l.text === state.rows[0].title);
  assert.equal(before.x, after.x); assert.equal(after.x, 2);
  assert(frameLines(state, 40, 10).some(l => l.text.includes('Resize')));
  state.mode = 'settings'; state.form = formFor(p, 'api', true);
  for (const height of [18, 24, 28, 40]) {
    const lines = frameLines(state, 80, height);
    assert(lines.some(l => l.text.includes('Save') && l.y < height - 3));
    assert(lines.every(l => l.y < height));
  }
  p.config.sources[0].id = 'malicious\x1b[2J';
  assert(frameLines(createViewState([p], false), 90, 28).every(l => !l.text.includes('\x1b')));
});
test('no-argument launch refuses pipes without terminal control sequences', async () => {
  await assert.rejects(exec(process.execPath, [join(root, 'src/cli.js')]), error => {
    assert.equal(error.stdout, ''); assert(!error.stderr.includes('\x1b')); assert.match(error.stderr, /interactive terminal/); return true;
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

test('ASCII panels and animated cards never overwrite another element, including long tool names', async t => {
  const config = manual({ name: 'a-long-project-title-for-layout-testing' });
  config.tools[0].name = 'very_long_tool_name_that_needs_clipping';
  const p = await project(t, config); const state = createViewState([p]);
  for (const width of [64, 80, 100, 180]) for (const height of [18, 24, 28, 40]) {
    for (const progress of [0, 0.12, 0.48, 0.72, 0.96, 1]) {
      state.mode = 'browse'; state.progress = progress;
      const lines = frameLines(state, width, height);
      const cells = new Set();
      for (const line of lines) for (let i = 0; i < line.text.length; i++) {
        const x = line.x + i; const key = `${x},${line.y}`;
        assert(x < width && line.y < height, `outside ${width}x${height}: ${key}`);
        assert(!cells.has(key), `overlap ${width}x${height} at progress ${progress}: ${key}`);
        cells.add(key);
      }
      assert(lines.some(l => l.text.startsWith('+ YOUR MCPs')));
      assert(lines.some(l => l.text.startsWith('+ TOOLCALLS')));
      if (progress === 1) assert(lines.some(l => l.text === '[ ON ]'));
    }
    state.mode = 'settings'; state.form = formFor(p, 'api', true);
    for (const field of [0, 6, 7]) {
      state.field = field;
      const lines = frameLines(state, width, height); const cells = new Set();
      for (const line of lines) for (let i = 0; i < line.text.length; i++) {
        const key = `${line.x + i},${line.y}`;
        assert(!cells.has(key), `settings overlap ${width}x${height}: ${key}`); cells.add(key);
      }
      assert(lines.some(l => l.text.includes('[ Save ]')));
    }
  }
});
test('Enter or Right focuses tools once without restarting an existing animation or selection', async t => {
  const p = await project(t); const state = createViewState([p]); openToolPane(state);
  assert.equal(state.pane, 'tools'); assert.equal(state.progress, 1);
  state.progress = 0.72; state.tool = 3; openToolPane(state);
  assert.equal(state.progress, 0.72); assert.equal(state.tool, 3);
  state.progress = 1; openToolPane(state); assert.equal(state.progress, 1);
  const still = createViewState([p], false); openToolPane(still); assert.equal(still.progress, 1);
});

test('tool frames build in place, then remain unchanged with no idle animation', async t => {
  const p = await project(t); const state = createViewState([p]);
  const complete = frameLines(state, 100, 30);
  assert.equal(advanceBuild(state), false);
  assert.deepEqual(frameLines(state, 100, 30), complete);
  state.progress = 0.12;
  const building = frameLines(state, 100, 30);
  const top = building.find(l => l.y === 7 && l.text.startsWith('+ TOOL'));
  const finishedTop = complete.find(l => l.y === 7 && l.text.startsWith('+ TOOL '));
  assert.equal(top.x, finishedTop.x); assert.equal(top.y, finishedTop.y);
  assert(top.text.length < finishedTop.text.length);
  assert(!building.some(l => l.text === 'manual_get' || l.text === p.config.tools[0].name));
  for (let i = 0; i < 30; i++) advanceBuild(state, i * 16);
  assert.equal(state.progress, 1);
  assert.deepEqual(frameLines(state, 100, 30), complete);
  state.progress = 0; state.motion = false; assert.equal(advanceBuild(state), false);
  state.motion = true; state.mode = 'settings'; assert.equal(advanceBuild(state), false);
});

test('MCP list scrolls beyond the viewport and wheel targets the pane beneath the pointer', async t => {
  const projects = [];
  for (let i = 0; i < 7; i++) projects.push(await project(t, manual({ name: `project${i}` })));
  const state = createViewState(projects, false);
  assert.equal(moveSelection(state, -1), false);
  for (let i = 0; i < 6; i++) moveSelection(state, 1);
  assert.equal(state.row, 6);
  const lines = frameLines(state, 80, 24);
  assert(lines.some(l => l.text.includes('> project6')));
  assert(!lines.some(l => l.text.includes('project0')));
  assert(lines.some(l => l.text.includes('7/9 | n: new')));
  openToolPane(state);
  assert.equal(listMouse(state, 'MOUSE_WHEEL_UP', { x: 8, y: 10 }, 80, 24), true);
  assert.equal(state.pane, 'mcps'); assert.equal(state.row, 5);
  listMouse(state, 'MOUSE_WHEEL_DOWN', { x: 40, y: 10 }, 80, 24);
  assert.equal(state.pane, 'tools'); assert.equal(state.tool, 1); assert.equal(state.row, 5);
  const before = structuredClone(state);
  assert.equal(listMouse(state, 'MOUSE_WHEEL_DOWN', { x: 1, y: 1 }, 80, 24), false);
  assert.deepEqual(state, before);
  state.mode = 'settings';
  assert.equal(listMouse(state, 'MOUSE_WHEEL_UP', { x: 8, y: 10 }, 80, 24), false);
});
test('one project labels its API source and permits keyboard selection of setup and demo actions', async t => {
  const config = manual({ name: 'test' }); config.sources[0].id = 'demo'; config.tools = [];
  const p = await project(t, config); const state = createViewState([p], true);
  assert.match(state.status, /One API source/);
  assert(frameLines(state, 80, 24).some(l => l.text === 'API: demo'));
  assert.equal(moveSelection(state, -1), false);
  assert.equal(moveSelection(state, 1), true); assert.equal(state.rows[state.row].action, 'create');
  assert.equal(moveSelection(state, 1), true); assert.equal(state.rows[state.row].action, 'demo');
  assert.equal(moveSelection(state, 1), false);
  openToolPane(state); assert.equal(state.pane, 'mcps');
  const lines = frameLines(state, 80, 24);
  assert(lines.some(l => l.text === '> Try local demo'));
  assert(lines.some(l => l.text.includes('Enter: start setup')));
  assert.equal(state.progress, 1);
  assert.deepEqual((await readProject(p.path)).config, config);
});

test('quit confirmation defaults to cancel, isolates input and preserves the current view on cancellation', async t => {
  const state = createViewState([await project(t)]); openToolPane(state); state.tool = 1;
  const before = structuredClone(state);
  assert.equal(quitKey(state, 'Q'), true); assert.equal(state.quit.confirm, false);
  assert.equal(quitKey(state, 'ENTER'), true); assert.deepEqual(state, before);
  quitKey(state, 'q');
  assert.equal(listMouse(state, 'MOUSE_WHEEL_DOWN', { x: 8, y: 10 }, 80, 24), false);
  quitKey(state, 's'); assert.equal(state.mode, 'browse');
  assert.equal(advanceBuild(state), false);
  quitKey(state, 'ESCAPE'); assert.deepEqual(state, before);
  quitKey(state, 'q'); quitKey(state, 'RIGHT');
  assert.equal(state.quit.confirm, true); assert.equal(quitKey(state, 'ENTER'), 'exit');
  state.quit = undefined; quitKey(state, 'q'); assert.equal(quitKey(state, 'y'), 'exit');
});

test('quit popup renders English controls without overlapping frames at supported terminal sizes', async t => {
  const state = createViewState([await project(t)]); quitKey(state, 'q');
  for (const width of [64, 80, 100]) for (const height of [18, 24, 28]) {
    const lines = frameLines(state, width, height);
    assert(lines.some(l => l.text.includes('Do you really want to quit?')));
    assert(lines.some(l => l.text.includes('> [ Cancel ]')));
    const cells = new Set();
    for (const line of lines) for (let i = 0; i < line.text.length; i++) {
      const key = `${line.x + i},${line.y}`;
      assert(line.x + i < width && line.y < height);
      assert(!cells.has(key), `popup overlap at ${key}`); cells.add(key);
    }
  }
});

test('project name derives a discoverable unused config file without a filename prompt', async t => {
  const dir = await temp(t); await mkdir(join(dir, 'test'));
  assert.equal(projectFileForName(dir, 'test'), join(dir, 'test.yaml'));
  await writeFile(join(dir, 'test.yaml'), 'original');
  await writeFile(join(dir, 'test-2.yaml'), 'original');
  assert.equal(projectFileForName(dir, 'test'), join(dir, 'test-3.yaml'));
  assert.throws(() => projectFileForName(dir, '../outside'), /short name/);
  assert.equal(await readFile(join(dir, 'test.yaml'), 'utf8'), 'original');
});

test('animation follows elapsed time and connect panel scrolls without overlapping existing containers', async t => {
  const p = await project(t); const state = createViewState([p]);
  state.progress = 0;
  advanceBuild(state, 100); advanceBuild(state, 280);
  assert.equal(state.progress, 0.5);
  advanceBuild(state, 460); assert.equal(state.progress, 1);
  assert.equal(advanceBuild(state, 900), false);
  state.mode = 'connect'; state.host = 3;
  state.hosts = ['Codex', 'Claude Code', 'Claude Desktop', 'OpenCode'].map(name => ({ name, status: 'Ready to configure' }));
  for (const width of [64, 80, 100]) for (const height of [18, 24, 28]) {
    const lines = frameLines(state, width, height); const cells = new Set();
    assert(lines.some(l => l.text.includes('> OpenCode')));
    assert(lines.some(l => l.text.includes('Enter: configure')));
    for (const line of lines) for (let i = 0; i < line.text.length; i++) {
      const key = `${line.x + i},${line.y}`;
      assert(line.x + i < width && line.y < height); assert(!cells.has(key), key); cells.add(key);
    }
  }
});
