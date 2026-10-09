import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { exec, root, temp } from './helpers.js';

test('tour explains all five steps without creating files or emitting stdout/ANSI in pipes', async t => {
  const dir = await temp(t);
  const { stdout, stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'tour'], { cwd: dir });
  assert.equal(stdout, '');
  assert(!stderr.includes('\x1b'));
  for (let step = 1; step <= 5; step++) assert(stderr.includes(`Schritt ${step}/5:`));
  assert.match(stderr, /keine Datei/); assert.match(stderr, /ruft keine API auf/);
  assert.match(stderr, /Umgebungsvariable/); assert.match(stderr, /Inspector/);
  assert.deepEqual(await readdir(dir), []);
});

test('init explains actual next commands, selected tool names and the separate demo API', async t => {
  const dir = await temp(t);
  const { stdout, stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'init', '--config', join(dir, 'notes.yaml'),
    '--name', 'notes', '--id', 'demo', '--spec', join(root, 'examples/openapi.yaml'), '--base-url', 'http://127.0.0.1:3001', '--auth', 'none', '--select', 'getNote']);
  assert.equal(stdout, ''); assert(!stderr.includes('\x1b'));
  assert.match(stderr, /ZWEITEN Terminal/); assert.match(stderr, /examples\/api.js/);
  assert.match(stderr, /--probe demo_getNote/); assert.match(stderr, /--server notes/);
  assert.match(stderr, /--tool-name demo_getNote/);
  assert.match(stderr, /noch nicht auf/);
});

test('overriding the example API URL does not suggest starting an unrelated local server', async t => {
  const dir = await temp(t);
  const { stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'init', '--config', join(dir, 'remote.yaml'),
    '--name', 'remote', '--id', 'api', '--spec', join(root, 'examples/openapi.yaml'), '--base-url', 'https://api.example.test', '--auth', 'none', '--select', 'getNote']);
  assert(!stderr.includes('examples/api.js')); assert(!stderr.includes('Port 3001'));
  assert.match(stderr, /API erreichbar/);
});
