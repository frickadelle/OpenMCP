#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { runWorkbench } from './workbench.js';
import { loadConfig, saveConfig, validateConfig } from './config.js';
import { compileProject } from './importer.js';
import { tour } from './tour.js';
import { createDeployment, deployWizard } from './deploy.js';
import { serveHttp } from './http-server.js';
import { bridgeRemote } from './remote.js';
import { initialize, addSource, selectTools, finishOnboarding, connectWizard } from './wizard.js';
import { inspectHosts, connectHost, requiredHostEnv } from './hosts.js';
import { serve } from './server.js';
import { exportClient, diagnose } from './client.js';
import { busy, ribbon } from './ui.js';
import { UserError, assert, redact } from './errors.js';

const program = new Command().enablePositionalOptions().name('openmcp').version('0.1.0').description('Open MCP (working title): local HTTP APIs as selected MCP tools');
async function browse(options = {}) {
  const directory = resolve(options.projects ?? process.cwd());
  let configs = options.config ? (Array.isArray(options.config) ? options.config : [options.config]) : [];
  while (true) {
    const action = await runWorkbench({ directory, configs });
    if (action?.action === 'deploy') {
      try { await deployWizard(action.configPath); await import('@inquirer/prompts').then(({ input }) => input({ message: 'Press Enter to return to the MCP overview' })); }
      catch (error) { if (error.name !== 'ExitPromptError') throw error; }
      continue;
    }
    if (!['create', 'demo'].includes(action?.action)) return;
    let path;
    try {
      const result = await initialize(undefined, { directory, simple: true,
        ...(action.action === 'demo' ? { name: 'demo', demo: true, auth: 'none' } : {}) });
      path = result.path;
      await finishOnboarding(result, true);
    } catch (error) {
      if (error.name !== 'ExitPromptError') throw error;
    }
    if (path && configs.length && existsSync(path) && !configs.includes(path)) configs = [...configs, path];
  }
}
program.option('--projects <directory>', 'Browse project configurations in this directory')
  .option('-c, --config <path>', 'Open one project in the terminal dashboard').action(browse);
program.command('browse').description('Browse MCP projects and toggle tools in the animated terminal dashboard')
  .option('--projects <directory>', 'Project folder').option('-c, --config <paths...>', 'Explicit project files').action(browse);
program.command('tour').description('Explain the five onboarding steps with animated ASCII diagrams').action(tour);
const configOption = command => command.option('-c, --config <path>', 'Project JSON/YAML file', 'open-mcp.yaml');
const sourceOptions = command => command.option('--spec <path>', 'Local OpenAPI JSON/YAML file').option('--id <id>', 'Source id')
  .option('--base-url <url>', 'Override API base URL').option('--auth <type>', 'none, bearer or apiKey')
  .option('--env <name>', 'Credential environment variable name').option('--key-in <location>', 'API-key location: header or query')
  .option('--key-name <name>', 'API-key header/query name').option('--select <operations>', 'Explicit comma-separated operation ids; empty string selects none');
sourceOptions(program.command('init').description('Create a project with the interactive wizard')
  .option('-c, --config <path>', 'Optional project file; otherwise derived from its name'))
  .option('--name <name>', 'Project name').action(async options => {
    const result = await initialize(options.config, options);
    await finishOnboarding(result);
  });
sourceOptions(configOption(program.command('add').description('Add another API and select its tools'))).action(async options => {
  const { config, path, directory } = await loadConfig(options.config);
  await addSource(config, path, options); validateConfig(config); await compileProject(config, directory); await saveConfig(path, config);
  await ribbon('API connected'); process.stderr.write(`Saved ${path}\n`);
});
configOption(program.command('tools').description('List operations or edit the explicit tool allowlist'))
  .option('--choose', 'Interactively select and customize tools').option('--select <operations>', 'Replace selection using source/operation ids')
  .option('--json', 'Print catalog as JSON').action(async options => {
    const { config, path, directory } = await loadConfig(options.config);
    if (options.choose || options.select !== undefined) {
      await selectTools(config, directory, undefined, options.select); validateConfig(config); await compileProject(config, directory); await saveConfig(path, config);
    }
    const { catalog, selected } = await compileProject(config, directory);
    const rows = catalog.map(o => ({ source: o.source.id, operation: o.operation, method: o.method, path: o.path,
      selected: config.tools.some(t => t.source === o.source.id && t.operation === o.operation && t.enabled !== false),
      ...(o.error ? { error: o.error } : { publishedName: selected.find(t => t.source.id === o.source.id && t.operation === o.operation)?.name ?? null,
        inputSchema: selected.find(t => t.source.id === o.source.id && t.operation === o.operation)?.inputSchema ?? o.inputSchema }) }));
    if (options.json) console.log(JSON.stringify(rows, null, 2));
    else for (const row of rows) console.log(`${row.selected ? '[x]' : '[ ]'} ${row.source}/${row.operation}${row.publishedName ? ` => ${row.publishedName}` : ''} ${row.method} ${row.path}${row.error ? ` [unsupported: ${row.error}]` : ''}`);
  });
configOption(program.command('validate').description('Validate configuration, OpenAPI documents and selected tools'))
  .option('--strict', 'Fail if any unselected operation is unsupported').action(async options => {
    const { config, directory } = await loadConfig(options.config);
    const { catalog, selected } = await busy('Validate API schemas', () => compileProject(config, directory));
    const unsupported = catalog.filter(o => o.error);
    for (const op of unsupported) process.stderr.write(`[unsupported] ${op.source.id}/${op.operation}: ${op.error}\n`);
    assert(!options.strict || unsupported.length === 0, `${unsupported.length} unsupported operations; review or remove them.`);
    console.log(`Valid: ${config.sources.length} sources, ${selected.length} selected tools, ${unsupported.length} unsupported operations.`);
  });
configOption(program.command('serve').description('Run MCP locally over stdio or authenticated HTTP'))
  .option('--transport <transport>', 'stdio or http', 'stdio').option('--host <host>', 'HTTP bind address', '127.0.0.1')
  .option('--port <port>', 'HTTP port', '3000').action(async options => {
    const { config, directory } = await loadConfig(options.config);
    assert(['stdio', 'http'].includes(options.transport), 'Transport must be stdio or http.');
    if (options.transport === 'http') await serveHttp(config, directory, { host: options.host, port: Number(options.port) });
    else await serve(config, directory);
  });
program.command('bridge').description('Authenticated HTTPS MCP as a local stdio client connection')
  .requiredOption('--url <url>', 'HTTPS /mcp endpoint').option('--token-env <name>', 'Access-token environment variable', 'OPEN_MCP_ACCESS_TOKEN')
  .action(options => bridgeRemote(options.url, options.tokenEnv));
configOption(program.command('deploy').description('Create a reusable Docker/HTTPS self-hosting package'))
  .option('--domain <domain>', 'Public domain, without protocol/path').option('--output <folder>', 'New output folder')
  .option('--token-env <name>', 'Access-token variable name', 'OPEN_MCP_ACCESS_TOKEN')
  .option('--api-url <source=url...>', 'API address reachable from the hosting server')
  .action(async options => {
    if (!options.domain) { await deployWizard(options.config); return; }
    const apiUrls = Object.create(null);
    for (const value of options.apiUrl ?? []) {
      const equals = value.indexOf('='); assert(equals > 0, '--api-url must use source=URL.');
      apiUrls[value.slice(0, equals)] = value.slice(equals + 1);
    }
    const result = await createDeployment(options.config, { domain: options.domain, output: options.output, tokenEnv: options.tokenEnv, apiUrls });
    console.log(`Prepared ${result.directory}\nEndpoint: ${result.config.hosting.publicUrl}\nFollow the generated README for DNS, environment variables and Docker Compose.`);
  });
configOption(program.command('connect').description('Detect local MCP hosts and configure the selected client'))
  .option('--list', 'List detected hosts and configuration status without changing files')
  .option('--host <id>', 'Configure codex, claude-code, claude-desktop or opencode')
  .action(async options => {
    const { config, path } = await loadConfig(options.config);
    const hosts = await inspectHosts(path, config);
    if (options.list) { for (const host of hosts) console.log(`${host.id}: ${host.status}${host.error ? ` - ${host.error}` : ''}`); return; }
    if (!options.host) { await connectWizard(path, config); return; }
    const host = hosts.find(h => h.id === options.host);
    assert(host, 'Unknown host. Use connect --list to see supported hosts.');
    const result = await connectHost(host, path);
    console.log(`Configured ${result.name} for ${host.name}. Restart the host to load tools.`);
    if (result.backup) console.log(`Backup: ${result.backup}`);
    const envs = requiredHostEnv(config);
    if (envs.length) console.log(`Required in the host environment: ${envs.join(', ')}.`);
  });
configOption(program.command('doctor').description('Check credentials and a real local MCP connection'))
  .option('--probe <tool>', 'Also call a selected GET/HEAD tool against the API').option('--args <json>', 'Probe tool arguments', '{}')
  .action(async options => {
    const { config, path, directory } = await loadConfig(options.config); const { selected } = await compileProject(config, directory);
    let args; try { args = JSON.parse(options.args); } catch { throw new UserError('--args must be valid JSON.'); }
    const result = await busy('Connect local MCP client', () => diagnose(config, path, selected, { probe: options.probe, args }));
    console.log(`OK: Node ${process.versions.node}; credentials present; ${config.hosting ? 'remote' : 'local'} MCP connected; ${result.tools.length} tools listed.`);
    console.log(result.apiProbed ? `API probe succeeded: ${result.apiProbed}.` : 'API reachability was not probed. Use --probe <GET/HEAD tool> --args <json> to test it.');
  });
configOption(program.command('export').description('Export tested MCP Inspector 2.10.1 configuration; no secret values'))
  .option('--client <client>', 'Client target', 'inspector').action(async options => {
    assert(options.client === 'inspector', 'Only the tested inspector client is supported.');
    const { config, path, directory } = await loadConfig(options.config); await compileProject(config, directory);
    const envs = requiredHostEnv(config);
    if (envs.length) process.stderr.write(`Required runtime environment variables: ${envs.join(', ')}. Pass them using Inspector -e NAME=value; export never includes values. See README.\n`);
    console.log(JSON.stringify(exportClient(path, config.name, config.hosting), null, 2));
  });
try { await program.parseAsync(); }
catch (error) {
  const message = error instanceof UserError ? error.message : error.name === 'ExitPromptError' ? 'Wizard cancelled; configuration was not saved.' : 'Command failed. Run validate or doctor for setup diagnostics.';
  // Redact only configured credential env vars when the config is readable; never dump the environment.
  let values = [];
  try { const index = process.argv.findIndex(a => ['--config', '-c'].includes(a));
    const { config } = await loadConfig(index >= 0 ? process.argv[index + 1] : 'open-mcp.yaml');
    values = config.sources.filter(s => s.auth.type !== 'none').map(s => process.env[s.auth.env]);
    if (config.hosting) values.push(process.env[config.hosting.tokenEnv]); } catch {}
  process.stderr.write(`Error: ${redact(message, values)}\n`); process.exitCode = 1;
}
