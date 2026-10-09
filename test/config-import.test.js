import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { manual, compiled, spec, fromSpec, temp, root } from './helpers.js';
import { validateConfig, loadConfig, readDocument, saveConfig } from '../src/config.js';
import { compileProject } from '../src/importer.js';
import { normalizeSchema, validator } from '../src/schema.js';
const ok = { responses: { '200': { description: 'OK' } } };

test('OpenAPI YAML, local refs and example config compile', async () => {
  const { config, directory } = await loadConfig(`${root}/examples/openapi.config.yaml`);
  const { catalog, selected } = await compileProject(config, directory);
  assert.equal(catalog.length, 3); assert.deepEqual(selected.map(t => t.name), ['notes_get', 'notes_create']);
  assert.equal(selected[1].inputSchema.properties.body.properties.title.type, 'string');
});
test('OpenAPI 3.1 JSON imports and operationId fallback stays deterministic', async t => {
  const result = await fromSpec(t, spec({ '/health': { get: ok } }), [{ source: 'api', operation: 'GET /health', name: 'health' }]);
  assert.equal(result.selected[0].operation, 'GET /health');
});
test('manual endpoints and multiple sources share one tool catalog', async () => {
  const { config, directory } = await loadConfig(`${root}/examples/multi.config.yaml`);
  const { catalog, selected } = await compileProject(config, directory); assert.equal(catalog.length, 4); assert.equal(selected.length, 2);
});
test('tools are an explicit allowlist including an empty selection', async () => {
  assert.equal((await compiled(manual({ tools: [] }))).selected.length, 0);
  const config = manual(); config.tools[0].operation = 'not-found'; await assert.rejects(compiled(config), /not found/);
});
test('duplicate tool/source/selection names, unknown sources and inline secrets fail', () => {
  const configurations = [];
  const names = manual(); names.tools.push({ source: 'api', operation: 'create', name: 'read_item' }); configurations.push([names, /collision/]);
  const sources = manual(); sources.sources.push(structuredClone(sources.sources[0])); configurations.push([sources, /Duplicate source/]);
  const twice = manual(); twice.tools.push({ ...twice.tools[0], name: 'other' }); configurations.push([twice, /selected twice/]);
  const unknown = manual(); unknown.tools[0].source = 'missing'; configurations.push([unknown, /unknown source/]);
  const secret = manual(); secret.sources[0].auth = { type: 'bearer', env: 'TOKEN', token: 'never-save-this' }; configurations.push([secret, /additional properties/]);
  for (const [config, expected] of configurations) assert.throws(() => validateConfig(config), expected);
});
test('invalid base URLs and ambiguous import sources fail', () => {
  for (const url of ['file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com?token=abc', 'https://example.com/#fragment', 'not-a-url']) {
    const c = manual(); c.sources[0].baseUrl = url; assert.throws(() => validateConfig(c), /baseUrl/);
  }
  const c = manual(); c.sources[0].spec = 'spec.yaml'; assert.throws(() => validateConfig(c), /exactly one/);
});
test('invalid YAML, duplicate keys, missing files and create overwrite fail safely', async t => {
  const dir = await temp(t); const path = join(dir, 'config.yaml');
  await writeFile(path, 'name: first\nname: second\n'); await assert.rejects(readDocument(path), /duplicate keys/);
  await writeFile(path, '{this is broken'); await assert.rejects(readDocument(path), /Invalid JSON\/YAML/);
  await assert.rejects(readDocument(join(dir, 'missing.yaml')), /Cannot read/);
  await saveConfig(path, manual()); const before = await readFile(path, 'utf8');
  await assert.rejects(saveConfig(path, manual(), { create: true }), /exists/); assert.equal(await readFile(path, 'utf8'), before);
});
test('unsupported operation is visible, unselected is allowed, selected fails', async t => {
  const result = await fromSpec(t, spec({ '/file': { post: { ...ok, operationId: 'upload', requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } } } } }));
  assert.match(result.catalog[0].error, /application\/json/);
  result.config.tools = [{ source: 'api', operation: 'upload', name: 'upload' }];
  await assert.rejects(compileProject(result.config, result.directory), /multipart/);
});
for (const [name, parameter, expected] of [
  ['cookie parameters', { in: 'cookie', name: 'session', schema: { type: 'string' } }, /location/],
  ['query objects', { in: 'query', name: 'filter', schema: { type: 'object' } }, /scalar/],
  ['deepObject style', { in: 'query', name: 'filter', style: 'deepObject', schema: { type: 'object' } }, /scalar|style/],
  ['reserved credential headers', { in: 'header', name: 'Authorization', schema: { type: 'string' } }, /reserved/],
  ['allowReserved', { in: 'query', name: 'q', allowReserved: true, schema: { type: 'string' } }, /allowReserved/]
]) test(`unsupported ${name} are diagnosed`, async t => {
  const result = await fromSpec(t, spec({ '/search': { get: { ...ok, parameters: [parameter] } } })); assert.match(result.catalog[0].error, expected);
});
test('path-level parameters can be overridden at operation level', async t => {
  const result = await fromSpec(t, spec({ '/items/{id}': { parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }], get: { ...ok,
    parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'integer' } }] } } }));
  assert.equal(result.catalog[0].inputSchema.properties.path.properties.id.type, 'integer');
});
test('external and circular refs, malformed specs and duplicate operation ids fail', async t => {
  const documents = [
    spec({ '/x': { get: { ...ok, parameters: [{ $ref: 'https://example.com/params.yaml' }] } } }),
    spec({ '/x': { get: ok } }, { components: { schemas: { Node: { type: 'object', properties: { child: { $ref: '#/components/schemas/Node' } } } } } }),
    { openapi: '3.1.0', paths: {} },
    spec({ '/x': { get: { ...ok, operationId: 'same' } }, '/y': { get: { ...ok, operationId: 'same' } } })
  ];
  for (const document of documents) await assert.rejects(fromSpec(t, document), /references|OpenAPI|duplicate operation/i);
});
test('schema restrictions are explicit and OpenAPI 3.0 bounds/nullable normalize', () => {
  assert.throws(() => normalizeSchema({ type: 'string', oneOf: [{ type: 'string' }] }), /oneOf/);
  assert.throws(() => normalizeSchema({ type: 'object', properties: { constructor: { type: 'string' } } }), /reserved/);
  const schema = normalizeSchema({ type: 'number', minimum: 2, exclusiveMinimum: true, nullable: true }, '3.0.3');
  const check = validator(schema); assert(check(3)); assert(!check(2)); assert(check(null));
});
test('OpenAPI auth must match configuration and OAuth is unsupported', async t => {
  const doc = spec({ '/x': { get: { ...ok, operationId: 'read' } } }, { security: [{ bearer: [] }], components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } });
  const result = await fromSpec(t, doc);
  result.config.tools = [{ source: 'api', operation: 'read', name: 'read' }];
  await assert.rejects(compileProject(result.config, result.directory), /authentication matching/);
  result.config.sources[0].auth = { type: 'bearer', env: 'TOKEN' }; assert.equal((await compileProject(result.config, result.directory)).selected.length, 1);
  const oauth = await fromSpec(t, spec({ '/x': { get: ok } }, { security: [{ oauth: ['read'] }], components: { securitySchemes: { oauth: { type: 'oauth2', flows: { implicit: { authorizationUrl: 'https://example.com/auth', scopes: { read: 'Read' } } } } } } }));
  assert.match(oauth.catalog[0].error, /OAuth/);
});
test('duplicate manual endpoints and API-key input collisions fail', async () => {
  const config = manual(); config.sources[0].endpoints.push(structuredClone(config.sources[0].endpoints[0])); await assert.rejects(compiled(config), /Duplicate endpoint/);
  const auth = manual(); auth.sources[0].auth = { type: 'apiKey', env: 'KEY', in: 'header', name: 'x-trace' }; await assert.rejects(compiled(auth), /conflicts/);
});


test('TRACE operations remain visible as unsupported rather than disappearing', async t => {
  const result = await fromSpec(t, spec({ '/x': { trace: ok, get: ok } }));
  assert.equal(result.catalog.length, 2);
  assert.match(result.catalog.find(o => o.method === 'TRACE').error, /TRACE/);
});
