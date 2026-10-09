import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, mkdir, chmod, stat, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseJsonc } from 'jsonc-parser';
import { hostTargets, inspectHosts, hostEntry, connectHost } from '../src/hosts.js';
import { temp, manual, exec, root } from './helpers.js';

async function fixture(t, config = manual()) {
  const dir = await temp(t); const path = join(dir, 'project.yaml'); await writeFile(path, JSON.stringify(config));
  const bin = join(dir, 'bin'); await mkdir(bin);
  for (const name of ['codex', 'claude', 'opencode']) { await writeFile(join(bin, name), '#!/bin/sh\nprintf "1.18.35\\n"\n'); await chmod(join(bin, name), 0o700); }
  const apps = join(dir, 'Applications'); await mkdir(join(apps, 'Claude.app'), { recursive: true });
  const options = { home: dir, platform: 'darwin', env: { PATH: bin }, appDirs: [apps] };
  return { dir, path, config, options, hosts: await hostTargets(options) };
}
test('host detection respects runtime homes and detects only known installations, not stray config files', async t => {
  const f = await fixture(t); assert(f.hosts.every(h => h.installed));
  const env = { PATH: '', CODEX_HOME: join(f.dir, 'codex-other'), XDG_CONFIG_HOME: join(f.dir, 'xdg'), OPENCODE_CONFIG: join(f.dir, 'custom.jsonc') };
  const hosts = await hostTargets({ ...f.options, env, appDirs: [] });
  assert(hosts.every(h => !h.installed));
  assert.equal(hosts[0].path, join(env.CODEX_HOME, 'config.toml')); assert.equal(hosts[3].path, env.OPENCODE_CONFIG);
  await mkdir(join(f.dir, '.config/opencode'), { recursive: true }); await writeFile(join(f.dir, '.config/opencode/opencode.jsonc'), '{}');
  assert.equal((await hostTargets(f.options))[3].path, join(f.dir, '.config/opencode/opencode.jsonc'));
});
test('connecting each host preserves other servers/settings and comments, creates private backups and is idempotent', async t => {
  const f = await fixture(t);
  for (const host of f.hosts) {
    const original = host.format === 'toml' ? '# keep comment\nmodel="fixture"\ndate=2026-10-09\n[mcp_servers.existing]\ncommand="existing"\n' : host.format === 'jsonc' ? '{ // keep comment\n "theme": "dark", "mcp": {"existing": {"type":"remote", "url":"https://example.test"}},\n}' : JSON.stringify({ theme: 'dark', [host.key]: { existing: { command: 'existing' } } });
    await mkdir(join(host.path, '..'), { recursive: true }); await writeFile(host.path, original);
    const result = await connectHost(host, f.path); assert.equal(result.changed, true);
    assert.equal(await readFile(result.backup, 'utf8'), original);
    assert.equal((await stat(result.backup)).mode & 0o777, 0o600);
    const text = await readFile(host.path, 'utf8');
    const doc = host.format === 'toml' ? parseToml(text) : parseJsonc(text);
    assert.equal(doc.theme ?? doc.model, host.format === 'toml' ? 'fixture' : 'dark');
    assert(doc[host.key].existing); assert.deepEqual(doc[host.key].openmcp_test_project, undefined);
    assert(doc[host.key]['openmcp_test-project']);
    if (host.format !== 'json') assert(text.includes('keep comment'));
    assert.equal((await stat(host.path)).mode & 0o777, 0o600);
    assert.equal((await connectHost(host, f.path)).changed, false);
    assert.equal(await readFile(host.path, 'utf8'), text);
    assert.equal((await inspectHosts(f.path, f.config, f.options)).find(h => h.id === host.id).status, 'Configured (restart host)');
  }
});
test('environment authentication exports references only and Desktop rejects unsupported credential injection', async t => {
  const config = manual(); config.sources[0].auth = { type: 'bearer', env: 'SYNTHETIC_API_TOKEN' };
  const f = await fixture(t, config);
  for (const host of f.hosts.filter(h => h.id !== 'claude-desktop')) {
    await connectHost(host, f.path); const text = await readFile(host.path, 'utf8');
    assert(text.includes('SYNTHETIC_API_TOKEN')); assert(!text.includes('never-persist-this-value'));
  }
  const desktop = f.hosts.find(h => h.id === 'claude-desktop');
  await assert.rejects(connectHost(desktop, f.path), /public APIs only/);
  assert.equal((await inspectHosts(f.path, config, f.options)).find(h => h.id === desktop.id).status, 'Setup unavailable');
  assert.deepEqual(hostEntry(f.hosts[0], f.path, config).env_vars, ['SYNTHETIC_API_TOKEN']);
  assert.equal(hostEntry(f.hosts[1], f.path, config).env.SYNTHETIC_API_TOKEN, '${SYNTHETIC_API_TOKEN}');
  assert.equal(hostEntry(f.hosts[3], f.path, config).environment.SYNTHETIC_API_TOKEN, '{env:SYNTHETIC_API_TOKEN}');
});
test('host name collisions, malformed/duplicate JSON and symlinks never overwrite existing files', async t => {
  const f = await fixture(t); const host = f.hosts[1];
  for (const original of ['{invalid', '{"mcpServers":{},"mcpServers":{}}', '{"mcpServers":"wrong"}', '{"mcpServers":{"openmcp_test-project":{"command":"other"}}}']) {
    await writeFile(host.path, original); await assert.rejects(connectHost(host, f.path));
    assert.equal(await readFile(host.path, 'utf8'), original);
  }
  const symlinkHost = f.hosts[3]; await mkdir(join(symlinkHost.path, '..'), { recursive: true }); await symlink(host.path, symlinkHost.path);
  await assert.rejects(connectHost(symlinkHost, f.path), /regular file/);
  assert.equal((await readdir(join(symlinkHost.path, '..'))).length, 1);
  await assert.rejects(connectHost({ ...host, installed: false }, f.path), /not installed/);
  const codex = f.hosts[0]; const sealed = 'mcp_servers = { existing = { command = "old" } }\n';
  await mkdir(join(codex.path, '..'), { recursive: true }); await writeFile(codex.path, sealed);
  await assert.rejects(connectHost(codex, f.path), /Cannot safely extend/);
  assert.equal(await readFile(codex.path, 'utf8'), sealed);
  assert.equal((await readdir(join(codex.path, '..'))).length, 1);
});
test('invalid project configuration never writes host settings', async t => {
  const f = await fixture(t); await writeFile(f.path, '{"version":1}');
  await assert.rejects(connectHost(f.hosts[1], f.path), /Invalid configuration/);
  await assert.rejects(stat(f.hosts[1].path), { code: 'ENOENT' });
});
test('connect --list is read-only and unknown targets report a useful error without ANSI', async t => {
  const f = await fixture(t);
  const { stdout, stderr } = await exec(process.execPath, [join(root, 'src/cli.js'), 'connect', '-c', f.path, '--list'], { env: { ...process.env, HOME: f.dir, CODEX_HOME: join(f.dir, '.codex'), XDG_CONFIG_HOME: join(f.dir, '.config'), OPENCODE_CONFIG: join(f.dir, 'opencode.json') } });
  assert.match(stdout, /codex:/); assert.match(stdout, /claude-code:/); assert(!stderr.includes('\x1b'));
  await assert.rejects(exec(process.execPath, [join(root, 'src/cli.js'), 'connect', '-c', f.path, '--host', 'unknown']), error => /Unknown host/.test(error.stderr));
  await assert.rejects(stat(join(f.dir, '.codex/config.toml')), { code: 'ENOENT' });
});

test('unsupported OpenCode versions and unsafe interpolation paths fail before writing', async t => {
  const f = await fixture(t); await writeFile(join(f.dir, 'bin/opencode'), '#!/bin/sh\nprintf "2.0.0\\n"\n');
  const host = (await inspectHosts(f.path, f.config, f.options)).find(h => h.id === 'opencode');
  assert.equal(host.status, 'Setup unavailable'); await assert.rejects(connectHost(host, f.path), /1.x/);
  assert.throws(() => hostEntry(f.hosts[1], join(f.dir, '${TOKEN}', 'config.yaml'), f.config), /interpolation/);
});
