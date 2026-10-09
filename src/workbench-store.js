import { readdir, readFile } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig, readDocument, validateConfig, saveConfig } from './config.js';
import { compileProject, catalogSource, suggestedName } from './importer.js';
import { assert, UserError } from './errors.js';

const signature = text => createHash('sha256').update(text).digest('hex');
const key = (source, operation) => JSON.stringify([source, operation]);
export async function discoverProjects(directory, explicit = []) {
  if (explicit.length) return [...new Set(explicit.map(path => resolve(path)))];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch { throw new UserError('Cannot read project folder. Check --projects or --config.'); }
  const paths = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !['.yaml', '.yml', '.json'].includes(extname(entry.name)) || entry.name.startsWith('.')) continue;
    const path = resolve(directory, entry.name);
    try {
      const doc = await readDocument(path);
      if (doc?.version === 1 && (doc.sources || doc.tools)) paths.push(path);
    } catch { if (/open[-_]?mcp|\.config\./i.test(entry.name)) paths.push(path); }
  }
  return paths;
}
export async function readProject(path) {
  const before = await readFile(path, 'utf8');
  const loaded = await loadConfig(path);
  const after = await readFile(loaded.path, 'utf8');
  assert(before === after, 'Configuration changed while loading. Press r to reload.');
  const hash = signature(after);
  let catalog = []; let error;
  try { catalog = (await compileProject(loaded.config, loaded.directory)).catalog; }
  catch (e) {
    if (!(e instanceof UserError)) throw e;
    error = e.message;
    // Keep editable source settings when a valid config fails source/selection compilation.
    for (const source of loaded.config.sources) {
      try { catalog.push(...await catalogSource(source, loaded.directory)); }
      catch (e) { catalog.push({ source, operation: '(import error)', method: '', path: '', error: e instanceof UserError ? e.message : 'Import failed.' }); }
    }
  }
  return { ...loaded, hash, catalog, error };
}
export async function readProjects(directory, explicit = []) {
  const projects = [];
  for (const path of await discoverProjects(directory, explicit)) {
    try { projects.push(await readProject(path)); }
    catch (e) { projects.push({ path, name: basename(path), error: e instanceof UserError ? e.message : 'Could not load project.' }); }
  }
  return projects;
}
export function sourceRows(projects) {
  return projects.flatMap((project, projectIndex) => project.config ? project.config.sources.map(source => ({
    projectIndex, sourceId: source.id, projectName: project.config.name, title: `${project.config.name}/${source.id}`,
    count: project.catalog.filter(o => o.source.id === source.id && !o.error).length
  })) : [{ projectIndex, projectName: project.name, title: 'Configuration error', error: project.error }]);
}
export function toolsFor(project, sourceId) {
  if (!project.config) return [];
  const definitions = new Map(project.config.tools.map(t => [key(t.source, t.operation), t]));
  return project.catalog.filter(o => o.source.id === sourceId).map(operation => {
    const definition = definitions.get(key(sourceId, operation.operation));
    return { ...operation, name: definition?.name ?? suggestedName(sourceId, operation.operation),
      description: definition?.description ?? operation.description ?? operation.error,
      enabled: Boolean(definition && definition.enabled !== false) };
  });
}
export async function persistProject(project, update) {
  assert(project.config, 'This project needs a valid configuration first.');
  const current = await readFile(project.path, 'utf8');
  assert(signature(current) === project.hash, 'Configuration changed outside the dashboard. Press r to reload.');
  const candidate = structuredClone(project.config);
  update(candidate);
  validateConfig(candidate);
  const compiled = await compileProject(candidate, project.directory);
  await saveConfig(project.path, candidate);
  return { ...project, config: candidate, catalog: compiled.catalog, error: undefined,
    hash: signature(await readFile(project.path, 'utf8')) };
}
export async function toggleTool(project, sourceId, operationId) {
  const operation = project.catalog.find(o => o.source.id === sourceId && o.operation === operationId);
  const existing = project.config.tools.find(t => t.source === sourceId && t.operation === operationId);
  assert(operation && (!operation.error || (existing && existing.enabled !== false)), operation?.error ?? 'This tool is unavailable.');
  return persistProject(project, config => {
    const existing = config.tools.find(t => t.source === sourceId && t.operation === operationId);
    if (existing) existing.enabled = existing.enabled === false;
    else config.tools.push({ source: sourceId, operation: operationId, name: suggestedName(sourceId, operationId), enabled: true });
  });
}
export async function updateSettings(project, sourceId, values) {
  return persistProject(project, config => {
    const source = config.sources.find(s => s.id === sourceId);
    assert(source, 'API source not found.');
    config.timeoutMs = values.timeoutMs;
    source.baseUrl = values.baseUrl;
    source.auth = values.auth;
  });
}
