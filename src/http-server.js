import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { prepareServer } from './server.js';
import { validateConfig } from './config.js';
import { assert, UserError } from './errors.js';

export async function startHttpServer(config, directory, { host = '127.0.0.1', port = 3000,
  env = process.env, publicUrl = config.hosting?.publicUrl, tokenEnv = config.hosting?.tokenEnv ?? 'OPEN_MCP_ACCESS_TOKEN' } = {}) {
  validateConfig({ ...config, hosting: { publicUrl, tokenEnv } });
  assert(Number.isInteger(port) && port >= 0 && port <= 65535, 'HTTP port must be between 0 and 65535.');
  assert(['127.0.0.1', '0.0.0.0', '::1'].includes(host), 'HTTP bind host must be 127.0.0.1, ::1 or 0.0.0.0.');
  const token = env[tokenEnv];
  assert(typeof token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(token), `Set ${tokenEnv} to a random token of 32-256 letters, digits, hyphens or underscores. No token values belong in files.`);
  const publicAddress = new URL(publicUrl);
  const factory = await prepareServer(config, directory, env, [token]);
  const connections = new Set(); let closing = false;
  const reply = (res, status, error) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(JSON.stringify({ error }));
  };
  const http = createHttpServer({ maxHeaderSize: 8192 }, (req, res) => {
    const run = async () => {
      const localHosts = ['127.0.0.1', 'localhost', '[::1]'].map(h => `${h}:${http.address().port}`);
      if (![publicAddress.host, ...localHosts].includes(req.headers.host)) { reply(res, 403, 'Host is not allowed.'); return; }
      if (req.headers.origin && req.headers.origin !== publicAddress.origin) { reply(res, 403, 'Origin is not allowed.'); return; }
      if (req.url === '/healthz' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"status":"ok"}'); return;
      }
      if (req.url !== '/mcp') { reply(res, 404, 'Not found.'); return; }
      const provided = /^Bearer ([A-Za-z0-9_-]{32,256})$/i.exec(req.headers.authorization ?? '')?.[1];
      if (!provided || provided.length !== token.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) {
        res.setHeader('WWW-Authenticate', 'Bearer realm="openmcp"'); reply(res, 401, 'Authorization required.'); return;
      }
      if (closing || connections.size >= 32) { reply(res, 503, 'Server is busy. Try later.'); return; }
      const server = factory();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined,
        enableJsonResponse: true, maxRequestBodySize: 1024 * 1024 });
      connections.add(server);
      let cleaned = false;
      const cleanup = async () => { if (cleaned) return; cleaned = true; connections.delete(server); await server.close(); };
      res.once('close', () => { cleanup().catch(() => {}); });
      try { await server.connect(transport); await transport.handleRequest(req, res); }
      catch { if (!res.headersSent) reply(res, 500, 'MCP request failed.'); else res.end(); await cleanup(); }
    };
    run().catch(() => { if (!res.headersSent) reply(res, 500, 'Request failed.'); else res.end(); });
  });
  http.headersTimeout = 10000; http.requestTimeout = 30000; http.keepAliveTimeout = 5000;
  http.maxConnections = 128;
  http.listen(port, host);
  try { await once(http, 'listening'); }
  catch { throw new UserError('Cannot listen on the HTTP port. Check the bind address and whether the port is already in use.'); }
  let closePromise;
  const close = () => closePromise ??= (async () => {
    closing = true;
    const stopped = new Promise(resolve => http.close(resolve));
    await Promise.allSettled([...connections].map(server => server.close()));
    http.closeAllConnections(); await stopped;
  })();
  return { http, close, port: http.address().port, publicUrl };
}
export async function serveHttp(config, directory, options = {}) {
  const service = await startHttpServer(config, directory, options);
  process.stderr.write(`[${config.name}] ready: authenticated HTTP /mcp on port ${service.port}\n`);
  const close = async () => { await service.close(); process.exit(0); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  return service;
}
