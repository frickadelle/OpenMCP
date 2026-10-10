import { existsSync } from 'node:fs';
import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { fileURLToPath } from 'node:url';
import { relative, resolve, dirname } from 'node:path';
import { catalogSource, compileProject, suggestedName } from './importer.js';
import { readDocument, saveConfig } from './config.js';
import { assert, UserError } from './errors.js';
import { banner, ribbon, busy, chapter, explain, revealTools } from './ui.js';
import { inspectHosts, connectHost, requiredHostEnv } from './hosts.js';

export function projectFileForName(directory, name) {
  assert(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name), 'Enter a short name, e.g. my-api.');
  let suffix = 1; let path = resolve(directory, `${name}.yaml`);
  while (existsSync(path)) { suffix++; path = resolve(directory, `${name}-${suffix}.yaml`); }
  return path;
}

const demoSpec = fileURLToPath(new URL('../examples/openapi.yaml', import.meta.url));
const shellQuote = value => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
const guided = () => Boolean(process.stdin.isTTY && process.stderr.isTTY);
const identifier = value => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || 'Use 1-64 letters, digits, underscores or hyphens, starting with a letter.';
const parseObject = value => {
  let obj;
  try { obj = JSON.parse(value); } catch { throw new UserError('Enter a valid JSON object, e.g. {"type":"string"}.'); }
  assert(obj && typeof obj === 'object' && !Array.isArray(obj), 'Enter a JSON object enclosed in braces.'); return obj;
};
const jsonInput = async (message, fallback) => parseObject(await input({ message, default: JSON.stringify(fallback),
  validate: value => { try { parseObject(value); return true; } catch (e) { return e.message; } } }));
async function authWizard(options) {
  const type = options.auth ?? await select({ message: options.simple ? 'Does your API need a credential?' : 'How does your API authenticate?', choices: [
    { name: 'No credential / public API', value: 'none' }, { name: 'Bearer token (Authorization header)', value: 'bearer' }, { name: 'API key (header or query)', value: 'apiKey' }
  ] });
  if (type === 'none') return { type };
  assert(['bearer', 'apiKey'].includes(type), '--auth must be none, bearer or apiKey.');
  const env = options.env ?? await input({ message: 'Environment variable name, NOT the credential value', default: 'MY_API_TOKEN',
    validate: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || 'Enter only a variable name, e.g. MY_API_TOKEN.' });
  if (type === 'bearer') return { type, env };
  const location = options.keyIn ?? await select({ message: 'Where does the API expect the key?', choices: [{ name: 'Header', value: 'header' }, { name: 'Query', value: 'query' }] });
  const name = options.keyName ?? await input({ message: 'Header / query parameter name', default: 'X-API-Key' });
  return { type, env, in: location, name };
}
async function manualEndpoint() {
  const id = await input({ message: 'Action name', default: 'getItem', validate: identifier });
  const method = await select({ message: 'HTTP method (GET reads, POST creates)', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] });
  const path = await input({ message: 'URL path (e.g. /items/{id})', default: '/items/{id}' });
  const description = await input({ message: 'What does this action do?', default: 'Read an item by its ID' });
  const parameters = [];
  for (const name of new Set([...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]))) {
    const schema = await jsonInput(`Schema for path parameter ${name}`, { type: 'string' });
    parameters.push({ name, in: 'path', required: true, schema });
  }
  while (await confirm({ message: 'Add a query or header input?', default: false })) {
    const name = await input({ message: 'Input name' });
    const location = await select({ message: 'Location in request', choices: ['query', 'header'] });
    const required = await confirm({ message: 'Must the user provide this value?', default: false });
    const schema = await jsonInput('Input schema (e.g. {"type":"string"})', { type: 'string' });
    parameters.push({ name, in: location, required, schema });
  }
  let requestBody;
  if (!['GET', 'HEAD'].includes(method) && await confirm({ message: 'Send JSON data in the request body?', default: true })) {
    const schema = await jsonInput('JSON body schema', { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false });
    requestBody = { required: await confirm({ message: 'Is the JSON body required?', default: true }), schema };
  }
  return { id, method, path, description, parameters, ...(requestBody ? { requestBody } : {}) };
}
export async function selectTools(config, directory, sourceId, selectedIds, { simple = false } = {}) {
  if (guided() && !simple) explain('What is a tool?', ['A tool is an action your client is allowed to run.', 'GET reads data. POST, PUT, PATCH and DELETE can change data.', 'Space: select. Enter: confirm your selection.', 'In the example, getNote reads a note and createNote creates one.']);
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
    selected = await checkbox({ message: 'Which actions can your client use? (Space to select)', choices: available.map(o => ({
      name: `${['GET', 'HEAD', 'OPTIONS'].includes(o.method) ? '[read]' : '[write]'} ${o.operation} - ${o.description.replaceAll(/\s+/g, ' ').slice(0, 65)} (${o.method} ${o.path})`, value: o,
      checked: config.tools.some(t => t.source === o.source.id && t.operation === o.operation && t.enabled !== false)
    })) });
  }
  const previous = config.tools;
  const tools = sourceId ? previous.filter(t => t.source !== sourceId) : [];
  const customize = !simple && selectedIds === undefined && selected.length && await confirm({ message: 'Customize names, descriptions or schemas? (Optional)', default: false });
  for (const op of selected) {
    const existing = previous.find(t => t.source === op.source.id && t.operation === op.operation);
    const tool = existing ? { ...existing } : { source: op.source.id, operation: op.operation, name: suggestedName(op.source.id, op.operation) };
    if (customize) {
      tool.name = await input({ message: `Tool name for ${op.operation}`, default: tool.name, validate: identifier });
      tool.description = await input({ message: 'Description', default: tool.description ?? op.description });
      if (await confirm({ message: 'Customize the full input schema? (Advanced)', default: false })) {
        tool.inputSchema = await jsonInput('Input schema (keep path/query/headers/body groups)', tool.inputSchema ?? op.inputSchema);
      }
    }
    tool.enabled = true;
    tools.push(tool);
  }
  for (const old of previous) {
    if ((!sourceId || old.source === sourceId) && !tools.some(t => t.source === old.source && t.operation === old.operation)) tools.push({ ...old, enabled: false });
  }
  config.tools = tools;
  return config;
}
export function readingEndpoint(path) {
  assert(typeof path === 'string' && path.startsWith('/') && !/[?#\\\s]/.test(path), 'Enter a URL path, e.g. /notes or /notes/{id}, without query parameters or spaces.');
  const parameters = [...new Set([...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]))]
    .map(name => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  return { id: 'read', method: 'GET', path, description: `Read data: ${path}`, parameters };
}
const validApiAddress = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && !value.includes('{');
  } catch { return false; }
};
const addressInput = fallback => input({
  message: 'What is your API URL?', ...(fallback ? { default: fallback } : {}),
  validate: value => validApiAddress(value) || 'Enter an HTTP(S) URL without credentials, query or placeholders, e.g. https://api.example.com/v1.'
});
async function addSimpleSource(config, configPath, options) {
  let mode = options.demo ? 'demo' : options.spec ? 'openapi' : undefined;
  if (!mode) {
    process.stderr.write('  An OpenAPI file describes the actions your API offers.\n');
    const hasFile = await confirm({ message: 'Do you have an OpenAPI file (YAML or JSON)?', default: false });
    if (hasFile) mode = 'openapi';
    else {
      explain('No problem.', ['Without a file, we need the API URL and one action from its documentation.']);
      mode = await select({ message: 'How would you like to continue?', choices: [
        { name: 'Connect my API - add one read action', value: 'manual' },
        { name: 'Try a local example first', value: 'demo' }
      ] });
    }
  }
  const source = { id: options.id ?? 'api', auth: { type: 'none' } };
  const directory = dirname(resolve(configPath));
  if (mode !== 'manual') {
    const filename = mode === 'demo' ? demoSpec : resolve(options.spec ?? await input({
      message: 'Where is the file?',
      validate: async value => {
        try {
          const path = resolve(value); const doc = await readDocument(path);
          assert(/^3\.[01]\./.test(doc?.openapi ?? ''), 'The file must describe OpenAPI 3.0/3.1, rather than an MCP configuration.');
          const operations = await catalogSource({ ...source, baseUrl: 'http://127.0.0.1', spec: path }, directory);
          assert(operations.some(o => !o.error), operations[0]?.error ?? 'No supported actions in this file.');
          return true;
        } catch (e) { return e instanceof UserError ? e.message : 'Could not read the file.'; }
      }
    }));
    source.spec = relative(directory, filename) || '.';
    const spec = await readDocument(filename);
    const urls = spec?.servers?.map(s => s.url).filter(validApiAddress) ?? [];
    source.baseUrl = options.baseUrl ?? (urls.length === 1 ? urls[0] : await addressInput(urls[0]));
    assert(validApiAddress(source.baseUrl), 'The API URL must use HTTP(S), without credentials or query parameters.');
    process.stderr.write(`  API: ${source.baseUrl}\n`);
  } else {
    explain('Describe one action', ['Find the URL in your API documentation.', 'The path specifies what you want to read, e.g. /notes/{id}.', 'Setup does not guess endpoints or call the API.']);
    source.baseUrl = options.baseUrl ?? await addressInput();
    const path = await input({ message: 'Which path should we read? (e.g. /notes/{id})', validate: async value => {
      try { const [operation] = await catalogSource({ ...source, endpoints: [readingEndpoint(value)] }, directory); assert(!operation.error, operation.error); return true; }
      catch (e) { return e instanceof UserError ? e.message : 'Check the path.'; }
    } });
    source.endpoints = [readingEndpoint(path)];
    process.stderr.write('  GET reads data. Your tool will ask for path parameters such as {id}.\n');
  }
  config.sources.push(source);
  process.stderr.write('\n  Choose the actions your client can use. Space selects, Enter confirms.\n');
  await selectTools(config, directory, source.id, options.select, { simple: true });
  source.auth = await authWizard({ ...options, simple: true });
  if (source.auth.type !== 'none') process.stderr.write(`  Set ${source.auth.env} in your environment before starting. We never save the credential value.\n`);
  return config;
}

export async function addSource(config, configPath, options = {}) {
  if (options.simple) return addSimpleSource(config, configPath, options);
  if (guided()) await chapter(1, 'Describe your API', [
    'OpenAPI is a file describing your API.',
    'Use the ready-made local example to learn the flow.',
    'Without OpenAPI, define individual URLs and inputs manually.'
  ], 'import');
  const id = options.id ?? await input({ message: 'Short name for this API', default: config.sources.length ? `api${config.sources.length + 1}` : 'demo', validate: identifier });
  assert(!config.sources.some(s => s.id === id), `Source ${id} already exists.`);
  const mode = options.spec ? 'openapi' : await select({ message: 'How would you like to start?', choices: [
    { name: 'Try a local example (recommended for learning)', value: 'demo' },
    { name: 'Import your OpenAPI file (JSON / YAML)', value: 'openapi' },
    { name: 'Define REST endpoints manually', value: 'manual' }
  ] });
  const source = { id, auth: { type: 'none' } };
  let defaultUrl = 'http://127.0.0.1:3001';
  if (mode === 'openapi' || mode === 'demo') {
    const filename = mode === 'demo' ? demoSpec : resolve(options.spec ?? await input({ message: 'Path to your OpenAPI file', default: 'examples/openapi.yaml' }));
    source.spec = relative(dirname(resolve(configPath)), filename) || '.';
    const spec = await busy('Read API specification', () => readDocument(filename));
    defaultUrl = spec?.servers?.[0]?.url ?? defaultUrl;
    if (guided()) explain('Specification loaded', [mode === 'demo' ? 'The example is a Notes API: read and create notes.' : 'Import reads your file without making any API requests.',
      'The base URL is your API address. /notes/{id} is appended to it.']);
  } else {
    if (guided()) explain('REST endpoint example', ['GET /items/{id} reads an item.', '{id} is a path parameter. Your tool asks for its value later.', 'A schema describes allowed inputs, e.g. {"type":"string"} for text.']);
    source.endpoints = [];
    do { source.endpoints.push(await manualEndpoint()); }
    while (await confirm({ message: 'Add another endpoint?', default: false }));
  }
  source.baseUrl = options.baseUrl ?? (mode === 'demo' ? defaultUrl : await input({ message: 'API base URL (including e.g. /v1)', default: defaultUrl }));
  config.sources.push(source);
  if (guided()) await chapter(2, 'Choose allowed actions', ['An API can offer many actions. Choose the ones you need.', 'Your configuration stores this selection and determines what the client sees.'], 'tools');
  await selectTools(config, dirname(resolve(configPath)), id, options.select);
  if (guided()) await revealTools(config.tools.filter(t => t.source === id));
  if (guided()) await chapter(3, 'Set up API authentication', [
    mode === 'demo' ? 'The local example needs no token: choose "No credential".' : 'Your API documentation specifies its authentication method.',
    'Bearer tokens and API keys are two credential types.',
    'Enter only a variable name. Set the actual credential outside the configuration.'
  ], 'auth');
  source.auth = await authWizard(options);
  if (guided() && source.auth.type !== 'none') explain('Prepare your environment', [
    `Set ${source.auth.env} to your actual API credential in the launch environment.`,
    'The configuration stores only the name. doctor checks whether a value is present.'
  ]);
  return config;
}
export async function initialize(configPath, options = {}) {
  const simple = options.simple ?? guided();
  if (configPath) assert(!existsSync(configPath), 'This configuration already exists. Choose another path.');
  if (simple) process.stderr.write('\n  + New MCP  ----------------------+\n  | Name -> API -> Tools -> done   |\n  +--------------------------------+\n\n');
  else {
    await banner();
    if (guided()) explain('Your project', ['Your client will display this project name. You can accept the suggestion.', 'A file stores your choices; no server code is needed.']);
  }
  const name = options.name ?? await input({ message: simple ? 'What should your MCP be called?' : 'Project name', default: simple ? 'my-api' : 'open-mcp', validate: identifier });
  configPath ??= projectFileForName(options.directory ?? process.cwd(), name);
  const config = { version: 1, name, timeoutMs: 10000, sources: [], tools: [] };
  await addSource(config, configPath, { ...options, simple });
  if (guided() && !simple) await chapter(4, 'Validate configuration and start locally', ['We now validate the API descriptions and your tool selection.', 'The file is saved only after validation succeeds.'], 'local');
  await busy('Validate configuration', () => compileProject(config, dirname(resolve(configPath))));
  await saveConfig(configPath, config, { create: true });
  if (simple) {
    process.stderr.write(`\n  Done: ${name}. ${config.tools.filter(t => t.enabled !== false).length} tools enabled.\n  Saved to ${configPath}\n  Your MCP client is not connected yet.\n\n`);
  } else {
    await ribbon('Configuration saved');
    if (guided()) await chapter(5, 'Connect your client', ['A client is the program that lists and calls your tools.', 'MCP Inspector is our tested client. It starts Open MCP itself.', 'Saving the configuration does not connect your client yet.'], 'client');
    showConnectionSteps(config, configPath);
  }
  return { path: resolve(configPath), config, simple };
}
export async function finishOnboarding(result, dashboard = false) {
  if (!result.simple) return;
  const choice = await select({ message: 'What next?', choices: [
    { name: dashboard ? 'Back to MCP overview' : 'Done', value: 'done' },
    { name: 'Connect to Codex, Claude or OpenCode', value: 'connect' },
    { name: 'Show me how to connect my client', value: 'client' }
  ] });
  if (choice === 'connect') {
    const connected = await connectWizard(result.path, result.config);
    if (connected) await input({ message: dashboard ? 'Press Enter to return to the MCP overview' : 'Press Enter to finish' });
  }
  if (choice === 'client') {
    showConnectionSteps(result.config, result.path);
    await input({ message: dashboard ? 'Press Enter to return to the MCP overview' : 'Press Enter to finish the guide' });
  }
}
export async function connectWizard(configPath, config) {
  const hosts = await inspectHosts(configPath, config);
  const host = await select({ message: 'Connect to a client', choices: [
    ...hosts.map(host => ({ name: `${host.name} - ${host.status}`, value: host,
      disabled: !host.installed || Boolean(host.error) || host.status === 'Name conflict' })),
    { name: 'Back', value: undefined }
  ] });
  if (!host) return;
  const result = await connectHost(host, configPath);
  process.stderr.write(`\n  Configured for ${host.name}: ${result.name}\n  Restart ${host.name} to load your tools.\n`);
  if (result.backup) process.stderr.write(`  Previous settings saved to ${result.backup}\n`);
  const envs = requiredHostEnv(config);
  if (envs.length) process.stderr.write(`  Required in the host environment: ${envs.join(', ')}\n`);
  process.stderr.write('\n');
  return result;
}
export function showConnectionSteps(config, configPath) {
  const command = `node ${shellQuote(fileURLToPath(new URL('./cli.js', import.meta.url)))}`;
  const configArg = `--config ${shellQuote(resolve(configPath))}`;
  const demoSource = config.sources.find(s => s.spec && s.baseUrl === 'http://127.0.0.1:3001' && resolve(dirname(resolve(configPath)), s.spec) === demoSpec);
  explain('Saved. Here are your next steps:', [`Config: ${resolve(configPath)}`]);
  if (demoSource) {
    process.stderr.write(`  1. Start the example API in a SECOND terminal:\n     node ${shellQuote(fileURLToPath(new URL('../examples/api.js', import.meta.url)))}\n     Leave that terminal open. The API listens on port 3001.\n\n`);
  } else process.stderr.write('  1. Make sure your API is reachable and credentials are set.\n\n');
  process.stderr.write(`  2. Back in this terminal, test your local MCP server:\n     ${command} doctor ${configArg}\n     doctor connects and lists your tools. It does not call the API yet.\n\n`);
  const read = config.tools.find(t => t.source === demoSource?.id && t.operation === 'getNote');
  if (read) process.stderr.write(`     Also test the example API by reading a real note:\n     ${command} doctor ${configArg} --probe ${read.name} --args '{"path":{"id":"1"}}'\n\n`);
  process.stderr.write(`  3. Export the client launch configuration:\n     ${command} export ${configArg} > client.local.json\n\n`);
  process.stderr.write(`  4. List available tools in MCP Inspector:\n     MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector --cli --config client.local.json --server ${config.name} --format json --method tools/list\n\n`);
  if (config.sources.some(s => s.auth.type !== 'none')) process.stderr.write('     Private APIs: Inspector also needs credentials via -e NAME=value. See README.\n');
  if (read) process.stderr.write(`     Read a note through the client:\n     MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector --cli --config client.local.json --server ${config.name} --format json --method tools/call --tool-name ${read.name} --tool-args-json '{"path":{"id":"1"}}'\n\n`);
}
