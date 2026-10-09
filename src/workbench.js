import terminalKit from 'terminal-kit';
import { resolve } from 'node:path';
import { readProjects, sourceRows, toolsFor, toggleTool, updateSettings } from './workbench-store.js';
import { assert, redact, UserError } from './errors.js';

const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
const colors = { ink: 'default', muted: 'gray', accent: 'cyan', on: 'green', error: 'red' };
const settingFields = ['API-Adresse', 'Auth-Art', 'Variablenname', 'API-Key Position', 'API-Key Name', 'Timeout (ms)', 'Animationen (Sitzung)', 'Speichern'];
export function formFor(project, sourceId, motion) {
  const source = project.config.sources.find(s => s.id === sourceId);
  return { baseUrl: source.baseUrl, auth: { ...source.auth }, timeoutMs: project.config.timeoutMs ?? 10000, motion };
}
export function createViewState(projects, motion = true) {
  return { projects, rows: sourceRows(projects), row: 0, tool: 0, pane: 'mcps', mode: 'browse', motion,
    progress: 1, status: sourceRows(projects).length === 1 ? 'Eine API-Quelle vorhanden. [n] legt ein weiteres MCP-Projekt an.' : 'Pfeile waehlen eine MCP-Quelle. Enter oeffnet ihre Tools.', busy: false, field: 0 };
}
export function openToolPane(state) {
  if (state.pane === 'tools') return;
  state.pane = 'tools';
  state.status = 'Pfeile waehlen ein Tool. Space schaltet es an oder aus.';
}
export function selectMcp(state, index) {
  const next = Math.max(0, Math.min(state.rows.length - 1, index));
  if (!state.rows.length || next === state.row) return false;
  state.row = next; state.tool = 0; state.progress = state.motion ? 0 : 1;
  return true;
}
export function moveSelection(state, direction) {
  if (state.pane === 'mcps') return selectMcp(state, state.row + direction);
  const count = active(state).tools.length;
  const next = Math.max(0, Math.min(count - 1, state.tool + direction));
  if (!count || next === state.tool) return false;
  state.tool = next; return true;
}
export function listMouse(state, name, data, width, height) {
  if (state.busy || state.mode !== 'browse' || state.editor || width < 64 || height < 18) return false;
  const x = data.x - 1; const y = data.y - 1;
  const left = Math.min(32, Math.floor(width * 0.3));
  if (y < 6 || y >= height - 5) return false;
  const pane = x >= 2 && x < left ? 'mcps' : x >= left + 2 && x < width - 2 ? 'tools' : undefined;
  if (!pane || !['MOUSE_WHEEL_UP', 'MOUSE_WHEEL_DOWN', 'MOUSE_LEFT_BUTTON_PRESSED'].includes(name)) return false;
  let changed = state.pane !== pane; state.pane = pane;
  if (name !== 'MOUSE_LEFT_BUTTON_PRESSED') return moveSelection(state, name === 'MOUSE_WHEEL_UP' ? -1 : 1) || changed;
  if (pane === 'mcps') {
    const count = Math.max(1, Math.floor((height - 12) / 3));
    const first = Math.max(0, state.row - count + 1);
    const index = first + Math.floor((y - 7) / 3);
    if (y >= 7 && (y - 7) % 3 < 2 && index < Math.min(state.rows.length, first + count)) changed = selectMcp(state, index) || changed;
  } else {
    const count = Math.max(1, Math.floor((height - 12) / 6));
    const first = Math.max(0, state.tool - count + 1);
    const index = first + Math.floor((y - 7) / 6);
    if (y >= 7 && (y - 7) % 6 < 5 && index < Math.min(active(state).tools.length, first + count)) {
      changed = state.tool !== index || changed; state.tool = index;
    }
  }
  return changed;
}
export function advanceBuild(state) {
  if (!state.motion || state.mode !== 'browse' || state.progress >= 1) return false;
  state.progress = Math.min(1, state.progress + 0.12);
  return true;
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
  const left = Math.min(32, Math.floor(width * 0.3)); const right = left + 2;
  const lines = [];
  const put = (x, y, text, color = colors.ink, max = width - x - 1, bold = false) => {
    if (y >= 0 && y < height && max > 0) lines.push({ x, y, text: clean(text).slice(0, max), color, bold });
  };
  const box = (x, y, w, h, label = '', color = colors.muted, reveal = 1) => {
    const caption = label ? ` ${clean(label).slice(0, w - 6)} ` : '';
    const top = `+${caption}${'-'.repeat(w - caption.length - 2)}+`;
    put(x, y, top.slice(0, Math.ceil(w * Math.min(1, reveal * 3))), color, w);
    const sides = Math.ceil((h - 2) * Math.max(0, Math.min(1, reveal * 3 - 1)));
    for (let dy = 1; dy <= sides; dy++) {
      put(x, y + dy, '|', color, 1); put(x + w - 1, y + dy, '|', color, 1);
    }
    put(x, y + h - 1, `+${'-'.repeat(w - 2)}+`.slice(0, Math.ceil(w * Math.max(0, Math.min(1, reveal * 3 - 2)))), color, w);
  };
  const panelWidth = width - right - 2;
  const content = right + 2;
  const contentWidth = panelWidth - 4;
  put(2, 1, 'OPEN MCP', colors.accent, width - 4, true);
  put(12, 1, '/ API-Aktionen als MCP-Tools', colors.muted);
  if (row) put(2, 3, row.title, colors.accent, left - 3, true);
  box(2, 5, left - 2, height - 9, 'DEINE MCPs', state.pane === 'mcps' ? colors.accent : colors.muted);
  const visibleRows = Math.max(1, Math.floor((height - 12) / 3)); const firstRow = Math.max(0, state.row - visibleRows + 1);
  state.rows.slice(firstRow, firstRow + visibleRows).forEach((item, i) => {
    const selected = firstRow + i === state.row;
    put(4, 7 + i * 3, `${selected ? '>' : ' '} ${item.projectName ?? item.title}`, selected ? colors.accent : colors.ink, left - 6, selected);
    if (item.sourceId) put(6, 8 + i * 3, item.sourceId, colors.ink, left - 8);
  });
  put(4, height - 6, `${state.rows.length ? state.row + 1 : 0}/${state.rows.length} | n: neu`, colors.muted, left - 6);
  const label = state.mode === 'settings' ? 'SETTINGS' : state.mode === 'help' ? 'HILFE' : 'TOOLCALLS';
  box(right, 5, panelWidth, height - 9, label, state.pane === 'tools' || state.mode !== 'browse' ? colors.accent : colors.muted);
  if (!state.rows.length) {
    put(content, 7, 'Noch kein MCP-Projekt gefunden.', colors.accent, contentWidth);
    put(content, 9, '[n] Neues Projekt anlegen', colors.ink, contentWidth);
    put(content, 11, 'Ordner: openmcp --projects /pfad', colors.muted, contentWidth);
  } else if (state.mode === 'help') {
    const help = ['Toolcall = eine API-Aktion.', 'Pfeile / j,k: Auswahl bewegen', 'Enter / Rechts: Tools oeffnen', 'Tab / Links: Spalte wechseln',
      'Space: an/aus + speichern', 's: Einstellungen   r: neu laden', 'n: neues Projekt   q: beenden', 'Esc: zurueck / abbrechen',
      'Beim Browsen wird keine API aufgerufen.', 'Clients nach Aenderungen neu verbinden.'];
    const first = Math.max(0, Math.min(state.helpRow ?? 0, Math.max(0, help.length - (height - 13))));
    help.slice(first, first + height - 13).forEach((line, i) => put(content, 7 + i, line, colors.ink, contentWidth));
    put(content, height - 6, 'Pfeile: scrollen | Esc: zurueck', colors.muted, contentWidth);
  } else if (state.mode === 'settings' && state.form) {
    const values = [state.form.baseUrl, state.form.auth.type, state.form.auth.env ?? '(nicht benoetigt)',
      state.form.auth.in ?? 'header', state.form.auth.name ?? 'X-API-Key', state.form.timeoutMs, state.form.motion ? 'AN' : 'AUS'];
    if (!state.editor) {
      const spacing = height >= 28 ? 2 : 1;
      const count = Math.min(7, Math.floor((height - 14) / spacing));
      const first = Math.max(0, Math.min(state.field, 6) - count + 1);
      settingFields.slice(first, first + count).forEach((label, i) => {
        const index = first + i; const y = 7 + i * spacing;
        put(content, y, `${state.field === index ? '>' : ' '} ${label}${spacing === 1 ? `: ${values[index]}` : ''}`, state.field === index ? colors.accent : colors.ink, contentWidth);
        if (spacing === 2) put(content + 2, y + 1, values[index], colors.muted, contentWidth - 2);
      });
      put(content, height - 7, `${state.field === 7 ? '>' : ' '} [ Speichern ]`, state.field === 7 ? colors.accent : colors.ink, contentWidth);
      put(content, height - 6, 'Enter: bearbeiten | Esc: zurueck', colors.muted, contentWidth);
    }
  } else {
    if (!project.config) put(content, 7, project.error, colors.error, contentWidth);
    else {
      const count = Math.max(1, Math.floor((height - 12) / 6));
      const first = Math.max(0, state.tool - count + 1);
      tools.slice(first, first + count).forEach((tool, i) => {
        const delay = Math.min(0.45, i * 0.07);
        const reveal = Math.max(0, Math.min(1, (state.progress - delay) / (1 - delay)));
        if (!reveal) return;
        const x = content; const w = contentWidth;
        const y = 7 + i * 6;
        const focused = state.pane === 'tools' && state.tool === first + i;
        const status = tool.error ? '[ ! ]' : tool.enabled ? '[ ON ]' : '[OFF ]';
        const border = tool.error ? colors.error : focused ? colors.accent : colors.muted;
        box(x, y, w, 5, focused ? '> TOOL' : 'TOOL', border, reveal);
        if (reveal < 1) return;
        const switchX = x + w - status.length - 2;
        put(x + 2, y + 1, tool.name, focused ? colors.accent : colors.ink, Math.max(0, switchX - x - 3), focused);
        put(switchX, y + 1, status, tool.error ? colors.error : tool.enabled ? colors.on : colors.muted, status.length, true);
        put(x + 2, y + 2, `${tool.method} ${tool.path}`, colors.ink, w - 4);
        put(x + 2, y + 3, tool.error ?? tool.description ?? 'API-Aktion', tool.error ? colors.error : colors.ink, w - 4);
      });
      if (!tools.length) put(content, 7, 'Keine Tools. [s] Einstellungen', colors.muted, contentWidth);
      put(content, height - 6, `${tools.filter(t => t.enabled).length}/${tools.length} aktiv | ${tools.length ? state.tool + 1 : 0}/${tools.length} | Space: an/aus`, colors.muted, contentWidth);
    }
  }
  if (state.editor) {
    put(content, height - 9, `EINGABE: ${settingFields[state.editor.field]}`, colors.accent, contentWidth);
    put(content, height - 8, `${state.editor.value.slice(-Math.max(1, contentWidth - 1))}_`, colors.ink, contentWidth);
    put(content, height - 7, 'Enter: uebernehmen | Esc: abbrechen', colors.muted, contentWidth);
  }
  put(2, height - 3, state.busy ? 'Speichere und validiere ...' : state.status, state.error ? colors.error : colors.muted);
  put(2, height - 2, width >= 90 ? '[Enter] Tools  [Space] an/aus  [s] Settings  [r] Reload  [n] Neu  [?] Hilfe  [q] Ende' : '[Tab] Spalte [Enter] Tools [Space] an/aus [n] Neu [s] [?] [q]', colors.accent);
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
    if (state.mode !== 'browse') state.progress = 1;
    if (!screen || screen.width !== term.width || screen.height !== term.height) screen = new terminalKit.ScreenBuffer({ dst: term, width: term.width, height: term.height });
    screen.fill({ attr: { color: 'default', bgColor: 'default' } });
    for (const line of frameLines(state, term.width, term.height)) screen.put({ x: line.x, y: line.y, attr: { color: line.color ?? 'default', bgColor: 'default', bold: Boolean(line.bold) }, wrap: false, markup: false }, line.text);
    screen.draw({ delta: true });
    if (!timer && state.motion && state.mode === 'browse' && state.progress < 1) {
      timer = setTimeout(() => { timer = undefined; if (advanceBuild(state)) render(); }, 45);
    }
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
      await save(async () => { state.projects = await readProjects(resolve(directory), configs); state.rows = sourceRows(state.projects); state.row = Math.min(state.row, Math.max(0, state.rows.length - 1)); transition(); state.progress = 1; state.status = 'Projektkonfigurationen neu geladen.'; }); return;
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
    if (state.mode === 'help') {
      if (name === 'DOWN' || name === 'j') state.helpRow = (state.helpRow ?? 0) + 1;
      if (name === 'UP' || name === 'k') state.helpRow = Math.max(0, (state.helpRow ?? 0) - 1);
      render(); return;
    }
    if (name === 'TAB' || name === 'SHIFT_TAB') state.pane = state.pane === 'mcps' ? 'tools' : 'mcps';
    if (name === 'LEFT') { state.pane = 'mcps'; state.status = 'Pfeile / Mausrad waehlen eine Quelle. [n] legt ein neues Projekt an.'; }
    if (name === 'RIGHT' || name === 'ENTER') openToolPane(state);
    if (name === 'UP' || name === 'k' || name === 'DOWN' || name === 'j') {
      moveSelection(state, name === 'UP' || name === 'k' ? -1 : 1);
    }
    if (name === ' ' && state.pane === 'tools' && tools[state.tool]) await save(async () => {
      state.projects[row.projectIndex] = await toggleTool(project, row.sourceId, tools[state.tool].operation);
      state.status = `${tools[state.tool].name} ${tools[state.tool].enabled ? 'ausgeschaltet' : 'eingeschaltet'} und gespeichert. Client neu verbinden.`;
    });
    render();
  };
  const keyHandler = (...args) => { onKey(...args).catch(error => { safeError(error); render(); }); };
  const mouseHandler = (name, data) => { if (!stopped && listMouse(state, name, data, term.width, term.height)) render(); };
  const onSignal = () => stop();
  const onEnd = () => stop();
  try {
    term.alternateScreenBuffer(true); term.hideCursor(); term.grabInput({ mouse: 'button' });
    term.on('key', keyHandler); term.on('mouse', mouseHandler); term.on('resize', render);
    process.once('SIGTERM', onSignal); process.stdin.once('end', onEnd);
    render();
    return await result;
  } finally {
    stopped = true; clearTimeout(timer); term.removeListener('key', keyHandler); term.removeListener('mouse', mouseHandler); term.removeListener('resize', render);
    process.removeListener('SIGTERM', onSignal); process.stdin.removeListener('end', onEnd);
    term.grabInput(false); term.styleReset(); term.hideCursor(false); term.alternateScreenBuffer(false);
  }
}
