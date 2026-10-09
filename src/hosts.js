import { access, readFile, writeFile, mkdir, rename, unlink, lstat, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parseTree, getNodeValue, modify, applyEdits } from 'jsonc-parser';
import { exportClient } from './client.js';
import { loadConfig } from './config.js';
import { compileProject } from './importer.js';
import { assert, UserError } from './errors.js';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const plain = value => Array.isArray(value) ? value.map(plain) : object(value) && !(value instanceof Date) ?
  Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : value;
const same = (left, right) => isDeepStrictEqual(plain(left), plain(right));
const exec = promisify(execFile);
const versions = new Map();
const requiredEnv = config => [...new Set(config.sources.filter(s => s.auth.type !== 'none').map(s => s.auth.env))];
const serverName = config => `openmcp_${config.name}`;
async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function executable(name, env, platform) {
  for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const suffix of platform === 'win32' ? ['.exe', '.cmd', ''] : ['']) {
      const path = resolve(dir, name + suffix);
      try { await access(path, constants.X_OK); return path; } catch {}
    }
  }
}
export async function hostTargets({ home = homedir(), env = process.env, platform = process.platform, appDirs } = {}) {
  const dirs = appDirs ?? (platform === 'darwin' ? ['/Applications', join(home, 'Applications')] : []);
  const app = async names => {
    for (const dir of dirs) for (const name of names) if (await exists(join(dir, name))) return true;
    return false;
  };
  const [codex, claude, opencode, codexApp, claudeApp, opencodeApp] = await Promise.all([
    executable('codex', env, platform), executable('claude', env, platform), executable('opencode', env, platform),
    app(['Codex.app', 'Codex-Ollama.app']), app(['Claude.app']), app(['OpenCode.app'])
  ]);
  const desktopPath = platform === 'darwin' ? join(home, 'Library/Application Support/Claude/claude_desktop_config.json') :
    platform === 'win32' && env.APPDATA ? join(env.APPDATA, 'Claude/claude_desktop_config.json') : undefined;
  const ocDirectory = env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'opencode') : join(home, '.config/opencode');
  const ocJsonc = join(ocDirectory, 'opencode.jsonc');
  let opencodeError;
  if (opencode) {
    try {
      const info = await stat(opencode); const key = `${opencode}:${info.mtimeMs}:${info.size}`;
      let stdout = versions.get(key);
      if (stdout === undefined) {
        ({ stdout } = await exec(opencode, ['--version'], { env: { ...env, HOME: home }, timeout: 8000, maxBuffer: 4096 }));
        versions.set(key, stdout);
      }
      assert(/^1\./.test(stdout.trim()), 'Direct setup supports OpenCode 1.x. Other versions need a separately verified adapter.');
    } catch (e) { opencodeError = e instanceof UserError ? e.message : 'Cannot verify OpenCode version. Direct setup is unavailable.'; }
  } else if (opencodeApp) opencodeError = 'OpenCode app found. Install its CLI to verify the configuration version.';
  return [
    { id: 'codex', name: 'Codex', path: join(env.CODEX_HOME ?? join(home, '.codex'), 'config.toml'), format: 'toml', key: 'mcp_servers', installed: Boolean(codex || codexApp), executable: codex },
    { id: 'claude-code', name: 'Claude Code', path: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'), format: 'json', key: 'mcpServers', installed: Boolean(claude), executable: claude },
    { id: 'claude-desktop', name: 'Claude Desktop', path: desktopPath, format: 'json', key: 'mcpServers', installed: Boolean(desktopPath && (claudeApp || platform === 'win32' && await exists(dirname(desktopPath)))) },
    { id: 'opencode', name: 'OpenCode', path: env.OPENCODE_CONFIG ? resolve(env.OPENCODE_CONFIG) : await exists(ocJsonc) ? ocJsonc : join(ocDirectory, 'opencode.json'), format: 'jsonc', key: 'mcp', installed: Boolean(opencode || opencodeApp), executable: opencode, error: opencodeError }
  ];
}
export function hostEntry(host, configPath, config) {
  const entry = exportClient(configPath, config.name).mcpServers[config.name];
  const envs = requiredEnv(config);
  if (['claude-code', 'opencode'].includes(host.id)) {
    assert([entry.command, ...entry.args].every(value => !/\$\{|\{env:|\{file:/.test(value)), 'Host launch paths cannot contain environment interpolation markers. Move the checkout/config to a plain path.');
  }
  if (host.id === 'codex') return { command: entry.command, args: entry.args, ...(envs.length ? { env_vars: envs } : {}) };
  if (host.id === 'opencode') return { type: 'local', command: [entry.command, ...entry.args], enabled: true,
    ...(envs.length ? { environment: Object.fromEntries(envs.map(name => [name, `{env:${name}}`])) } : {}) };
  if (host.id === 'claude-desktop') {
    assert(!envs.length, 'Claude Desktop setup currently supports public APIs only. Use Claude Code, Codex or OpenCode for environment-based authentication.');
    return { command: entry.command, args: entry.args };
  }
  return { ...entry, ...(envs.length ? { env: Object.fromEntries(envs.map(name => [name, '${' + name + '}'])) } : {}) };
}
function parseHost(text, host) {
  try {
    if (host.format === 'toml') return parseToml(text);
    const errors = [];
    const tree = parseTree(text, errors, { allowTrailingComma: host.format === 'jsonc', disallowComments: host.format === 'json' });
    assert(tree && errors.length === 0, 'Invalid host configuration. Fix its syntax before connecting.');
    const unique = node => {
      if (node.type === 'object') {
        const keys = node.children.map(p => p.children[0].value);
        assert(new Set(keys).size === keys.length, 'Duplicate keys in host configuration. Resolve them before connecting.');
      }
      for (const child of node.children ?? []) unique(child);
    };
    unique(tree); const doc = getNodeValue(tree);
    assert(object(doc), 'Host configuration must be an object.'); return doc;
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError('Invalid host configuration. Fix its syntax before connecting.');
  }
}
async function snapshot(host) {
  try {
    const info = await lstat(host.path);
    assert(info.isFile() && !info.isSymbolicLink(), 'Host configuration must be a regular file, not a symlink.');
    assert(info.size <= 5 * 1024 * 1024, 'Host configuration exceeds 5 MiB.');
    const text = await readFile(host.path, 'utf8'); return { text, doc: parseHost(text, host), existed: true };
  } catch (e) {
    if (e.code === 'ENOENT') return { text: host.format === 'toml' ? '' : '{}\n', doc: {}, existed: false };
    if (e instanceof UserError) throw e;
    throw new UserError('Cannot read host configuration. Check file permissions.');
  }
}
export async function inspectHosts(configPath, config, options = {}) {
  const hosts = await hostTargets(options);
  for (const host of hosts) {
    host.status = host.error ? 'Setup unavailable' : host.installed ? 'Ready to configure' : 'Not installed';
    if (host.error) continue;
    if (!host.path) continue;
    try {
      const desired = hostEntry(host, configPath, config);
      const { doc } = await snapshot(host);
      assert(doc[host.key] === undefined || object(doc[host.key]), 'Host MCP section must be an object.');
      const current = doc[host.key]?.[serverName(config)];
      if (current !== undefined) host.status = same(current, desired) ? 'Configured (restart host)' : 'Name conflict';
    } catch (e) { host.status = 'Setup unavailable'; host.error = e.message; }
  }
  return hosts;
}
export async function connectHost(host, configPath) {
  assert(host.installed && host.path, `${host.name} is not installed or supported on this platform.`);
  assert(!host.error, host.error);
  const { config, directory } = await loadConfig(configPath);
  await compileProject(config, directory);
  const name = serverName(config); const entry = hostEntry(host, configPath, config);
  const before = await snapshot(host);
  assert(before.doc[host.key] === undefined || object(before.doc[host.key]), 'Host MCP section must be an object.');
  const current = before.doc[host.key]?.[name];
  if (same(current, entry)) return { status: 'configured', name, path: host.path, changed: false };
  assert(current === undefined, `The host already has a different server named ${name}. Rename your Open MCP project or remove that entry yourself.`);
  let text;
  if (host.format === 'toml') text = before.text + '\n' + stringifyToml({ [host.key]: { [name]: entry } });
  else text = applyEdits(before.text, modify(before.text, [host.key, name], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  const expected = { ...before.doc, [host.key]: { ...before.doc[host.key], [name]: entry } };
  let parsed;
  try { parsed = parseHost(text, host); }
  catch { throw new UserError('Cannot safely extend this host configuration (for example, an inline/sealed TOML MCP table). Existing settings were not changed.'); }
  assert(same(parsed, expected), 'Cannot safely extend this host configuration. Existing settings were not changed.');
  const token = randomUUID(); const backup = `${host.path}.openmcp-${token}.bak`; const temp = `${host.path}.openmcp-${token}.tmp`;
  try {
    await mkdir(dirname(host.path), { recursive: true, mode: 0o700 });
    if (before.existed) await writeFile(backup, before.text, { flag: 'wx', mode: 0o600 });
    await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
    const fresh = await snapshot(host);
    assert(fresh.existed === before.existed && fresh.text === before.text, 'Host configuration changed during setup. Try again.');
    if (before.existed) await rename(temp, host.path);
    else { await writeFile(host.path, text, { flag: 'wx', mode: 0o600 }); }
    return { status: 'configured', name, path: host.path, changed: true, ...(before.existed ? { backup } : {}) };
  } catch (e) {
    if (e instanceof UserError) throw e;
    throw new UserError('Cannot save host configuration. Check file permissions; existing settings were preserved.');
  } finally { await unlink(temp).catch(() => {}); }
}
