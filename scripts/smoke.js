// Reproducible automated onboarding timing; not a first-time-user study.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createDemoApi } from '../examples/api.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'open-mcp-smoke-'));
const api = createDemoApi();
const started = performance.now();
try {
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  const project = join(directory, 'project.yaml');
  const cli = args => exec(process.execPath, [join(root, 'src/cli.js'), ...args], { timeout: 20000 });
  await cli(['init', '-c', project, '--name', 'smoke', '--id', 'notes', '--spec', join(root, 'examples/openapi.yaml'),
    '--base-url', `http://127.0.0.1:${api.address().port}`, '--auth', 'none', '--select', 'getNote,createNote']);
  await cli(['validate', '-c', project, '--strict']);
  await cli(['doctor', '-c', project, '--probe', 'notes_getNote', '--args', '{"path":{"id":"1"}}']);
  const exported = await cli(['export', '-c', project]);
  const clientPath = join(directory, 'client.json'); await writeFile(clientPath, exported.stdout);
  const inspect = args => exec(process.execPath, [join(root, 'node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js'),
    '--cli', '--config', clientPath, '--server', 'smoke', '--format', 'json', ...args],
    { timeout: 20000, env: { ...process.env, MCP_INSPECTOR_SECRET_STORE: 'memory' } });
  const list = JSON.parse((await inspect(['--method', 'tools/list'])).stdout).result;
  assert.equal(list.tools.length, 2);
  const call = JSON.parse((await inspect(['--method', 'tools/call', '--tool-name', 'notes_createNote', '--tool-args-json', '{"body":{"title":"Smoke note"}}'])).stdout).result;
  assert(!call.isError); assert.equal(JSON.parse(call.content[0].text).title, 'Smoke note');
  const seconds = (performance.now() - started) / 1000;
  assert(seconds < 300, 'Automated onboarding exceeds five minutes');
  console.log(JSON.stringify({ status: 'passed', elapsedSeconds: Number(seconds.toFixed(3)), scope: 'Automated init -> select -> auth none -> validate -> doctor -> export -> Inspector list/call; dependencies preinstalled' }, null, 2));
} finally {
  api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); await rm(directory, { recursive: true, force: true });
}
