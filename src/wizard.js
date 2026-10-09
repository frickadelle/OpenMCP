import { existsSync } from 'node:fs';
import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { relative, resolve, dirname } from 'node:path';
import { catalogSource, compileProject, suggestedName } from './importer.js';
import { readDocument, saveConfig } from './config.js';
import { assert, UserError } from './errors.js';
import { banner, ribbon, busy } from './ui.js';

const identifier = value => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || 'Use 1-64 letters, digits, underscores or hyphens; start with a letter.';
const parseObject = value => {
  let obj;
  try { obj = JSON.parse(value); } catch { throw new UserError('Enter a valid JSON object.'); }
  assert(obj && typeof obj === 'object' && !Array.isArray(obj), 'Enter a JSON object.'); return obj;
};
const jsonInput = async (message, fallback) => parseObject(await input({ message, default: JSON.stringify(fallback),
  validate: value => { try { parseObject(value); return true; } catch (e) { return e.message; } } }));
async function authWizard(options) {
  const type = options.auth ?? await select({ message: 'Authentication (secrets stay in environment variables)', choices: [
    { name: 'None / public API', value: 'none' }, { name: 'Bearer token', value: 'bearer' }, { name: 'API key', value: 'apiKey' }
  ] });
  if (type === 'none') return { type };
  assert(['bearer', 'apiKey'].includes(type), '--auth must be none, bearer or apiKey.');
  const env = options.env ?? await input({ message: 'Environment variable NAME (do not enter its value)', default: 'MY_API_TOKEN',
    validate: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || 'Enter an environment variable name.' });
  if (type === 'bearer') return { type, env };
  const location = options.keyIn ?? await select({ message: 'API-key location', choices: [{ name: 'Header', value: 'header' }, { name: 'Query', value: 'query' }] });
  const name = options.keyName ?? await input({ message: 'API-key header / query parameter name', default: 'X-API-Key' });
  return { type, env, in: location, name };
}
async function manualEndpoint() {
  const id = await input({ message: 'Operation id', default: 'getItem', validate: identifier });
  const method = await select({ message: 'HTTP method', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] });
  const path = await input({ message: 'Path (e.g. /items/{id})', default: '/items/{id}' });
  const description = await input({ message: 'Tool description', default: 'Get an item by id' });
  const parameters = [];
  for (const name of new Set([...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]))) {
    const schema = await jsonInput(`JSON schema for path parameter ${name}`, { type: 'string' });
    parameters.push({ name, in: 'path', required: true, schema });
  }
  while (await confirm({ message: 'Add a query or header parameter?', default: false })) {
    const name = await input({ message: 'Parameter name' });
    const location = await select({ message: 'Location', choices: ['query', 'header'] });
    const required = await confirm({ message: 'Required?', default: false });
    const schema = await jsonInput('Parameter JSON schema', { type: 'string' });
    parameters.push({ name, in: location, required, schema });
  }
  let requestBody;
  if (!['GET', 'HEAD'].includes(method) && await confirm({ message: 'Add a JSON body?', default: true })) {
    const schema = await jsonInput('JSON body schema', { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false });
    requestBody = { required: await confirm({ message: 'Body required?', default: true }), schema };
  }
  return { id, method, path, description, parameters, ...(requestBody ? { requestBody } : {}) };
}
export async function selectTools(config, directory, sourceId, selectedIds) {
  const catalogs = (await Promise.all(config.sources.filter(s => !sourceId || s.id === sourceId).map(s => catalogSource(s, directory)))).flat();
  const available = catalogs.filter(o => !o.error);
  for (const op of catalogs.filter(o => o.error)) process.stderr.write(`  [unsupported] ${op.source.id}/${op.operation}: ${op.error}\n`);
  assert(available.length, 'No supported operations. Review the documented OpenAPI subset.');
  let selected;
  if (selectedIds !== undefined) {
    const ids = selectedIds === '' ? [] : selectedIds.split(',').map(s => s.trim());
    selected = ids.map(id => {
      const matches = available.filter(o => `${o.source.id}/${o.operation}` === id || (sourceId && o.operation === id));
      assert(matches.length === 1, `Unknown or ambiguous operation: ${id}. Use source/operation.`);
      return matches[0];
    });
  } else {
    selected = await checkbox({ message: 'Select tools to expose (none selected by default for new operations)', choices: available.map(o => ({
      name: `${o.source.id}/${o.operation}  ${o.method} ${o.path}`, value: o,
      checked: config.tools.some(t => t.source === o.source.id && t.operation === o.operation)
    })) });
  }
  const previous = config.tools;
  const tools = sourceId ? previous.filter(t => t.source !== sourceId) : [];
  const customize = selectedIds === undefined && selected.length && await confirm({ message: 'Customize tool names, descriptions or input schemas?', default: false });
  for (const op of selected) {
    const existing = previous.find(t => t.source === op.source.id && t.operation === op.operation);
    const tool = existing ? { ...existing } : { source: op.source.id, operation: op.operation, name: suggestedName(op.source.id, op.operation) };
    if (customize) {
      tool.name = await input({ message: `Tool name for ${op.operation}`, default: tool.name, validate: identifier });
      tool.description = await input({ message: 'Description', default: tool.description ?? op.description });
      if (await confirm({ message: 'Customize the full input JSON schema? API mapping is also validated.', default: false })) {
        tool.inputSchema = await jsonInput('Input schema (keep path/query/headers/body parameter groups)', tool.inputSchema ?? op.inputSchema);
      }
    }
    tools.push(tool);
  }
  config.tools = tools;
  return config;
}
export async function addSource(config, configPath, options = {}) {
  const id = options.id ?? await input({ message: 'API source id', default: config.sources.length ? `api${config.sources.length + 1}` : 'demo', validate: identifier });
  assert(!config.sources.some(s => s.id === id), `Source ${id} already exists.`);
  const mode = options.spec ? 'openapi' : await select({ message: 'Import source', choices: [
    { name: 'Local OpenAPI JSON / YAML file', value: 'openapi' }, { name: 'Manually define REST endpoints', value: 'manual' }
  ] });
  const source = { id };
  let defaultUrl = 'http://127.0.0.1:3001';
  if (mode === 'openapi') {
    const filename = resolve(options.spec ?? await input({ message: 'OpenAPI file path', default: 'examples/openapi.yaml' }));
    source.spec = relative(dirname(resolve(configPath)), filename) || '.';
    const spec = await readDocument(filename);
    defaultUrl = spec?.servers?.[0]?.url ?? defaultUrl;
  } else {
    source.endpoints = [];
    do { source.endpoints.push(await manualEndpoint()); }
    while (await confirm({ message: 'Add another endpoint?', default: false }));
  }
  source.baseUrl = options.baseUrl ?? await input({ message: 'Absolute API base URL (include any base path)', default: defaultUrl });
  await ribbon('Configure auth');
  source.auth = await authWizard(options);
  config.sources.push(source);
  await ribbon('Choose tools');
  await selectTools(config, dirname(resolve(configPath)), id, options.select);
  return config;
}
export async function initialize(configPath, options) {
  assert(!existsSync(configPath), 'Configuration exists; choose another path.');
  banner(); await ribbon('Import API');
  const config = { version: 1, name: options.name ?? await input({ message: 'Project name', default: 'open-mcp', validate: identifier }), timeoutMs: 10000, sources: [], tools: [] };
  await addSource(config, configPath, options);
  await busy('Validate configuration', () => compileProject(config, dirname(resolve(configPath))));
  await saveConfig(configPath, config, { create: true });
  await ribbon('Ready to connect');
  const command = `node ${JSON.stringify(resolve(process.argv[1]))}`;
  process.stderr.write(`\nSaved ${resolve(configPath)}\nNext: ${command} doctor --config ${JSON.stringify(resolve(configPath))}\nThen: ${command} export --config ${JSON.stringify(resolve(configPath))} > client.local.json\n`);
}
