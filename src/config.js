import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';
import { validator, validateData } from './schema.js';
import { assert, UserError } from './errors.js';

const text = { type: 'string', minLength: 1 };
const ident = { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$' };
const object = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
export const configSchema = object({
  version: { const: 1 }, name: ident, timeoutMs: { type: 'integer', minimum: 1, maximum: 300000 },
  hosting: object({ publicUrl: text, tokenEnv: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } }, ['publicUrl', 'tokenEnv']),
  sources: { type: 'array', minItems: 1, items: object({
    id: ident, baseUrl: text, spec: text,
    auth: { oneOf: [object({ type: { const: 'none' } }, ['type']),
      object({ type: { const: 'bearer' }, env: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } }, ['type', 'env']),
      object({ type: { const: 'apiKey' }, env: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
        in: { enum: ['header', 'query'] }, name: text }, ['type', 'env', 'in', 'name'])] },
    endpoints: { type: 'array', minItems: 1, items: object({
      id: ident, method: { enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
      path: text, description: text,
      parameters: { type: 'array', items: object({ name: text, in: { enum: ['path', 'query', 'header'] },
        required: { type: 'boolean' }, schema: { type: 'object' }, style: text, explode: { type: 'boolean' } }, ['name', 'in', 'schema']) },
      requestBody: object({ required: { type: 'boolean' }, schema: { type: 'object' } }, ['schema'])
    }, ['id', 'method', 'path']) }
  }, ['id', 'baseUrl', 'auth']) },
  tools: { type: 'array', items: object({ source: ident, operation: text, name: ident,
    description: text, inputSchema: { type: 'object' }, enabled: { type: 'boolean' } }, ['source', 'operation', 'name']) }
}, ['version', 'name', 'sources', 'tools']);
const check = validator(configSchema, 'Configuration schema');
export async function readDocument(path) {
  let content;
  try { content = await readFile(path, 'utf8'); }
  catch { throw new UserError(`Cannot read ${path}. Check the path and file permissions.`); }
  assert(Buffer.byteLength(content) <= 5 * 1024 * 1024, 'Document exceeds the 5 MiB limit.');
  try {
    const doc = parseDocument(content, { uniqueKeys: true });
    assert(doc.errors.length === 0, 'Invalid JSON/YAML (syntax or duplicate keys).');
    return doc.toJS({ maxAliasCount: 50 });
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Invalid JSON/YAML or excessive YAML aliases.');
  }
}
export function validateConfig(config) {
  validateData(check, config, 'Invalid configuration');
  if (config.hosting) {
    let url; try { url = new URL(config.hosting.publicUrl); } catch { throw new UserError('Hosting publicUrl must be an HTTPS /mcp URL.'); }
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp', 'Hosting publicUrl must be HTTPS with /mcp and no credentials, query or fragment.');
    assert(!config.sources.some(s => s.auth.env === config.hosting.tokenEnv), 'Hosting token variable must differ from API credential variables.');
  }
  const ids = new Set();
  for (const source of config.sources) {
    assert(!ids.has(source.id), `Duplicate source id: ${source.id}.`); ids.add(source.id);
    assert(Boolean(source.spec) !== Boolean(source.endpoints), `Source ${source.id} needs exactly one of spec or endpoints.`);
    let url;
    try { url = new URL(source.baseUrl); } catch { throw new UserError(`Source ${source.id}: invalid baseUrl.`); }
    assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash,
      `Source ${source.id}: baseUrl must be HTTP(S), without credentials, query or fragment.`);
    assert(!source.baseUrl.includes('{'), `Source ${source.id}: server variables are not supported.`);
    if (source.auth.type === 'apiKey' && source.auth.in === 'header') {
      assert(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(source.auth.name), 'Invalid API-key header name.');
      assert(!['host', 'content-length', 'connection', 'content-type'].includes(source.auth.name.toLowerCase()), 'Reserved API-key header name.');
    }
  }
  const names = new Set(); const operations = new Set();
  for (const tool of config.tools) {
    assert(ids.has(tool.source), `Tool ${tool.name}: unknown source ${tool.source}.`);
    assert(!names.has(tool.name), `Tool name collision: ${tool.name}. Choose a unique name.`); names.add(tool.name);
    const key = JSON.stringify([tool.source, tool.operation]);
    assert(!operations.has(key), `Operation selected twice: ${tool.source}/${tool.operation}.`); operations.add(key);
  }
  return config;
}
export async function loadConfig(path) {
  const absolute = resolve(path);
  return { config: validateConfig(await readDocument(absolute)), directory: dirname(absolute), path: absolute };
}
export async function saveConfig(path, config, { create = false } = {}) {
  validateConfig(config);
  if (create) {
    try { await writeFile(path, stringify(config), { flag: 'wx', mode: 0o600 }); }
    catch (e) { throw new UserError(e.code === 'EEXIST' ? 'Configuration exists; choose another path.' : 'Cannot create configuration.'); }
  } else {
    const temp = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temp, stringify(config), { flag: 'wx', mode: 0o600 }); await rename(temp, path); }
    catch { throw new UserError('Cannot save configuration.'); }
    finally { await unlink(temp).catch(() => {}); }
  }
}
