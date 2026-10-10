// Optional Docker/Caddy acceptance proof. Only loopback ports, isolated TLS CA,
// synthetic credentials and disposable containers; no public DNS/certificate request.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { parse, stringify } from 'yaml';
import { createDeployment } from '../src/deploy.js';

const exec = promisify(execFile);
const root = new URL('../', import.meta.url).pathname;
const directory = await mkdtemp(join(tmpdir(), 'openmcp-deploy-proof-'));
const output = join(directory, 'bundle');
const project = `openmcp-proof-${randomBytes(6).toString('hex')}`;
const env = { ...process.env, OPEN_MCP_ACCESS_TOKEN: randomBytes(32).toString('hex'), API_TOKEN: 'synthetic-api-key-for-docker-proof' };
const docker = async args => (await exec('docker', args, { env, maxBuffer: 1024 * 1024, timeout: 300000 })).stdout;
const compose = args => docker(['compose', '--project-directory', output, '-p', project, ...args]);
let started = false;
try {
  const config = { version: 1, name: 'hosted-proof', sources: [{ id: 'api', baseUrl: 'http://fixture-api:3001', auth: { type: 'bearer', env: 'API_TOKEN' },
    endpoints: [{ id: 'read', method: 'GET', path: '/notes/{id}', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] },
      { id: 'write', method: 'POST', path: '/notes', requestBody: { required: true, schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } }] }],
    tools: [{ source: 'api', operation: 'read', name: 'read_note' }, { source: 'api', operation: 'write', name: 'create_note' }] };
  const path = join(directory, 'config.json'); await writeFile(path, JSON.stringify(config));
  await createDeployment(path, { domain: 'mcp.example.com', output });
  await compose(['config', '--quiet']);
  await docker(['run', '--rm', '--network', 'none', '-v', `${output}/Caddyfile:/etc/caddy/Caddyfile:ro`, 'caddy:2-alpine', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile']);
  const document = parse(await readFile(join(output, 'compose.yaml'), 'utf8'));
  document.services.caddy.ports = ['127.0.0.1::443'];
  document.services['fixture-api'] = { image: 'node:22-alpine', environment: { API_TOKEN: '${API_TOKEN:?Set API_TOKEN}' },
    command: ['node', '-e', `let calls=0;require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/stats'){res.end(JSON.stringify({calls}));return}if(req.headers.authorization!=='Bearer '+process.env.API_TOKEN){res.writeHead(403);res.end('{}');return}calls++;res.end(JSON.stringify({ok:true,method:req.method,path:req.url}))}).listen(3001,'0.0.0.0')`] };
  await writeFile(join(output, 'compose.yaml'), stringify(document));
  // Same generated app/stack; only the TLS identity and public port are changed for local proof.
  const hosted = parse(await readFile(join(output, 'project/open-mcp.yaml'), 'utf8'));
  hosted.hosting.publicUrl = 'https://localhost/mcp'; await writeFile(join(output, 'project/open-mcp.yaml'), stringify(hosted));
  await writeFile(join(output, 'Caddyfile'), 'localhost {\n tls internal\n reverse_proxy openmcp:3000 {\n  header_up Host localhost\n }\n}\n');
  started = true; await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '90']);
  const port = (await compose(['port', 'caddy', '443'])).trim().split(':').at(-1);
  const cert = join(directory, 'root.crt');
  await compose(['cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', cert]);
  const url = `https://localhost:${port}/mcp`;
  const clientConfig = { ...hosted, hosting: { ...hosted.hosting, publicUrl: url } };
  const clientPath = join(directory, 'client.yaml'); await writeFile(clientPath, stringify(clientConfig));
  const probe = `import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {exportClient} from './src/client.js';
const url=process.env.PROOF_URL, token=process.env.OPEN_MCP_ACCESS_TOKEN;
assert.equal((await fetch(url)).status,401);
const client=new Client({name:'docker-proof',version:'1'});
await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
assert.equal((await client.listTools()).tools.length,2);
assert.equal((await client.callTool({name:'read_note',arguments:{path:{id:'a/b'}}})).isError,undefined);
assert.equal((await client.callTool({name:'create_note',arguments:{body:{title:'proof'}}})).isError,undefined);
await client.close();
const entry=exportClient(process.env.PROOF_CONFIG,'hosted-proof',{publicUrl:url,tokenEnv:'OPEN_MCP_ACCESS_TOKEN'}).mcpServers['hosted-proof'];
const transport=new StdioClientTransport({...entry,env:{OPEN_MCP_ACCESS_TOKEN:token,NODE_EXTRA_CA_CERTS:process.env.NODE_EXTRA_CA_CERTS},stderr:'pipe'});
transport.stderr.on('data',()=>{});const bridge=new Client({name:'bridge-proof',version:'1'});await bridge.connect(transport);
assert.equal((await bridge.listTools()).tools.length,2);await bridge.close();
console.log('PASS Docker/Caddy: certificate-verified HTTPS, unauthorized rejection, real tool list/read/write and remote stdio bridge.');`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', probe], { cwd: root, env: { ...env, NODE_EXTRA_CA_CERTS: cert, PROOF_URL: url, PROOF_CONFIG: clientPath }, timeout: 30000 });
  const stats = await compose(['exec', '-T', 'openmcp', 'node', '-e', "fetch('http://fixture-api:3001/stats').then(r=>r.text()).then(console.log)"]);
  if (JSON.parse(stats).calls !== 2) throw new Error('Writing request repeated or unauthorized API side effect.');
  console.log(result.stdout.trim());
} finally {
  if (started) await compose(['down', '--rmi', 'local', '--volumes', '--remove-orphans']).catch(() => {});
  await rm(directory, { recursive: true, force: true });
}
