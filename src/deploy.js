import { readFile, writeFile, mkdir, readdir, rename, rm, stat, rmdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { input } from '@inquirer/prompts';
import { stringify } from 'yaml';
import { loadConfig, readDocument, validateConfig } from './config.js';
import { compileProject } from './importer.js';
import { assert, UserError } from './errors.js';
import { busy, explain } from './ui.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function publicDomain(value) {
  const domain = String(value).trim().toLowerCase();
  assert(domain.length <= 253 && domain.includes('.') && !isIP(domain) &&
    domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) &&
    !/(?:^|\.)(localhost|local|internal|test|invalid)$/.test(domain), 'Enter a public domain, e.g. mcp.example.com, without https://, port or path.');
  return domain;
}
const localApi = value => {
  const host = new URL(value).hostname.replace(/\.$/, '');
  return ['localhost', '[::1]', '[::]', '0.0.0.0'].includes(host) || host.endsWith('.localhost') || /^127\./.test(host);
};
export async function createDeployment(configPath, { domain, output, tokenEnv = 'OPEN_MCP_ACCESS_TOKEN', apiUrls = {} } = {}) {
  domain = publicDomain(domain);
  const target = resolve(output ?? `${domain}-deploy`);
  try { await stat(target); throw new UserError('Deployment folder already exists. Choose another output folder.'); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const loaded = await loadConfig(configPath); const config = structuredClone(loaded.config);
  for (const id of Object.keys(apiUrls)) assert(config.sources.some(s => s.id === id), 'Unknown source in API URL override.');
  for (const source of config.sources) if (Object.hasOwn(apiUrls, source.id)) source.baseUrl = apiUrls[source.id];
  config.hosting = { publicUrl: `https://${domain}/mcp`, tokenEnv };
  validateConfig(config);
  for (const source of config.sources) assert(!localApi(source.baseUrl), `Source ${source.id} uses localhost. Provide an API URL reachable from the hosting server with --api-url ${source.id}=URL.`);
  await compileProject(config, loaded.directory);
  const tokenNames = [...new Set([tokenEnv, ...config.sources.filter(s => s.auth.type !== 'none').map(s => s.auth.env)])];
  // Compose's own operational variables must not double as application credentials.
  assert(tokenNames.every(name => !/^(?:COMPOSE_|DOCKER_|LD_|DYLD_|HOME$|PATH$|CODEX_HOME$|NODE_OPTIONS$|NODE_PATH$)/.test(name)), 'Use application-specific credential names, not system/runtime variables.');
  const staging = `${target}.tmp-${randomUUID()}`;
  let claimed = false;
  try {
    await mkdir(staging, { recursive: false, mode: 0o700 }); await mkdir(join(staging, 'project'), { mode: 0o700 });
    for (const source of config.sources.filter(s => s.spec)) {
      const doc = await readDocument(resolve(loaded.directory, source.spec));
      source.spec = `spec-${source.id}.json`;
      await writeFile(join(staging, 'project', source.spec), JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
    }
    await writeFile(join(staging, 'project/open-mcp.yaml'), stringify(config), { mode: 0o600 });
    await compileProject(config, join(staging, 'project'));
    for (const filename of ['package.json', 'package-lock.json', 'LICENSE']) await writeFile(join(staging, filename), await readFile(join(root, filename)), { mode: 0o600 });
    await mkdir(join(staging, 'src'));
    for (const filename of await readdir(join(root, 'src'))) if (filename.endsWith('.js')) {
      await writeFile(join(staging, 'src', filename), await readFile(join(root, 'src', filename)), { mode: 0o600 });
    }
    const environment = Object.fromEntries(tokenNames.map(name => [name, '${' + name + ':?Set ' + name + ' in the server environment}']));
    const compose = { services: {
      openmcp: { build: '.', restart: 'unless-stopped', command: ['node', 'src/cli.js', 'serve', '--transport', 'http', '--host', '0.0.0.0', '-c', '/app/project/open-mcp.yaml'],
        environment, read_only: true, tmpfs: ['/tmp'], cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'],
        healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: '15s', timeout: '3s', retries: 3 } },
      caddy: { image: 'caddy:2-alpine', restart: 'unless-stopped', ports: ['80:80', '443:443'],
        volumes: ['./Caddyfile:/etc/caddy/Caddyfile:ro', 'caddy_data:/data', 'caddy_config:/config'],
        depends_on: { openmcp: { condition: 'service_healthy' } } }
    }, volumes: { caddy_data: {}, caddy_config: {} } };
    await writeFile(join(staging, 'compose.yaml'), stringify(compose), { mode: 0o600 });
    await writeFile(join(staging, 'Caddyfile'), `${domain} {\n\treverse_proxy openmcp:3000\n}\n`, { mode: 0o600 });
    await writeFile(join(staging, 'Dockerfile'), 'FROM node:22-alpine\nWORKDIR /app\nCOPY --chown=node:node package*.json ./\nRUN npm ci --omit=dev --ignore-scripts\nCOPY --chown=node:node src ./src\nCOPY --chown=node:node project ./project\nCOPY --chown=node:node LICENSE ./LICENSE\nUSER node\nEXPOSE 3000\nCMD ["node", "src/cli.js", "serve", "--transport", "http", "--host", "0.0.0.0", "-c", "/app/project/open-mcp.yaml"]\n');
    await writeFile(join(staging, '.dockerignore'), 'node_modules\n.git\n**/.env*\n**/*.bak\n');
    await writeFile(join(staging, '.gitignore'), '.env\n.env.*\n*.bak\n');
    const instructions = `# Self-host ${config.name}\n\nEndpoint: ${config.hosting.publicUrl}\n\n1. Get a Docker/Compose server and point the domain's A/AAAA records to it.\n2. Allow inbound ports 80 and 443. Open MCP's port is private to Compose.\n3. Copy this folder to that server.\n4. Set ${tokenEnv} to a random access token (at least 32 characters):\n\n\`\`\`sh\nexport ${tokenEnv}="$(openssl rand -hex 32)"\n\`\`\`\n\nRequired server variables: ${tokenNames.join(', ')}. Set API credentials using your\nsecret manager or hidden shell input; do not put their values in this folder.\nUse the same access token in the client's environment. Keep it out of shell\nhistory, config files and chat. Retain it in your secret manager for restarts.\n\n\`\`\`sh\ndocker compose up -d --build\ncurl --fail https://${domain}/healthz\n\`\`\`\n\nCaddy obtains/renews public certificates only after DNS and ports are correct.\nNo domain purchase, DNS change or deployment has been performed by this setup.\nFor status: docker compose ps. Stop: docker compose down (preserves TLS volumes).\nAvoid docker compose config without --quiet: it expands environment values.\n\nOn your client machine, keep a checkout of Open MCP for its authenticated stdio\nbridge. Copy project/open-mcp.yaml and the spec files from this folder, then:\n\n\`\`\`sh\nopenmcp connect -c project/open-mcp.yaml --host codex\n# Or --host claude-code / --host opencode\n\`\`\`\n\nThe client needs only ${tokenEnv}, not the API credential values. Restart the host.\nRemote Claude Desktop setup is not automated: it needs a verified environment\ninjection or OAuth path. OAuth, per-user accounts, cloud provisioning and\nautomatic DNS are not included. Bundle config/specs are snapshots: regenerate\na new folder after changing API/tools, review changes, then rebuild.\n`;
    await writeFile(join(staging, 'README.md'), instructions, { mode: 0o600 });
    // Snapshot only known runtime files; never copy .env, host configs or arbitrary repo files.
    try { await mkdir(target, { mode: 0o700 }); claimed = true; }
    catch (e) { if (e.code === 'EEXIST') throw new UserError('Deployment folder appeared during setup. Choose another folder.'); throw e; }
    await rename(staging, target);
    claimed = false;
    return { directory: target, config, tokenNames };
  } catch (e) { if (e instanceof UserError) throw e; throw new UserError('Cannot create deployment folder. Check its parent directory and permissions.'); }
  finally { await rm(staging, { recursive: true, force: true }); if (claimed) await rmdir(target).catch(() => {}); }
}
export async function deployWizard(configPath) {
  process.stderr.write('\n  + SELF-HOST ------------------------------------+\n  | Your MCP -> Package -> Your server -> Domain  |\n  +-----------------------------------------------+\n');
  explain('Self-host your MCP', ['You need a domain and a server with Docker Compose.', 'This creates a reusable package. It does not buy a domain or publish anything.']);
  const domain = await input({ message: 'Which domain should serve your MCP? (e.g. mcp.example.com)', validate: value => { try { publicDomain(value); return true; } catch (e) { return e.message; } } });
  const { config } = await loadConfig(configPath); const apiUrls = {};
  for (const source of config.sources.filter(s => localApi(s.baseUrl))) {
    apiUrls[source.id] = await input({ message: `API ${source.id}: URL reachable from your hosting server (localhost will not work)`, validate: value => {
      try {
        const candidate = structuredClone(config); candidate.sources.find(s => s.id === source.id).baseUrl = value;
        validateConfig(candidate); assert(!localApi(value), 'Use an API address reachable from the server, not localhost.'); return true;
      } catch (e) { return e instanceof UserError ? e.message : 'Enter a valid HTTP(S) API URL.'; }
    } });
  }
  const output = await input({ message: 'New deployment folder', default: `${publicDomain(domain)}-deploy`, validate: async value => {
    const path = resolve(value);
    try { await stat(path); return 'That folder/file already exists. Choose a new folder.'; }
    catch (e) { if (e.code !== 'ENOENT') return 'Cannot read this path. Check permissions.'; }
    try { return (await stat(dirname(path))).isDirectory() || 'The parent must be a directory.'; }
    catch { return 'Choose an existing parent directory.'; }
  } });
  const result = await busy('Prepare self-hosting package', () => createDeployment(configPath, { domain, output, apiUrls }));
  explain('Package ready', [`Folder: ${result.directory}`, `Endpoint: ${result.config.hosting.publicUrl}`, 'Follow its README to set DNS, environment variables and start Docker Compose.']);
  return result;
}
