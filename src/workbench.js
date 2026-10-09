import terminalKit from 'terminal-kit';
import { resolve } from 'node:path';
import { readProjects, sourceRows, toolsFor, toggleTool, updateSettings } from './workbench-store.js';
import { assert, redact, UserError } from './errors.js';

const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
const colors = { ink: 'white', muted: 'gray', accent: 'cyan', on: 'green', off: 'gray', error: 'red' };
const settingFields = ['API-Adresse', 'Auth-Art', 'Variablenname', 'API-Key Position', 'API-Key Name', 'Timeout (ms)', 'Animationen (Sitzung)', 'Speichern'];
export function formFor(project, sourceId, motion) {
  const source = project.config.sources.find(s => s.id === sourceId);
  return { baseUrl: source.baseUrl, auth: { ...source.auth }, timeoutMs: project.config.timeoutMs ?? 10000, motion };
}
export function createViewState(projects, motion = true) {
  return { projects, rows: sourceRows(projects), row: 0, tool: 0, pane: 'mcps', mode: 'browse', motion,
    progress: motion ? 0 : 1, tick: 0, status: 'Waehl einen MCP. Enter oeffnet seine Tools.', busy: false, field: 0 };
}
const active = state => {
  const row = state.rows[state.row]; const project = row && state.projects[row.projectIndex];
  return { row, project, tools: project && row?.sourceId ? toolsFor(project, row.sourceId) : [] };
};
export function frameLines(state, width, height) {
  const { row, project, tools } = active(state);
  if (width < 64 || height < 18) return [
    { x: 2, y: 2, text: 'OPEN MCP', color: 'cyan' },
    { x: 2, y: 4, text: 'Bitte Terminal auf mindestens 64 x 18 vergroessern.' },
    { x: 2, y: 6, text: 'q / Ctrl+C = schliessen' }
  ];
  const left = Math.min(30, Math.floor(width * 0.3)); const right = left + 3;
  const lines = [];
  const put = (x, y, text, color = colors.ink, max = width - x - 1, bold = false) => {
    if (y >= 0 && y < height && max > 0) lines.push({ x, y, text: clean(text).slice(0, max), color, bold });
  };
  put(2, 1, 'OPEN MCP  /  DEINE API-TOOLS', colors.accent, width - 4, true);
  put(2, 2, 'Freigaben konfigurieren. Laufende Clients nach Aenderungen neu verbinden.', colors.muted);
  for (let y = 4; y < height - 4; y++) put(left + 1, y, '|', colors.muted, 1);
  put(2, 6, state.pane === 'mcps' ? '> DEINE MCPs' : '  DEINE MCPs', colors.accent, left - 2, true);
  const visibleRows = height - 12; const firstRow = Math.max(0, state.row - visibleRows + 1);
  state.rows.slice(firstRow, firstRow + visibleRows).forEach((item, i) => {
    const selected = firstRow + i === state.row;
    put(2, 8 + i, `${selected ? '>' : ' '} ${item.title}`, selected ? colors.accent : colors.ink, left - 2, selected);
    // Project context remains visible without taking an extra row per source.
  });
  if (!state.rows.length) {
    put(right, 6, 'Noch kein Open-MCP-Projekt gefunden.', colors.accent);
    put(right, 8, 'n = neues Projekt mit dem Wizard anlegen');
    put(right, 10, 'Es werden Konfig-Dateien in diesem Ordner gesucht.', colors.muted);
    put(right, 11, 'Andere Ordner: openmcp --projects /pfad', colors.muted);
  } else if (state.mode === 'help') {
    put(right, 4, 'TASTEN & BEGRIFFE', colors.accent, undefined, true);
    ['Links: Projekte/API-Quellen. Rechts: ihre Toolcalls.', 'Toolcall = eine freigegebene API-Aktion.', '',
      'Pfeile / j,k  Auswahl bewegen', 'Enter / Rechts  Tools des MCP oeffnen', 'Tab / Links  Zwischen Spalten wechseln',
      'Leertaste  Tool ein oder ausschalten + speichern', 's  API-Adresse, Auth und Timeout einstellen',
      'r  Konfig-Dateien neu laden', 'n  Neues MCP-Projekt anlegen', 'Esc  Zurueck / Eingabe abbrechen', 'q / Ctrl+C  Beenden', '',
      'Die Animation zeigt deine Auswahl und Freigabe.', 'Das Browsen ruft keine API auf.'].forEach((line, i) => put(right, 6 + i, line, i >= 13 ? colors.muted : colors.ink));
  } else if (state.mode === 'settings' && state.form) {
    put(right, 4, 'SETTINGS  /  s', colors.accent, undefined, true);
    put(right, 5, `${row.projectName} / ${row.sourceId}`, colors.muted);
    const values = [state.form.baseUrl, state.form.auth.type, state.form.auth.env ?? '(nicht benoetigt)',
      state.form.auth.in ?? 'header', state.form.auth.name ?? 'X-API-Key', state.form.timeoutMs, state.form.motion ? 'AN' : 'AUS', 'Enter speichert in der Projektkonfig'];
    if (!state.editor) {
      const spacing = height >= 28 ? 2 : 1;
      settingFields.forEach((label, i) => {
        const y = 7 + i * spacing;
        put(right, y, `${state.field === i ? '>' : ' '} ${label}${spacing === 1 ? `: ${values[i]}` : ''}`, state.field === i ? colors.accent : colors.muted);
        if (spacing === 2) put(right + 3, y + 1, values[i], colors.ink);
      });
    }

  } else {
    // The title travels from the right-hand staging area into the left-aligned position.
    const titleX = 2 + Math.round((1 - state.progress) * Math.max(0, width / 2 - 2));
    put(titleX, 4, row?.title ?? 'MCP', colors.accent, state.progress === 1 ? left - 2 : width - titleX - 2, true);
    if (state.progress > 0.65) put(right, 4, state.pane === 'tools' ? '> TOOLCALLS' : '  TOOLCALLS', colors.accent, undefined, true);
    put(right, 5, `${row.projectName} / ${row.sourceId ?? ''}`, colors.muted);
    if (!project.config) put(right, 8, project.error, colors.error);
    else {
      const first = Math.max(0, state.tool - Math.max(1, Math.floor((height - 14) / 3)) + 1);
      const count = Math.max(1, Math.floor((height - 13) / 3));
      tools.slice(first, first + count).forEach((tool, i) => {
        const delay = Math.min(0.45, i * 0.07);
        const reveal = Math.max(0, Math.min(1, (state.progress - delay) / (1 - delay)));
        if (!reveal) return;
        const x = right + Math.round((1 - reveal) * 12);
        const focused = state.pane === 'tools' && state.tool === first + i;
        const status = tool.error ? '[!]' : tool.enabled ? '[ON ]' : '[OFF]';
        const pulse = state.motion && tool.enabled ? ['.', 'o', 'O', 'o'][Math.floor(state.tick / 3) % 4] : tool.enabled ? '*' : '-';
        put(x, 7 + i * 3, `${focused ? '>' : ' '} ${status} ${tool.name}  ${pulse}`, tool.error ? colors.error : focused ? colors.accent : tool.enabled ? colors.on : colors.off, undefined, focused);
        put(x + 3, 8 + i * 3, `${tool.method} ${tool.path}  ${tool.error ?? tool.description ?? ''}`, colors.muted);
      });
      if (!tools.length) put(right, 8, 'Keine Tools importiert. s oeffnet die Quell-Einstellungen.', colors.muted);
      put(right, height - 6, `${tools.filter(t => t.enabled).length}/${tools.length} freigegeben | Tool ${tools.length ? state.tool + 1 : 0}/${tools.length} | kein API-Aufruf`, colors.muted);
    }
  }
  if (state.editor) {
    put(right, height - 9, `EINGABE: ${settingFields[state.editor.field]}`, colors.accent);
    put(right, height - 8, `${state.editor.value.slice(-Math.max(1, width - right - 3))}_`);
    put(right, height - 7, 'Enter uebernimmt ins Formular | Esc verwirft | Ctrl+U leert', colors.muted);
  }
  put(2, height - 3, state.busy ? 'Speichere und validiere ...' : state.status, state.error ? colors.error : colors.muted);
  put(2, height - 2, width >= 90 ? '[Enter] Tools  [Space] an/aus  [s] Settings  [r] Reload  [n] Neu  [?] Hilfe  [q] Ende' : '[Enter] Tools [Space] an/aus [s] Settings [?] Hilfe [q] Ende', colors.accent);
  return lines;
}
export async function runWorkbench({ directory = process.cwd(), configs = [], env = process.env } = {}) {
  assert(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb', 'openmcp braucht ein interaktives Terminal. Nutze --help fuer die bisherigen CLI-Befehle.');
  const projects = await readProjects(resolve(directory), configs);
  const motion = !env.OPEN_MCP_NO_ANIMATION && !env.CI;
  const state = createViewState(projects, motion);
  const term = terminalKit.terminal;
  let screen; let timer; let stopped = false;
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const render = () => {
    if (stopped) return;
    if (!screen || screen.width !== term.width || screen.height !== term.height) screen = new terminalKit.ScreenBuffer({ dst: term, width: term.width, height: term.height });
    screen.fill({ attr: { color: 'white', bgColor: 'black' } });
    for (const line of frameLines(state, term.width, term.height)) screen.put({ x: line.x, y: line.y, attr: { color: line.color ?? 'white', bgColor: 'black', bold: Boolean(line.bold) }, wrap: false, markup: false }, line.text);
    screen.draw({ delta: true });
  };
  const transition = () => { state.progress = state.motion ? 0 : 1; state.tool = 0; state.mode = 'browse'; state.form = undefined; };
  const stop = action => { if (stopped) return; stopped = true; finish(action); };
  const safeError = error => {
    const secrets = state.projects.flatMap(p => p.config?.sources.filter(s => s.auth.type !== 'none').map(s => env[s.auth.env]) ?? []);
    state.status = redact(error instanceof UserError ? error.message : 'Aktion fehlgeschlagen. Pruefe validate oder lade mit r neu.', secrets); state.error = true;
  };
  const save = async action => {
    state.busy = true; state.error = false; render();
    try { await action(); }
    catch (error) { safeError(error); }
    finally { state.busy = false; if (state.exitRequested) stop(); else render(); }
  };
  const onKey = async (name, matches, data) => {
    if (name === 'CTRL_C') { if (state.busy) state.exitRequested = true; else stop(); return; }
    if (state.busy || stopped) return;
    const { row, project, tools } = active(state);
    if (state.editor) {
      if (name === 'ESCAPE') state.editor = undefined;
      else if (name === 'BACKSPACE') state.editor.value = [...state.editor.value].slice(0, -1).join('');
      else if (name === 'CTRL_U') state.editor.value = '';
      else if (name === 'ENTER') {
        const { field, value } = state.editor;
        if (field === 0) state.form.baseUrl = value;
        if (field === 2) state.form.auth.env = value;
        if (field === 4) state.form.auth.name = value;
        if (field === 5) state.form.timeoutMs = Number(value);
        state.editor = undefined;
      } else if (data?.isCharacter && state.editor.value.length < 2048) state.editor.value += name;
      render(); return;
    }
    if (name === 'q') { stop(); return; }
    if (name === 'n') { stop({ action: 'create', directory: resolve(directory) }); return; }
    if (name === '?') { state.mode = state.mode === 'help' ? 'browse' : 'help'; render(); return; }
    if (name === 'r') {
      await save(async () => { state.projects = await readProjects(resolve(directory), configs); state.rows = sourceRows(state.projects); state.row = Math.min(state.row, Math.max(0, state.rows.length - 1)); transition(); state.status = 'Projektkonfigurationen neu geladen.'; }); return;
    }
    if (name === 'ESCAPE') { state.mode = 'browse'; state.pane = 'mcps'; state.editor = undefined; render(); return; }
    if (name === 's' && project?.config) {
      if (state.mode === 'settings') state.mode = 'browse';
      else { state.mode = 'settings'; state.form = formFor(project, row.sourceId, state.motion); state.field = 0; state.status = 'Enter bearbeitet. Zum Speichern den letzten Eintrag waehlen.'; }
      render(); return;
    }
    if (state.mode === 'settings') {
      if (name === 'UP' || name === 'k') state.field = (state.field + settingFields.length - 1) % settingFields.length;
      if (name === 'DOWN' || name === 'j') state.field = (state.field + 1) % settingFields.length;
      if (name === 'ENTER' || name === ' ') {
        if (state.field === 1) {
          const type = ['none', 'bearer', 'apiKey'][(['none', 'bearer', 'apiKey'].indexOf(state.form.auth.type) + 1) % 3];
          state.form.auth = type === 'none' ? { type } : type === 'bearer' ? { type, env: state.form.auth.env ?? 'MY_API_TOKEN' } : { type, env: state.form.auth.env ?? 'MY_API_TOKEN', in: 'header', name: 'X-API-Key' };
        } else if (state.field === 3 && state.form.auth.type === 'apiKey') state.form.auth.in = state.form.auth.in === 'header' ? 'query' : 'header';
        else if (state.field === 6) { state.form.motion = !state.form.motion; state.motion = state.form.motion; state.progress = 1; }
        else if (state.field === 7) await save(async () => {
          const auth = state.form.auth.type === 'none' ? { type: 'none' } : state.form.auth.type === 'bearer' ? { type: 'bearer', env: state.form.auth.env } : { ...state.form.auth };
          state.projects[row.projectIndex] = await updateSettings(project, row.sourceId, { ...state.form, auth });
          state.mode = 'browse'; state.status = 'Settings gespeichert. Client neu verbinden.';
        });
        else if ([0, 2, 4, 5].includes(state.field)) {
          if ((state.field === 2 && state.form.auth.type === 'none') || (state.field === 4 && state.form.auth.type !== 'apiKey')) state.status = 'Dieses Feld wird fuer die gewaehlte Auth-Art nicht benoetigt.';
          else state.editor = { field: state.field, value: String([state.form.baseUrl, '', state.form.auth.env ?? '', '', state.form.auth.name ?? '', state.form.timeoutMs][state.field]) };
        }
      }
      render(); return;
    }
    if (state.mode === 'help') return;
    if (name === 'TAB' || name === 'SHIFT_TAB') state.pane = state.pane === 'mcps' ? 'tools' : 'mcps';
    if (name === 'LEFT') state.pane = 'mcps';
    if (name === 'RIGHT' || name === 'ENTER') { state.pane = 'tools'; state.progress = state.motion ? 0 : 1; }
    if (name === 'UP' || name === 'k' || name === 'DOWN' || name === 'j') {
      const direction = name === 'UP' || name === 'k' ? -1 : 1;
      if (state.pane === 'mcps' && state.rows.length) { state.row = (state.row + direction + state.rows.length) % state.rows.length; transition(); }
      else if (tools.length) state.tool = (state.tool + direction + tools.length) % tools.length;
    }
    if (name === ' ' && state.pane === 'tools' && tools[state.tool]) await save(async () => {
      state.projects[row.projectIndex] = await toggleTool(project, row.sourceId, tools[state.tool].operation);
      state.status = `${tools[state.tool].name} ${tools[state.tool].enabled ? 'ausgeschaltet' : 'eingeschaltet'} und gespeichert. Client neu verbinden.`;
    });
    render();
  };
  const keyHandler = (...args) => { onKey(...args).catch(error => { safeError(error); render(); }); };
  const onSignal = () => stop();
  const onEnd = () => stop();
  try {
    term.alternateScreenBuffer(true); term.hideCursor(); term.grabInput();
    term.on('key', keyHandler); term.on('resize', render);
    process.once('SIGTERM', onSignal); process.stdin.once('end', onEnd);
    render();
    timer = setInterval(() => { if (state.motion && !state.editor) { state.progress = Math.min(1, state.progress + 0.12); state.tick++; render(); } }, 75);
    return await result;
  } finally {
    stopped = true; clearInterval(timer); term.removeListener('key', keyHandler); term.removeListener('resize', render);
    process.removeListener('SIGTERM', onSignal); process.stdin.removeListener('end', onEnd);
    term.grabInput(false); term.styleReset(); term.hideCursor(false); term.alternateScreenBuffer(false);
  }
}
