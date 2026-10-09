import SwaggerParser from '@apidevtools/swagger-parser';
import { resolve } from 'node:path';
import { readDocument } from './config.js';
import { assert, UserError } from './errors.js';
import { normalizeSchema, safeName, validator } from './schema.js';

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const objectSchema = () => ({ type: 'object', properties: {}, additionalProperties: false });
const reservedHeaders = new Set(['authorization', 'proxy-authorization', 'host', 'content-type', 'content-length', 'connection', 'cookie', 'transfer-encoding']);
function inspectReferences(value, ancestors = new Set()) {
  if (!value || typeof value !== 'object') return;
  assert(!ancestors.has(value), 'Recursive YAML aliases are not supported.');
  const next = new Set(ancestors).add(value);
  if (value.$ref) {
    assert(typeof value.$ref === 'string' && value.$ref.startsWith('#/'), 'Only local #/ references are supported; bundle external references first.');
    assert(Object.keys(value).every(k => ['$ref', 'summary', 'description'].includes(k)), '$ref siblings beyond summary/description are not supported.');
  }
  for (const child of Object.values(value)) inspectReferences(child, next);
}
async function specification(source, directory) {
  let doc;
  if (source.spec) doc = await readDocument(resolve(directory, source.spec));
  else {
    doc = { openapi: '3.1.0', info: { title: source.id, version: '1' }, paths: {} };
    for (const endpoint of source.endpoints) {
      const method = endpoint.method.toLowerCase();
      doc.paths[endpoint.path] ??= {};
      assert(!doc.paths[endpoint.path][method], `Duplicate endpoint: ${endpoint.method} ${endpoint.path}.`);
      doc.paths[endpoint.path][method] = {
        operationId: endpoint.id, description: endpoint.description, parameters: endpoint.parameters,
        responses: { '200': { description: 'API response' } },
        ...(endpoint.requestBody ? { requestBody: { required: endpoint.requestBody.required,
          content: { 'application/json': { schema: endpoint.requestBody.schema } } } } : {})
      };
    }
    // Strip optional undefined properties before OpenAPI validation.
    doc = JSON.parse(JSON.stringify(doc));
  }
  assert(/^3\.(0|1)\.\d+$/.test(doc?.openapi), 'Only OpenAPI 3.0.x and 3.1.x are supported.');
  inspectReferences(doc);
  try {
    return await SwaggerParser.validate(doc, { resolve: { external: false }, dereference: { circular: false } });
  } catch {
    // Parser errors can contain spec examples/credentials. Give safe structural guidance.
    throw new UserError(`Source ${source.id}: invalid OpenAPI document, unresolved reference or recursive schema. Check info, paths, responses and local references with an OpenAPI validator.`);
  }
}
function authRequirement(operation, doc) {
  const requirements = operation.security ?? doc.security ?? [];
  if (!requirements.length || requirements.some(r => Object.keys(r).length === 0)) return undefined;
  const alternatives = requirements.map(req => {
    assert(Object.keys(req).length === 1, 'Combined security schemes are not supported.');
    const [name, scopes] = Object.entries(req)[0];
    assert(scopes.length === 0, 'OAuth scopes are not supported.');
    const scheme = doc.components?.securitySchemes?.[name];
    if (scheme?.type === 'http' && scheme.scheme.toLowerCase() === 'bearer') return { type: 'bearer' };
    if (scheme?.type === 'apiKey' && ['header', 'query'].includes(scheme.in)) return { type: 'apiKey', in: scheme.in, name: scheme.name };
    throw new UserError(`Unsupported authentication scheme: ${name}. Only bearer and header/query API keys are supported.`);
  });
  return alternatives;
}
export function matchesAuth(auth, requirements) {
  return !requirements || requirements.some(r => auth.type === r.type &&
    (r.type !== 'apiKey' || (auth.in === r.in && (r.in === 'header' ? auth.name.toLowerCase() === r.name.toLowerCase() : auth.name === r.name))));
}
function compileOperation(source, doc, path, method, pathItem, op) {
  assert(path.startsWith('/') && !path.startsWith('//') && !/[?#\\]/.test(path), 'Operation paths must start with / and cannot contain query, fragment or backslash.');
  assert(!op.servers && !pathItem.servers, 'Operation/path server overrides are not supported; use a separate source.');
  assert(!op.callbacks, 'OpenAPI callbacks are not supported.');
  const schema = objectSchema();
  const parameters = new Map();
  for (const list of [pathItem.parameters ?? [], op.parameters ?? []]) {
    const duplicates = new Set();
    for (const p of list) {
      const key = `${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`;
      assert(!duplicates.has(key), `Duplicate parameter: ${key}.`); duplicates.add(key); parameters.set(key, p);
    }
  }
  const normalized = [];
  for (const p of parameters.values()) {
    safeName(p.name);
    assert(['path', 'query', 'header'].includes(p.in), `Unsupported parameter location: ${p.in}.`);
    assert(p.schema && !p.content, `Parameter ${p.name}: content parameters are not supported.`);
    assert(!p.allowReserved && !p.allowEmptyValue, `Parameter ${p.name}: allowReserved/allowEmptyValue are not supported.`);
    const group = p.in === 'header' ? 'headers' : p.in;
    const sub = normalizeSchema(p.schema, doc.openapi);
    const scalar = ['string', 'integer', 'number', 'boolean'];
    assert(scalar.includes(sub.type) || (p.in === 'query' && sub.type === 'array' && scalar.includes(sub.items?.type)),
      `Parameter ${p.name}: only scalar parameters and scalar query arrays are supported.`);
    assert((p.style ?? (p.in === 'query' ? 'form' : 'simple')) === (p.in === 'query' ? 'form' : 'simple'),
      `Parameter ${p.name}: unsupported serialization style.`);
    if (p.in === 'header') {
      assert(/^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/.test(p.name) && !reservedHeaders.has(p.name.toLowerCase()), `Parameter ${p.name}: reserved/invalid header; configure authentication separately.`);
    }
    schema.properties[group] ??= objectSchema();
    schema.properties[group].properties[p.name] = sub;
    if (p.required || p.in === 'path') {
      schema.properties[group].required ??= []; schema.properties[group].required.push(p.name);
      schema.required ??= []; if (!schema.required.includes(group)) schema.required.push(group);
    }
    normalized.push({ name: p.name, in: p.in, explode: p.explode ?? (p.in === 'query'), schema: sub });
  }
  const placeholders = [...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]);
  assert(!path.replace(/\{[^{}]+\}/g, '').match(/[{}]/), 'Malformed path template.');
  assert(placeholders.every(n => normalized.some(p => p.in === 'path' && p.name === n)), 'Every path placeholder needs a path parameter.');
  assert(normalized.filter(p => p.in === 'path').every(p => placeholders.includes(p.name)), 'Path parameter is missing from the path template.');
  if (op.requestBody) {
    assert(!['get', 'head'].includes(method), 'GET/HEAD request bodies are not supported.');
    const content = op.requestBody.content;
    assert(content && Object.keys(content).length === 1 && content['application/json'], 'Only a single application/json request body is supported; multipart/forms/binary are not supported.');
    schema.properties.body = normalizeSchema(content['application/json'].schema, doc.openapi);
    if (op.requestBody.required) { schema.required ??= []; schema.required.push('body'); }
  }
  validator(schema);
  return { source, operation: op.operationId || `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), path,
    description: op.description || op.summary || `${method.toUpperCase()} ${path}`, parameters: normalized,
    inputSchema: schema, authRequirements: authRequirement(op, doc) };
}
export async function catalogSource(source, directory) {
  const doc = await specification(source, directory);
  assert(!doc.webhooks, 'OpenAPI webhooks are not supported.');
  assert(!doc.jsonSchemaDialect || doc.jsonSchemaDialect === 'https://json-schema.org/draft/2020-12/schema', 'Custom OpenAPI JSON Schema dialects are not supported.');
  const catalog = []; const ids = new Set();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!methods.has(method) && method !== 'trace') continue;
      const operation = op.operationId || `${method.toUpperCase()} ${path}`;
      assert(!ids.has(operation), `Source ${source.id}: duplicate operation id ${operation}.`); ids.add(operation);
      try {
        assert(method !== 'trace', 'TRACE operations are not supported.');
        catalog.push(compileOperation(source, doc, path, method, item, op));
      }
      catch (error) {
        if (!(error instanceof UserError)) throw error;
        catalog.push({ source, operation, method: method.toUpperCase(), path, error: error.message });
      }
    }
  }
  assert(catalog.length, `Source ${source.id} has no operations.`);
  return catalog;
}
export async function compileProject(config, directory) {
  const catalog = (await Promise.all(config.sources.map(s => catalogSource(s, directory)))).flat();
  const selected = config.tools.map(tool => {
    const operation = catalog.find(o => o.source.id === tool.source && o.operation === tool.operation);
    assert(operation, `Tool ${tool.name}: operation ${tool.operation} was not found in source ${tool.source}.`);
    assert(!operation.error, `Tool ${tool.name}: ${operation.error}`);
    assert(matchesAuth(operation.source.auth, operation.authRequirements), `Tool ${tool.name}: configure authentication matching the OpenAPI security requirement.`);
    const auth = operation.source.auth;
    assert(auth.type !== 'apiKey' || !operation.parameters.some(p => p.in === auth.in &&
      (p.in === 'header' ? p.name.toLowerCase() === auth.name.toLowerCase() : p.name === auth.name)),
      `Tool ${tool.name}: API-key parameter conflicts with configured authentication. Remove it from the input parameters.`);
    const inputSchema = tool.inputSchema ? normalizeSchema(tool.inputSchema) : operation.inputSchema;
    assert(inputSchema.type === 'object', `Tool ${tool.name}: inputSchema must be an object.`);
    return { ...operation, name: tool.name, description: tool.description ?? operation.description, inputSchema,
      checkInput: validator(inputSchema), checkMapping: validator(operation.inputSchema) };
  });
  return { catalog, selected };
}
export function suggestedName(source, operation) {
  return `${source}_${operation}`.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 64);
}
