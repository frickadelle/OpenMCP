import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec, root, temp, api, manual, compiled } from './helpers.js';

test('tour explains all five steps without creating files or emitting stdout/ANSI in pipes', async t => {
  const dir = await temp(t);
  const { stdout, stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'tour'], { cwd: dir });
  assert.equal(stdout, '');
  assert(!stderr.includes('\x1b'));
  for (let step = 1; step <= 5; step++) assert(stderr.includes(`Step ${step}/5:`));
  assert.match(stderr, /no files/); assert.match(stderr, /no API calls/);
  assert.match(stderr, /environment variable/); assert.match(stderr, /Inspector/);
  assert.deepEqual(await readdir(dir), []);
});

test('init explains actual next commands, selected tool names and the separate demo API', async t => {
  const dir = await temp(t);
  const { stdout, stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'init', '--config', join(dir, 'notes.yaml'),
    '--name', 'notes', '--id', 'demo', '--spec', join(root, 'examples/openapi.yaml'), '--base-url', 'http://127.0.0.1:3001', '--auth', 'none', '--select', 'getNote']);
  assert.equal(stdout, ''); assert(!stderr.includes('\x1b'));
  assert.match(stderr, /SECOND terminal/); assert.match(stderr, /examples\/api.js/);
  assert.match(stderr, /--probe demo_getNote/); assert.match(stderr, /--server notes/);
  assert.match(stderr, /--tool-name demo_getNote/);
  assert.match(stderr, /does not call the API yet/);
});

test('overriding the example API URL does not suggest starting an unrelated local server', async t => {
  const dir = await temp(t);
  const { stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'init', '--config', join(dir, 'remote.yaml'),
    '--name', 'remote', '--id', 'api', '--spec', join(root, 'examples/openapi.yaml'), '--base-url', 'https://api.example.test', '--auth', 'none', '--select', 'getNote']);
  assert(!stderr.includes('examples/api.js')); assert(!stderr.includes('port 3001'));
  assert.match(stderr, /API is reachable/);
});

test('simple manual reading endpoint derives safe path inputs and rejects query/credentials in paths', async () => {
  const { readingEndpoint } = await import('../src/wizard.js');
  const endpoint = readingEndpoint('/notes/{id}/{id}');
  assert.equal(endpoint.method, 'GET');
  assert.deepEqual(endpoint.parameters, [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
  for (const path of ['https://example.com', '/notes?token=secret', '/notes#frag', '/has space', '/notes\\id']) assert.throws(() => readingEndpoint(path), /URL path/);
});
test('init without explicit file derives filename from name and retains configured source and selection', async t => {
  const dir = await temp(t);
  await exec(process.execPath, [join(root, 'src/cli.js'), 'init', '--name', 'notes', '--id', 'demo', '--spec', join(root, 'examples/openapi.yaml'), '--base-url', 'http://127.0.0.1:3001', '--auth', 'none', '--select', 'getNote'], { cwd: dir });
  const { loadConfig } = await import('../src/config.js');
  const { config } = await loadConfig(join(dir, 'notes.yaml'));
  assert.equal(config.name, 'notes'); assert.equal(config.tools.length, 1);
  const before = await readFile(join(dir, 'notes.yaml'), 'utf8');
  await exec(process.execPath, [join(root, 'src/cli.js'), 'init', '--name', 'notes', '--id', 'demo', '--spec', join(root, 'examples/openapi.yaml'), '--base-url', 'http://127.0.0.1:3001', '--auth', 'none', '--select', 'getNote'], { cwd: dir });
  assert.equal(await readFile(join(dir, 'notes.yaml'), 'utf8'), before);
  assert.equal((await loadConfig(join(dir, 'notes-2.yaml'))).config.name, 'notes');
});

test('manual quick-start endpoint enforces its inferred input and maps one authenticated read', async t => {
  const { readingEndpoint } = await import('../src/wizard.js');
  const { callApi } = await import('../src/http.js');
  const server = await api(t, (req, res) => {
    assert.equal(req.method, 'GET'); assert.equal(req.url, '/v1/notes/a%2Fb');
    assert.equal(req.headers.authorization, 'Bearer synthetic-token');
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
  });
  const config = manual();
  config.sources[0] = { id: 'api', baseUrl: `${server.baseUrl}/v1`, auth: { type: 'bearer', env: 'TOKEN' }, endpoints: [readingEndpoint('/notes/{id}')] };
  const tool = (await compiled(config)).selected[0];
  const options = { secrets: new Map([['api', 'synthetic-token']]) };
  await assert.rejects(callApi(tool, { path: { id: 1 } }, options), /Invalid tool input/);
  assert.equal(server.requests.length, 0);
  assert.equal(await callApi(tool, { path: { id: 'a/b' } }, options), '{"ok":true}');
  assert.equal(server.requests.length, 1);
});
