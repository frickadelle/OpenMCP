import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createDemoApi() {
  const notes = new Map([['1', { id: '1', title: 'Hello MCP' }]]);
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (url.pathname === '/health') return json(200, { status: 'ok' });
    if (url.pathname === '/auth/bearer') return json(req.headers.authorization === 'Bearer demo-token' ? 200 : 401, { authenticated: req.headers.authorization === 'Bearer demo-token' });
    if (url.pathname === '/auth/key') return json(req.headers['x-api-key'] === 'demo-key' ? 200 : 401, { authenticated: req.headers['x-api-key'] === 'demo-key' });
    if (url.pathname === '/notes' && req.method === 'GET') return json(200, { notes: [...notes.values()], tags: url.searchParams.getAll('tag') });
    if (url.pathname.startsWith('/notes/') && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.slice('/notes/'.length));
      if (!notes.has(id)) return json(404, { error: 'Note not found' });
      return json(200, { ...notes.get(id), ...(url.searchParams.get('verbose') === 'true' ? { detail: 'Served by the local demo API' } : {}) });
    }
    if (url.pathname === '/notes' && req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 4096) return json(413, { error: 'Body too large' }); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { return json(400, { error: 'Invalid JSON' }); }
      if (typeof body.title !== 'string' || !body.title.length) return json(400, { error: 'Title required' });
      const note = { id: String(notes.size + 1), title: body.title }; notes.set(note.id, note); return json(201, note);
    }
    json(404, { error: 'Unknown endpoint' });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDemoApi();
  server.listen(3001, '127.0.0.1', () => console.log('Local Notes API: http://127.0.0.1:3001 (no credentials needed)'));
  server.on('error', error => { console.error(`Demo API could not start: ${error.code}`); process.exitCode = 1; });
}
