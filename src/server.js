import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { compileProject } from './importer.js';
import { credentials, callApi } from './http.js';
import { redact, UserError } from './errors.js';

export async function createServer(config, directory, env = process.env) {
  const { selected } = await compileProject(config, directory);
  const secrets = credentials(config, env);
  // Advanced SDK API preserves configurable JSON Schemas without translating them to function signatures.
  const server = new Server({ name: config.name, version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: selected.map(t => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: ['GET', 'HEAD', 'OPTIONS'].includes(t.method),
      destructiveHint: !['GET', 'HEAD', 'OPTIONS'].includes(t.method), openWorldHint: true }
  })) }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = selected.find(t => t.name === request.params.name);
    try {
      if (!tool) throw new UserError('Unknown or unselected tool. Run tools to review the allowlist.');
      const text = await callApi(tool, request.params.arguments ?? {}, { secrets, timeoutMs: config.timeoutMs, signal: extra.signal });
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof UserError ? redact(error.message, [...secrets.values()]) : 'Unexpected request failure. Run doctor to check the configuration.';
      process.stderr.write(`[${config.name}] ${message}\n`);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });
  return server;
}
export async function serve(config, directory) {
  const server = await createServer(config, directory);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[${config.name}] ready: ${config.tools.length} selected tools over stdio\n`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await server.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return server;
}
