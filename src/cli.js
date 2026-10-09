#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { runWorkbench } from './workbench.js';
import { loadConfig, saveConfig, validateConfig } from './config.js';
import { compileProject } from './importer.js';
import { tour } from './tour.js';
import { initialize, addSource, selectTools, finishOnboarding } from './wizard.js';
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
configOption(program.command('serve').description('Run MCP over stdio (stdout is protocol only)')).action(async options => {
  const { config, directory } = await loadConfig(options.config); await serve(config, directory);
});
configOption(program.command('doctor').description('Check credentials and a real local MCP connection'))
  .option('--probe <tool>', 'Also call a selected GET/HEAD tool against the API').option('--args <json>', 'Probe tool arguments', '{}')
  .action(async options => {
    const { config, path, directory } = await loadConfig(options.config); const { selected } = await compileProject(config, directory);
    let args; try { args = JSON.parse(options.args); } catch { throw new UserError('--args must be valid JSON.'); }
    const result = await busy('Connect local MCP client', () => diagnose(config, path, selected, { probe: options.probe, args }));
    console.log(`OK: Node ${process.versions.node}; credentials present; MCP connected; ${result.tools.length} tools listed.`);
    console.log(result.apiProbed ? `API probe succeeded: ${result.apiProbed}.` : 'API reachability was not probed. Use --probe <GET/HEAD tool> --args <json> to test it.');
  });
configOption(program.command('export').description('Export tested MCP Inspector 2.10.1 configuration; no secret values'))
  .option('--client <client>', 'Client target', 'inspector').action(async options => {
    assert(options.client === 'inspector', 'Only the tested inspector client is supported.');
    const { config, path, directory } = await loadConfig(options.config); await compileProject(config, directory);
    const envs = [...new Set(config.sources.filter(s => s.auth.type !== 'none').map(s => s.auth.env))];
    if (envs.length) process.stderr.write(`Required runtime environment variables: ${envs.join(', ')}. Pass them using Inspector -e NAME=value; export never includes values. See README.\n`);
    console.log(JSON.stringify(exportClient(path, config.name), null, 2));
  });
try { await program.parseAsync(); }
catch (error) {
  const message = error instanceof UserError ? error.message : error.name === 'ExitPromptError' ? 'Wizard cancelled; configuration was not saved.' : 'Command failed. Run validate or doctor for setup diagnostics.';
  // Redact only configured credential env vars when the config is readable; never dump the environment.
  let values = [];
  try { const index = process.argv.findIndex(a => ['--config', '-c'].includes(a));
    const { config } = await loadConfig(index >= 0 ? process.argv[index + 1] : 'open-mcp.yaml');
    values = config.sources.filter(s => s.auth.type !== 'none').map(s => process.env[s.auth.env]); } catch {}
  process.stderr.write(`Error: ${redact(message, values)}\n`); process.exitCode = 1;
}
