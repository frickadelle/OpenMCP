import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, compiled, manual } from './helpers.js';
import { callApi } from '../src/http.js';

async function toolAt(baseUrl, method = 'GET') {
  const config = manual(); config.sources[0].baseUrl = baseUrl;
  if (method === 'POST') config.tools = [{ source: 'api', operation: 'create', name: 'write' }];
  return (await compiled(config)).selected[0];
}
const readArgs = { path: { id: '1' } };
test('real HTTP request maps path and query to the upstream API', async t => {
  const server = await api(t, (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ url: req.url, auth: req.headers.authorization })); });
  const result = JSON.parse(await callApi(await toolAt(server.baseUrl), { path: { id: 'a/b' }, query: { active: true } }));
  assert.equal(result.url, '/items/a%2Fb?active=true'); assert.equal(server.requests.length, 1);
});
test('invalid input never reaches the API', async t => {
  const server = await api(t, (_req, res) => res.end());
  await assert.rejects(callApi(await toolAt(server.baseUrl), {}), /Invalid tool input/); assert.equal(server.requests.length, 0);
});
for (const status of [400, 401, 403, 404, 429, 500]) test(`HTTP ${status} produces a safe actionable error; no retry of writes`, async t => {
  const server = await api(t, (_req, res) => { res.writeHead(status); res.end('secret-from-upstream'); });
  await assert.rejects(callApi(await toolAt(server.baseUrl, 'POST'), { body: { title: 'test' } }), error => {
    assert.match(error.message, new RegExp(`HTTP ${status}`)); assert(!error.message.includes('secret-from-upstream')); return true;
  });
  assert.equal(server.requests.length, 1);
});
test('redirect is never followed and credentials never reach the target', async t => {
  const target = await api(t, (_req, res) => res.end('target'));
  const redirect = await api(t, (_req, res) => { res.writeHead(302, { Location: target.baseUrl }); res.end(); });
  const config = manual(); config.sources[0].baseUrl = redirect.baseUrl; config.sources[0].auth = { type: 'bearer', env: 'TOKEN' };
  const tool = (await compiled(config)).selected[0];
  await assert.rejects(callApi(tool, readArgs, { secrets: new Map([['api', 'secret']]) }), /redirects are disabled/);
  assert.equal(target.requests.length, 0);
});
test('timeout includes slow body reads and does not retry', async t => {
  const server = await api(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.write('partial'); });
  await assert.rejects(callApi(await toolAt(server.baseUrl), readArgs, { timeoutMs: 50 }), /timed out after 50 ms/);
  assert.equal(server.requests.length, 1);
});
test('request cancellation is handled', async t => {
  const server = await api(t, (_req, res) => res.writeHead(200)); const controller = new AbortController(); controller.abort();
  await assert.rejects(callApi(await toolAt(server.baseUrl), readArgs, { signal: controller.signal }), /cancelled/);
});
test('connection failure does not expose URL or credentials', async () => {
  await assert.rejects(callApi(await toolAt('http://127.0.0.1:1'), readArgs), /API connection failed/);
});
test('large, binary and malformed JSON responses fail clearly', async t => {
  for (const [type, body, expected] of [['text/plain', 'x'.repeat(1024 * 1024 + 1), /1 MiB/], ['application/octet-stream', 'binary', /content type/], ['application/json', '{broken', /malformed JSON/]]) {
    const server = await api(t, (_req, res) => { res.writeHead(200, { 'Content-Type': type }); res.end(body); });
    await assert.rejects(callApi(await toolAt(server.baseUrl), readArgs), expected);
  }
});
test('successful responses also redact echoed configured secrets', async t => {
  const server = await api(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"token":"synthetic-secret"}'); });
  const tool = await toolAt(server.baseUrl);
  const text = await callApi(tool, readArgs, { secrets: new Map([['api', 'synthetic-secret']]) }); assert(!text.includes('synthetic-secret')); assert.match(text, /REDACTED/);
});
test('204 empty responses work', async t => {
  const server = await api(t, (_req, res) => { res.writeHead(204); res.end(); });
  assert.equal(await callApi(await toolAt(server.baseUrl), readArgs), '(empty response)');
});
