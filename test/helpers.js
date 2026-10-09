import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateConfig } from '../src/config.js';
import { compileProject } from '../src/importer.js';
export const exec = promisify(execFile);
export const root = new URL('../', import.meta.url).pathname;
export async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'open-mcp-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
export async function api(t, handler) {
  const requests = [];
  const server = createServer((req, res) => { requests.push(req); handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { server, requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
export function manual(overrides = {}) {
  return { version: 1, name: 'test-project', timeoutMs: 1000,
    sources: [{ id: 'api', baseUrl: 'http://127.0.0.1:3001/base', auth: { type: 'none' }, endpoints: [
      { id: 'read', method: 'GET', path: '/items/{id}', parameters: [
        { in: 'path', name: 'id', required: true, schema: { type: 'string' } },
        { in: 'query', name: 'id', schema: { type: 'string' } },
        { in: 'query', name: 'limit', schema: { type: 'integer', minimum: 1 } },
        { in: 'query', name: 'active', schema: { type: 'boolean' } },
        { in: 'query', name: 'tags', schema: { type: 'array', items: { type: 'string' } } },
        { in: 'header', name: 'X-Trace', schema: { type: 'string' } }
      ] },
      { id: 'create', method: 'POST', path: '/items', requestBody: { required: true, schema: { type: 'object', properties: { title: { type: 'string', minLength: 1 } }, required: ['title'], additionalProperties: false } } }
    ] }], tools: [{ source: 'api', operation: 'read', name: 'read_item' }], ...overrides };
}
export async function compiled(config = manual()) {
  validateConfig(config); return compileProject(config, root);
}
export function spec(paths, extra = {}) {
  return { openapi: '3.1.0', info: { title: 'Test', version: '1' }, paths, ...extra };
}
export async function fromSpec(t, document, tools = []) {
  const dir = await temp(t); await writeFile(join(dir, 'spec.json'), JSON.stringify(document));
  const config = manual({ sources: [{ id: 'api', baseUrl: 'http://127.0.0.1:3001', auth: { type: 'none' }, spec: 'spec.json' }], tools });
  validateConfig(config); return { config, directory: dir, ...await compileProject(config, dir) };
}
