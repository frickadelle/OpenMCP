import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { credentials } from './http.js';
import { assert, UserError } from './errors.js';

export const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
export function exportClient(configPath, name, hosting) {
  return { mcpServers: { [name]: { type: 'stdio', command: process.execPath,
    args: hosting ? [cliPath, 'bridge', '--url', hosting.publicUrl, '--token-env', hosting.tokenEnv] : [cliPath, 'serve', '--config', resolve(configPath)] } } };
}
export async function diagnose(config, configPath, selected, { probe, args = {}, env = process.env } = {}) {
  if (config.hosting) assert(Boolean(env[config.hosting.tokenEnv]), `Set ${config.hosting.tokenEnv} in the client environment.`);
  else credentials(config, env);
  const forwarded = {};
  if (config.hosting) forwarded[config.hosting.tokenEnv] = env[config.hosting.tokenEnv];
  else for (const source of config.sources) if (source.auth.type !== 'none') forwarded[source.auth.env] = env[source.auth.env];
  const entry = exportClient(configPath, config.name, config.hosting).mcpServers[config.name];
  const transport = new StdioClientTransport({ ...entry, env: forwarded, stderr: 'pipe' });
  // Do not echo arbitrary child logs; report safe diagnostics instead.
  transport.stderr.on('data', () => {});
  const client = new Client({ name: 'open-mcp-doctor', version: '0.1.0' });
  try {
    await client.connect(transport, { timeout: 10000 });
    const list = await client.listTools({}, { timeout: 10000 });
    assert(list.tools.length === selected.length, 'Server tool list differs from the configuration.');
    if (probe) {
      const tool = selected.find(t => t.name === probe);
      assert(tool, `Probe tool ${probe} is not selected.`);
      assert(['GET', 'HEAD'].includes(tool.method), 'Doctor only probes GET/HEAD tools. Use the MCP client for writing requests.');
      const result = await client.callTool({ name: probe, arguments: args }, undefined, { timeout: (config.timeoutMs ?? 10000) + 5000 });
      if (result.isError) throw new UserError(result.content[0].text);
    }
    return { status: 'ok', tools: list.tools.map(t => t.name), apiProbed: probe ?? null };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('MCP connection failed. Check Node.js, the configuration path and required environment variables.');
  } finally { await client.close(); await transport.close(); }
}
