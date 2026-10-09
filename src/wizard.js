import { existsSync } from 'node:fs';
import { input, select, checkbox, confirm } from '@inquirer/prompts';
import { fileURLToPath } from 'node:url';
import { relative, resolve, dirname } from 'node:path';
import { catalogSource, compileProject, suggestedName } from './importer.js';
import { readDocument, saveConfig } from './config.js';
import { assert, UserError } from './errors.js';
import { banner, ribbon, busy, chapter, explain, revealTools } from './ui.js';

const demoSpec = fileURLToPath(new URL('../examples/openapi.yaml', import.meta.url));
const shellQuote = value => `'${String(value).replaceAll("'", "'\"'\"'")}'`;
const guided = () => Boolean(process.stdin.isTTY && process.stderr.isTTY);
const identifier = value => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || 'Nutze 1-64 Buchstaben, Ziffern, Unterstriche oder Bindestriche. Beginne mit einem Buchstaben.';
const parseObject = value => {
  let obj;
  try { obj = JSON.parse(value); } catch { throw new UserError('Gib ein gueltiges JSON-Objekt ein, z.B. {"type":"string"}.'); }
  assert(obj && typeof obj === 'object' && !Array.isArray(obj), 'Gib ein JSON-Objekt mit geschweiften Klammern ein.'); return obj;
};
const jsonInput = async (message, fallback) => parseObject(await input({ message, default: JSON.stringify(fallback),
  validate: value => { try { parseObject(value); return true; } catch (e) { return e.message; } } }));
async function authWizard(options) {
  const type = options.auth ?? await select({ message: 'Welche Zugangsmethode braucht deine API?', choices: [
    { name: 'Kein Schluessel / oeffentliche API', value: 'none' }, { name: 'Bearer-Token (Authorization-Header)', value: 'bearer' }, { name: 'API-Key (Header oder Query)', value: 'apiKey' }
  ] });
  if (type === 'none') return { type };
  assert(['bearer', 'apiKey'].includes(type), '--auth must be none, bearer or apiKey.');
  const env = options.env ?? await input({ message: 'Name der Umgebungsvariable, NICHT der Schluesselwert', default: 'MY_API_TOKEN',
    validate: value => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || 'Gib nur einen Variablennamen ein, z.B. MY_API_TOKEN.' });
  if (type === 'bearer') return { type, env };
  const location = options.keyIn ?? await select({ message: 'Wo erwartet die API den Schluessel?', choices: [{ name: 'Header', value: 'header' }, { name: 'Query', value: 'query' }] });
  const name = options.keyName ?? await input({ message: 'Name des Headers / Query-Parameters', default: 'X-API-Key' });
  return { type, env, in: location, name };
}
async function manualEndpoint() {
  const id = await input({ message: 'Name fuer die Aktion', default: 'getItem', validate: identifier });
  const method = await select({ message: 'HTTP-Methode (GET liest, POST legt an)', choices: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] });
  const path = await input({ message: 'URL-Pfad (z.B. /items/{id})', default: '/items/{id}' });
  const description = await input({ message: 'Was tut diese Aktion?', default: 'Einen Eintrag anhand seiner ID lesen' });
  const parameters = [];
  for (const name of new Set([...path.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]))) {
    const schema = await jsonInput(`Schema fuer den Platzhalter ${name}`, { type: 'string' });
    parameters.push({ name, in: 'path', required: true, schema });
  }
  while (await confirm({ message: 'Query- oder Header-Eingabe hinzufuegen?', default: false })) {
    const name = await input({ message: 'Name der Eingabe' });
    const location = await select({ message: 'Position in der Anfrage', choices: ['query', 'header'] });
    const required = await confirm({ message: 'Muss der Nutzer diesen Wert eingeben?', default: false });
    const schema = await jsonInput('Schema der Eingabe (z.B. {"type":"string"})', { type: 'string' });
    parameters.push({ name, in: location, required, schema });
  }
  let requestBody;
  if (!['GET', 'HEAD'].includes(method) && await confirm({ message: 'JSON-Daten im Request-Body senden?', default: true })) {
    const schema = await jsonInput('Schema fuer die JSON-Daten', { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false });
    requestBody = { required: await confirm({ message: 'Sind die JSON-Daten erforderlich?', default: true }), schema };
  }
  return { id, method, path, description, parameters, ...(requestBody ? { requestBody } : {}) };
}
export async function selectTools(config, directory, sourceId, selectedIds) {
  if (guided()) explain('Was ist ein Tool?', ['Ein Tool ist eine Aktion, die dein Client ausfuehren darf.', 'GET liest Daten. POST, PUT, PATCH und DELETE koennen Daten aendern.', 'Leertaste = markieren; Enter = Auswahl bestaetigen.', 'Fuer das Beispiel: getNote liest eine Notiz, createNote legt eine an.']);
  const catalogs = (await Promise.all(config.sources.filter(s => !sourceId || s.id === sourceId).map(s => catalogSource(s, directory)))).flat();
  const available = catalogs.filter(o => !o.error);
  for (const op of catalogs.filter(o => o.error)) process.stderr.write(`  [unsupported] ${op.source.id}/${op.operation}: ${op.error}\n`);
  assert(available.length, 'No supported operations. Review the documented OpenAPI subset.');
  let selected;
  if (selectedIds !== undefined) {
    const ids = selectedIds === '' ? [] : selectedIds.split(',').map(s => s.trim());
    selected = ids.map(id => {
      const matches = available.filter(o => `${o.source.id}/${o.operation}` === id || (sourceId && o.operation === id));
      assert(matches.length === 1, `Unknown or ambiguous operation: ${id}. Use source/operation.`);
      return matches[0];
    });
  } else {
    selected = await checkbox({ message: 'Welche Aktionen darf dein Client verwenden? (Leertaste markiert)', choices: available.map(o => ({
      name: `${['GET', 'HEAD', 'OPTIONS'].includes(o.method) ? '[lesen]' : '[aendern]'} ${o.operation} - ${o.description.replaceAll(/\s+/g, ' ').slice(0, 65)} (${o.method} ${o.path})`, value: o,
      checked: config.tools.some(t => t.source === o.source.id && t.operation === o.operation && t.enabled !== false)
    })) });
  }
  const previous = config.tools;
  const tools = sourceId ? previous.filter(t => t.source !== sourceId) : [];
  const customize = selectedIds === undefined && selected.length && await confirm({ message: 'Namen, Beschreibungen oder Schemas anpassen? (Optional; fuer den Einstieg ueberspringen)', default: false });
  for (const op of selected) {
    const existing = previous.find(t => t.source === op.source.id && t.operation === op.operation);
    const tool = existing ? { ...existing } : { source: op.source.id, operation: op.operation, name: suggestedName(op.source.id, op.operation) };
    if (customize) {
      tool.name = await input({ message: `Tool-Name fuer ${op.operation}`, default: tool.name, validate: identifier });
      tool.description = await input({ message: 'Beschreibung', default: tool.description ?? op.description });
      if (await confirm({ message: 'Vollstaendiges Eingabeschema anpassen? (Fuer Fortgeschrittene)', default: false })) {
        tool.inputSchema = await jsonInput('Eingabeschema (Gruppen path/query/headers/body beibehalten)', tool.inputSchema ?? op.inputSchema);
      }
    }
    tool.enabled = true;
    tools.push(tool);
  }
  for (const old of previous) {
    if ((!sourceId || old.source === sourceId) && !tools.some(t => t.source === old.source && t.operation === old.operation)) tools.push({ ...old, enabled: false });
  }
  config.tools = tools;
  return config;
}
export async function addSource(config, configPath, options = {}) {
  if (guided()) await chapter(1, 'Deine API beschreiben', [
    'OpenAPI ist eine Datei mit dem Bauplan deiner API.',
    'Zum Lernen kannst du den fertigen lokalen Beispiel-Bauplan verwenden.',
    'Ohne OpenAPI trage einzelne URLs und ihre Eingaben manuell ein.'
  ], 'import');
  const id = options.id ?? await input({ message: 'Kurzer Name fuer diese API', default: config.sources.length ? `api${config.sources.length + 1}` : 'demo', validate: identifier });
  assert(!config.sources.some(s => s.id === id), `Source ${id} already exists.`);
  const mode = options.spec ? 'openapi' : await select({ message: 'Wie moechtest du starten?', choices: [
    { name: 'Lokales Beispiel ausprobieren (empfohlen zum Lernen)', value: 'demo' },
    { name: 'Eigene OpenAPI-Datei importieren (JSON / YAML)', value: 'openapi' },
    { name: 'REST-Endpunkte selbst beschreiben', value: 'manual' }
  ] });
  const source = { id, auth: { type: 'none' } };
  let defaultUrl = 'http://127.0.0.1:3001';
  if (mode === 'openapi' || mode === 'demo') {
    const filename = mode === 'demo' ? demoSpec : resolve(options.spec ?? await input({ message: 'Pfad zu deiner OpenAPI-Datei', default: 'examples/openapi.yaml' }));
    source.spec = relative(dirname(resolve(configPath)), filename) || '.';
    const spec = await busy('API-Bauplan lesen', () => readDocument(filename));
    defaultUrl = spec?.servers?.[0]?.url ?? defaultUrl;
    if (guided()) explain('Bauplan geladen', [mode === 'demo' ? 'Das Beispiel ist eine Notiz-API: Notizen lesen und anlegen.' : 'Der Import liest deine Datei. Er sendet noch keine API-Anfrage.',
      'Die Basis-URL ist die Adresse deiner API. /notes/{id} wird daran angehaengt.']);
  } else {
    if (guided()) explain('Beispiel fuer einen REST-Endpunkt', ['GET /items/{id} liest einen Eintrag.', '{id} ist ein Platzhalter. Dein Tool fragt spaeter nach diesem Wert.', 'Ein Schema beschreibt erlaubte Eingaben, z.B. {"type":"string"} fuer Text.']);
    source.endpoints = [];
    do { source.endpoints.push(await manualEndpoint()); }
    while (await confirm({ message: 'Noch einen Endpunkt hinzufuegen?', default: false }));
  }
  source.baseUrl = options.baseUrl ?? (mode === 'demo' ? defaultUrl : await input({ message: 'Basis-URL deiner API (inklusive z.B. /v1)', default: defaultUrl }));
  config.sources.push(source);
  if (guided()) await chapter(2, 'Die erlaubten Aktionen auswaehlen', ['Eine API kann viele Aktionen anbieten. Du waehlst die passenden aus.', 'Diese Auswahl landet in deiner Konfig und bestimmt, was der Client sieht.'], 'tools');
  await selectTools(config, dirname(resolve(configPath)), id, options.select);
  if (guided()) await revealTools(config.tools.filter(t => t.source === id));
  if (guided()) await chapter(3, 'Zugang zu deiner API einstellen', [
    mode === 'demo' ? 'Das lokale Beispiel braucht keinen Token: waehle "Kein Schluessel".' : 'Welche Zugangsmethode braucht deine API? Das steht in ihrer Dokumentation.',
    'Bearer und API-Key sind zwei Arten von Zugangsschluesseln.',
    'Du gibst nur einen Variablennamen ein. Den echten Schluessel setzt du ausserhalb der Konfig.'
  ], 'auth');
  source.auth = await authWizard(options);
  if (guided() && source.auth.type !== 'none') explain('Deine Umgebung vorbereiten', [
    `Setze ${source.auth.env} im Startprozess auf deinen echten API-Schluessel.`,
    'Die Konfig speichert nur den Namen. doctor prueft, ob der Wert vorhanden ist.'
  ]);
  return config;
}
export async function initialize(configPath, options) {
  assert(!existsSync(configPath), 'Diese Konfig existiert bereits. Nutze tools --choose oder init --config neues-projekt.yaml.');
  await banner();
  if (guided()) explain('Dein Projekt', ['Der Projektname steht spaeter im Client. Du kannst den Vorschlag uebernehmen.', 'Eine Datei speichert deine Auswahl; du schreibst keinen Server-Code.']);
  const config = { version: 1, name: options.name ?? await input({ message: 'Projektname', default: 'open-mcp', validate: identifier }), timeoutMs: 10000, sources: [], tools: [] };
  await addSource(config, configPath, options);
  if (guided()) await chapter(4, 'Die Konfig pruefen und lokal starten', ['Wir pruefen jetzt die Beschreibungen und deine Tool-Auswahl.', 'Die Datei wird erst gespeichert, wenn diese Pruefung erfolgreich ist.'], 'local');
  await busy('Konfiguration pruefen', () => compileProject(config, dirname(resolve(configPath))));
  await saveConfig(configPath, config, { create: true });
  await ribbon('Konfig erfolgreich gespeichert');
  if (guided()) await chapter(5, 'Deinen Client verbinden', ['Ein Client ist das Programm, das deine Tools auflistet und aufruft.', 'MCP Inspector ist unser getesteter Client. Er startet Open MCP selbst.', 'Die Verbindung zum Client ist nach dem Speichern noch nicht hergestellt.'], 'client');
  const command = `node ${shellQuote(fileURLToPath(new URL('./cli.js', import.meta.url)))}`;
  const configArg = `--config ${shellQuote(resolve(configPath))}`;
  const demoSource = config.sources.find(s => s.spec && s.baseUrl === 'http://127.0.0.1:3001' && resolve(dirname(resolve(configPath)), s.spec) === demoSpec);
  explain('Gespeichert. Das sind deine naechsten Schritte:', [`Konfig: ${resolve(configPath)}`]);
  if (demoSource) {
    process.stderr.write(`  1. In einem ZWEITEN Terminal die Beispiel-API starten:\n     node ${shellQuote(fileURLToPath(new URL('../examples/api.js', import.meta.url)))}\n     Lass dieses Terminal offen. Die API lauscht auf Port 3001.\n\n`);
  } else process.stderr.write('  1. Stelle sicher, dass deine API erreichbar ist und die Zugangswerte gesetzt sind.\n\n');
  process.stderr.write(`  2. Zurueck in diesem Terminal: den lokalen MCP-Server testen:\n     ${command} doctor ${configArg}\n     doctor verbindet sich und listet deine Tools. Er ruft die API noch nicht auf.\n\n`);
  const read = config.tools.find(t => t.source === demoSource?.id && t.operation === 'getNote');
  if (read) process.stderr.write(`     Auch die Beispiel-API mit einer echten Notiz testen:\n     ${command} doctor ${configArg} --probe ${read.name} --args '{"path":{"id":"1"}}'\n\n`);
  process.stderr.write(`  3. Den Startbefehl fuer den Client exportieren:\n     ${command} export ${configArg} > client.local.json\n\n`);
  process.stderr.write(`  4. Im MCP Inspector die verfuegbaren Tools auflisten:\n     MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector --cli --config client.local.json --server ${config.name} --format json --method tools/list\n\n`);
  if (config.sources.some(s => s.auth.type !== 'none')) process.stderr.write('     Private APIs: Inspector braucht zusaetzlich die Zugangswerte als -e NAME=value. Details im README.\n');
  if (read) process.stderr.write(`     Eine Notiz ueber den Client lesen:\n     MCP_INSPECTOR_SECRET_STORE=memory npx --no-install @modelcontextprotocol/inspector --cli --config client.local.json --server ${config.name} --format json --method tools/call --tool-name ${read.name} --tool-args-json '{"path":{"id":"1"}}'\n\n`);
}
