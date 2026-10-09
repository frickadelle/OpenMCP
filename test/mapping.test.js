import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compiled, manual } from './helpers.js';
import { buildRequest, credentials } from '../src/http.js';
import { redact } from '../src/errors.js';

test('path encoding, base path, query types, arrays and headers map without name collisions', async () => {
  const { selected: [tool] } = await compiled();
  const request = buildRequest(tool, { path: { id: 'a/b ?#%' }, query: { id: 'other', limit: 4, active: false, tags: ['a b', 'c'] }, headers: { 'X-Trace': 'trace' } });
  const url = new URL(request.url);
  assert.equal(url.pathname, '/base/items/a%2Fb%20%3F%23%25');
  assert.equal(url.searchParams.get('id'), 'other'); assert.equal(url.searchParams.get('limit'), '4');
  assert.equal(url.searchParams.get('active'), 'false'); assert.deepEqual(url.searchParams.getAll('tags'), ['a b', 'c']);
  assert.equal(request.options.headers['X-Trace'], 'trace'); assert.equal(request.options.redirect, 'manual');
});
test('non-exploded form query arrays serialize with commas', async () => {
  const config = manual(); config.sources[0].endpoints[0].parameters.find(p => p.name === 'tags').explode = false;
  const { selected: [tool] } = await compiled(config);
  assert.equal(new URL(buildRequest(tool, { path: { id: '1' }, query: { tags: ['a', 'b'] } }).url).searchParams.get('tags'), 'a,b');
});
test('JSON bodies preserve nested payload and content-type', async () => {
  const config = manual({ tools: [{ source: 'api', operation: 'create', name: 'create_item' }] });
  const { selected: [tool] } = await compiled(config);
  const { options } = buildRequest(tool, { body: { title: 'A new item' } });
  assert.equal(options.method, 'POST'); assert.equal(options.body, '{"title":"A new item"}'); assert.equal(options.headers['Content-Type'], 'application/json');
});
test('input errors, missing parameters and additional inputs fail before HTTP', async () => {
  const { selected: [tool] } = await compiled();
  for (const args of [{}, { path: { id: 3 } }, { path: { id: '1' }, query: { limit: '4' } }, { path: { id: '1' }, unexpected: true }, { path: { id: '1' }, query: { nope: true } }]) {
    assert.throws(() => buildRequest(tool, args), /Invalid tool input/);
  }
});
test('custom schema can narrow input; cannot bypass underlying API mapping', async () => {
  const config = manual(); config.tools[0].inputSchema = { type: 'object', properties: { path: { type: 'object', properties: { id: { type: 'string', pattern: '^item-' } }, required: ['id'], additionalProperties: false } }, required: ['path'], additionalProperties: false };
  const { selected: [tool] } = await compiled(config);
  assert.throws(() => buildRequest(tool, { path: { id: '1' } }), /Invalid tool input/);
  assert.equal(new URL(buildRequest(tool, { path: { id: 'item-1' } }).url).pathname, '/base/items/item-1');
  config.tools[0].inputSchema = { type: 'object' };
  const { selected: [loose] } = await compiled(config);
  assert.throws(() => buildRequest(loose, {}), /API parameter mapping/);
});
test('path dot-segments and header newlines are rejected', async () => {
  const { selected: [tool] } = await compiled();
  assert.throws(() => buildRequest(tool, { path: { id: '..' } }), /dot segments/);
  assert.throws(() => buildRequest(tool, { path: { id: '1' }, headers: { 'X-Trace': 'a\r\nb' } }), /newlines/);
});
for (const auth of [{ type: 'bearer', env: 'TOKEN' }, { type: 'apiKey', env: 'TOKEN', in: 'header', name: 'X-API-Key' }, { type: 'apiKey', env: 'TOKEN', in: 'query', name: 'key' }]) {
  test(`${auth.type} ${auth.in ?? 'header'} auth comes only from named environment variable`, async () => {
    const config = manual(); config.sources[0].auth = auth;
    const { selected: [tool] } = await compiled(config);
    const secrets = credentials(config, { TOKEN: 'synthetic-secret' });
    const req = buildRequest(tool, { path: { id: '1' } }, secrets.get('api'));
    if (auth.type === 'bearer') assert.equal(req.options.headers.Authorization, 'Bearer synthetic-secret');
    else if (auth.in === 'header') assert.equal(req.options.headers['X-API-Key'], 'synthetic-secret');
    else assert.equal(new URL(req.url).searchParams.get('key'), 'synthetic-secret');
    assert.throws(() => credentials(config, {}), /TOKEN is missing/);
    assert.throws(() => credentials(config, { TOKEN: ' ' }), /empty/);
    assert.throws(() => credentials(config, { TOKEN: 'a\nb' }), /newline/);
    assert(!JSON.stringify(config).includes('synthetic-secret'));
  });
}
test('redaction handles exact, URL-encoded and JSON-escaped credential values', () => {
  const secret = 'k/"\\ key';
  const value = `${secret} ${encodeURIComponent(secret)} ${JSON.stringify(secret)} Bearer other-secret api_key=other-secret`;
  const result = redact(value, [secret]);
  assert(!result.includes(secret)); assert(!result.includes(encodeURIComponent(secret))); assert(!result.includes('other-secret'));
});


test('header overrides are case-insensitive and do not duplicate default Accept', async () => {
  const config = manual();
  config.sources[0].endpoints[0].parameters.push({ name: 'accept', in: 'header', schema: { type: 'string' } });
  const { selected: [tool] } = await compiled(config);
  const { options } = buildRequest(tool, { path: { id: '1' }, headers: { accept: 'text/plain' } });
  assert.equal(new Headers(options.headers).get('accept'), 'text/plain');
});

test('non-exploded query arrays reject ambiguous comma-containing items', async () => {
  const config = manual(); config.sources[0].endpoints[0].parameters.find(p => p.name === 'tags').explode = false;
  const { selected: [tool] } = await compiled(config);
  assert.throws(() => buildRequest(tool, { path: { id: '1' }, query: { tags: ['a,b'] } }), /explode: true/);
});
