import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { assert, UserError, redact } from './errors.js';

export function remoteAddress(value) {
  let url; try { url = new URL(value); } catch { throw new UserError('Remote MCP URL is invalid.'); }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/mcp', 'Remote MCP URL must use HTTPS with /mcp and no credentials, query or fragment.');
  return url;
}
export async function bridgeRemote(url, tokenEnv, env = process.env) {
  const address = remoteAddress(url);
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv), 'Invalid access-token variable name.');
  const token = env[tokenEnv];
  assert(typeof token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(token), `Set ${tokenEnv} in the client environment before connecting.`);
  const client = new Client({ name: 'openmcp-remote-bridge', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(address, { requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (input, init) => fetch(input, { ...init, redirect: 'error' }) });
  const server = new Server({ name: 'openmcp-remote-bridge', version: '0.1.0' }, { capabilities: { tools: {} } });
  const safe = async action => {
    try { return JSON.parse(redact(JSON.stringify(await action()), [token])); }
    catch { throw new UserError('Remote MCP request failed. Check its URL, certificate, access token and availability.'); }
  };
  server.setRequestHandler(ListToolsRequestSchema, req => safe(() => client.listTools(req.params, { timeout: 10000 })));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    try {
      const result = await client.callTool(req.params, undefined, { timeout: 305000, signal: extra.signal });
      // Never echo the transport token, even if an upstream tool result contains it.
      return JSON.parse(redact(JSON.stringify(result), [token]));
    } catch { return { isError: true, content: [{ type: 'text', text: 'Remote tool call failed. Check the server and access token.' }] }; }
  });
  try { await client.connect(transport, { timeout: 10000 }); await server.connect(new StdioServerTransport()); }
  catch { await client.close(); throw new UserError('Cannot connect remote MCP. Check its URL, HTTPS certificate and access-token environment variable.'); }
  const close = async () => { await server.close(); await client.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return server;
}
