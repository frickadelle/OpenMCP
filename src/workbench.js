import terminalKit from 'terminal-kit';
import { resolve } from 'node:path';
import { readProjects, sourceRows, toolsFor, toggleTool, updateSettings } from './workbench-store.js';
import { assert, redact, UserError } from './errors.js';
import { inspectHosts, connectHost } from './hosts.js';
import { diagnose } from './client.js';
import { compileProject } from './importer.js';

const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
const colors = { ink: 'default', muted: 'gray', accent: 'cyan', on: 'green', error: 'red' };
const settingFields = ['API URL', 'Auth type', 'Environment variable', 'API-key location', 'API-key name', 'Timeout (ms)', 'Animations (session)', 'Save'];
const menuRows = projects => [...sourceRows(projects),
  { action: 'create', title: 'New MCP', detail: 'Connect your API' },
  { action: 'demo', title: 'Try local demo', detail: 'Set up sample API' }
];
export function formFor(project, sourceId, motion) {
  const source = project.config.sources.find(s => s.id === sourceId);
  return { baseUrl: source.baseUrl, auth: { ...source.auth }, timeoutMs: project.config.timeoutMs ?? 10000, motion };
}
export function createViewState(projects, motion = true) {
  return { projects, rows: menuRows(projects), row: 0, tool: 0, pane: 'mcps', mode: 'browse', motion,
    progress: 1, status: sourceRows(projects).length === 1 ? 'One API source. Use Down for New MCP or Try local demo.' : 'Up/Down: choose a project or setup action. Enter: open.', busy: false, field: 0, quit: undefined };
}
export function openToolPane(state) {
  if (state.rows[state.row]?.action) return;
  if (state.pane === 'tools') return;
  state.pane = 'tools';
  state.status = 'Up/Down: choose a tool. Space: toggle. Left: back to MCPs.';
}
export function selectMcp(state, index) {
  const next = Math.max(0, Math.min(state.rows.length - 1, index));
  if (!state.rows.length || next === state.row) return false;
  state.buildStarted = undefined; state.row = next; state.tool = 0; state.progress = state.motion && !state.rows[next].action ? 0 : 1;
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
  if (state.busy || state.mode !== 'browse' || state.editor || state.quit || width < 64 || height < 18) return false;
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
export function advanceBuild(state, now = performance.now()) {
  if (!state.motion || state.quit || state.mode !== 'browse' || state.progress >= 1) return false;
  state.buildStarted ??= now - state.progress * 360;
  state.progress = Math.min(1, Math.max(state.progress, (now - state.buildStarted) / 360));
  return true;
}
const active = state => {
  const row = state.rows[state.row]; const project = row && state.projects[row.projectIndex];
  return { row, project, tools: project && row?.sourceId ? toolsFor(project, row.sourceId) : [] };
};
export function quitKey(state, name) {
  if (!state.quit) {
    if (!['q', 'Q'].includes(name)) return false;
    state.quit = { confirm: false };
  } else if (['ESCAPE', 'n', 'N', 'q', 'Q'].includes(name)) state.quit = undefined;
  else if (['TAB', 'SHIFT_TAB', 'LEFT', 'RIGHT', 'UP', 'DOWN'].includes(name)) state.quit.confirm = !state.quit.confirm;
  else if (['y', 'Y'].includes(name)) return 'exit';
  else if (name === 'ENTER') {
    if (state.quit.confirm) return 'exit';
    state.quit = undefined;
  }
  return true;
}
function quitOverlay(lines, state, width, height) {
  if (!state.quit) return lines;
  const w = Math.min(48, width - 2); const h = Math.min(8, height);
  if (w < 8 || h < 6) return [{ x: 0, y: 0, text: 'Quit? y/n'.slice(0, width) }];
  const x = Math.floor((width - w) / 2); const y = Math.floor((height - h) / 2);
  // Clear the covered region without splitting an underlying ASCII frame.
  const visible = lines.filter(l => l.y < y || l.y >= y + h || l.x + l.text.length <= x || l.x >= x + w);
  const rows = Array.from({ length: h }, () => `|${' '.repeat(w - 2)}|`);
  rows[0] = `+${'-'.repeat(w - 2)}+`; rows[h - 1] = rows[0];
  const text = (row, value) => { rows[row] = `| ${value.slice(0, w - 4).padEnd(w - 4)} |`; };
  text(1, 'Do you really want to quit?');
  text(2, 'Saved changes will be kept.');
  text(h - 3, state.quit.confirm ? '  [ Cancel ]     > [ Quit ]' : '> [ Cancel ]       [ Quit ]');
  text(h - 2, 'Tab: choose  Enter: confirm  Esc: cancel');
  return [...visible, ...rows.map((text, i) => ({ x, y: y + i, text, color: colors.accent }))];
}
export function frameLines(state, width, height) {
  const { row, project, tools } = active(state);
  if (width < 64 || height < 18) return quitOverlay([
    { x: 2, y: 2, text: 'OPEN MCP', color: 'cyan' },
    { x: 2, y: 4, text: 'Resize your terminal to at least 64 x 18.' },
    { x: 2, y: 6, text: 'q: quit dialog / Ctrl+C: exit' }
  ], state, width, height);
  const left = Math.min(32, Math.floor(width * 0.3)); const right = left + 2;
  const lines = [];
  const put = (x, y, text, color = colors.ink, max = width - x - 1, bold = false) => {
    if (y >= 0 && y < height && max > 0) lines.push({ x, y, text: clean(text).slice(0, max), color, bold });
  };
  const box = (x, y, w, h, label = '', color = colors.muted, reveal = 1) => {
    const caption = label ? ` ${clean(label).slice(0, w - 6)} ` : '';
    const top = `+${caption}${'-'.repeat(w - caption.length - 2)}+`;
    const perimeter = 2 * w + 2 * (h - 2);
    let remaining = Math.ceil(perimeter * reveal);
    put(x, y, top.slice(0, Math.min(w, remaining)), color, w);
    remaining -= w;
    for (let dy = 1; dy < h - 1 && remaining-- > 0; dy++) put(x + w - 1, y + dy, '|', color, 1);
    if (remaining > 0) {
      const length = Math.min(w, remaining);
      put(x + w - length, y + h - 1, `+${'-'.repeat(w - 2)}+`.slice(w - length), color, length);
    }
    remaining -= w;
    for (let dy = h - 2; dy > 0 && remaining-- > 0; dy--) put(x, y + dy, '|', color, 1);
  };
  const panelWidth = width - right - 2;
  const content = right + 2;
  const contentWidth = panelWidth - 4;
  put(2, 1, 'OPEN MCP', colors.accent, width - 4, true);
  put(12, 1, '/ API actions as MCP tools', colors.muted);
  if (row) put(2, 3, row.title, colors.accent, left - 3, true);
  box(2, 5, left - 2, height - 9, 'YOUR MCPs', state.pane === 'mcps' ? colors.accent : colors.muted);
  const visibleRows = Math.max(1, Math.floor((height - 12) / 3)); const firstRow = Math.max(0, state.row - visibleRows + 1);
  state.rows.slice(firstRow, firstRow + visibleRows).forEach((item, i) => {
    const selected = firstRow + i === state.row;
    put(4, 7 + i * 3, `${selected ? '>' : ' '} ${item.projectName ?? item.title}`, selected ? colors.accent : colors.ink, left - 6, selected);
    put(6, 8 + i * 3, item.sourceId ? `API: ${item.sourceId}` : item.detail ?? '', colors.muted, left - 8);
  });
  put(4, height - 6, `${state.rows.length ? state.row + 1 : 0}/${state.rows.length} | n: new`, colors.muted, left - 6);
  const label = state.mode === 'connect' ? 'CONNECT' : state.mode === 'settings' ? 'SETTINGS' : state.mode === 'help' ? 'HELP' : 'TOOLCALLS';
  box(right, 5, panelWidth, height - 9, label, state.pane === 'tools' || state.mode !== 'browse' ? colors.accent : colors.muted);
  if (state.mode === 'connect') {
    const hosts = state.hosts ?? [];
    const count = Math.max(1, Math.floor((height - 12) / 3));
    const first = Math.max(0, (state.host ?? 0) - count + 1);
    hosts.slice(first, first + count).forEach((host, i) => {
      put(content, 7 + i * 3, `${state.host === first + i ? '>' : ' '} ${host.name}`, state.host === first + i ? colors.accent : colors.ink, contentWidth);
      put(content + 2, 8 + i * 3, host.status, host.error ? colors.error : colors.muted, contentWidth - 2);
    });
    put(content, height - 6, 'Enter: configure | t: test server | Esc: back', colors.muted, contentWidth);
  } else if (state.mode === 'help') {
    const help = ['A tool call is an API action.', 'Up/Down / j,k: move selection', 'Enter / Right: open tools or setup', 'Tab: switch pane. Left: MCP list',
      'Space: toggle and save', 's: Settings   c: Connect   r: reload', 'n: New MCP  d: demo  q: quit dialog', 'Esc: back / cancel',
      'Browsing never calls the API.', 'Reconnect clients after changes.'];
    const first = Math.max(0, Math.min(state.helpRow ?? 0, Math.max(0, help.length - (height - 13))));
    help.slice(first, first + height - 13).forEach((line, i) => put(content, 7 + i, line, colors.ink, contentWidth));
    put(content, height - 6, 'Up/Down: scroll | Esc: back', colors.muted, contentWidth);
  } else if (state.mode === 'settings' && state.form) {
    const values = [state.form.baseUrl, state.form.auth.type, state.form.auth.env ?? '(not required)',
      state.form.auth.in ?? 'header', state.form.auth.name ?? 'X-API-Key', state.form.timeoutMs, state.form.motion ? 'ON' : 'OFF'];
    if (!state.editor) {
      const spacing = height >= 28 ? 2 : 1;
      const count = Math.min(7, Math.floor((height - 14) / spacing));
      const first = Math.max(0, Math.min(state.field, 6) - count + 1);
      settingFields.slice(first, first + count).forEach((label, i) => {
        const index = first + i; const y = 7 + i * spacing;
        put(content, y, `${state.field === index ? '>' : ' '} ${label}${spacing === 1 ? `: ${values[index]}` : ''}`, state.field === index ? colors.accent : colors.ink, contentWidth);
        if (spacing === 2) put(content + 2, y + 1, values[index], colors.muted, contentWidth - 2);
      });
      put(content, height - 7, `${state.field === 7 ? '>' : ' '} [ Save ]`, state.field === 7 ? colors.accent : colors.ink, contentWidth);
      put(content, height - 6, 'Enter: edit | Esc: back', colors.muted, contentWidth);
    }
  } else if (row?.action) {
    put(content, 7, row.title, colors.accent, contentWidth);
    put(content, 9, row.action === 'demo' ? 'Create a project for the sample Notes API.' : 'Connect an API using an OpenAPI file or a GET endpoint.', colors.ink, contentWidth);
    put(content, 11, 'Enter: start setup. You choose which tools to enable.', colors.ink, contentWidth);
    if (height >= 22) put(content, 13, 'No API calls are made during setup.', colors.muted, contentWidth);
  } else {
    if (!project.config) put(content, 7, project.error, colors.error, contentWidth);
    else {
      const count = Math.max(1, Math.floor((height - 12) / 6));
      const first = Math.max(0, state.tool - count + 1);
      tools.slice(first, first + count).forEach((tool, i) => {
        const delay = Math.min(0.2, i * 0.04);
        const phase = Math.max(0, Math.min(1, (state.progress - delay) / (1 - delay)));
        const reveal = 1 - (1 - phase) ** 3;
        if (!reveal) return;
        const x = content; const w = contentWidth;
        const y = 7 + i * 6;
        const focused = state.pane === 'tools' && state.tool === first + i;
        const status = tool.error ? '[ ! ]' : tool.enabled ? '[ ON ]' : '[OFF ]';
        const border = tool.error ? colors.error : focused ? colors.accent : colors.muted;
        box(x, y, w, 5, focused ? '> TOOL' : 'TOOL', border, reveal);
        const contentReveal = Math.max(0, Math.min(1, (phase - 0.4) / 0.6));
        const revealText = (x, y, text, color, max, bold = false) => put(x, y, String(text).slice(0, Math.ceil(String(text).length * contentReveal)), color, max, bold);
        const switchX = x + w - status.length - 2;
        revealText(x + 2, y + 1, tool.name, focused ? colors.accent : colors.ink, Math.max(0, switchX - x - 3), focused);
        revealText(switchX, y + 1, status, tool.error ? colors.error : tool.enabled ? colors.on : colors.muted, status.length, true);
        revealText(x + 2, y + 2, `${tool.method} ${tool.path}`, colors.ink, w - 4);
        revealText(x + 2, y + 3, tool.error ?? tool.description ?? 'API action', tool.error ? colors.error : colors.ink, w - 4);
      });
      if (!tools.length) put(content, 7, 'No tools. [s] Settings', colors.muted, contentWidth);
      put(content, height - 6, `${tools.filter(t => t.enabled).length}/${tools.length} enabled | ${tools.length ? state.tool + 1 : 0}/${tools.length} | Space: toggle`, colors.muted, contentWidth);
    }
  }
  if (state.editor) {
    put(content, height - 9, `INPUT: ${settingFields[state.editor.field]}`, colors.accent, contentWidth);
    put(content, height - 8, `${state.editor.value.slice(-Math.max(1, contentWidth - 1))}_`, colors.ink, contentWidth);
    put(content, height - 7, 'Enter: apply | Esc: cancel', colors.muted, contentWidth);
  }
  put(2, height - 3, state.busy ? 'Working ...' : state.status, state.error ? colors.error : colors.muted);
  const shortcuts = state.mode === 'connect' ? '[Up/Down] Host [Enter] Set up [t] Test [Esc] Back [q] Quit' :
    width >= 90 ? '[Enter] Open [Space] Toggle [c] Connect [s] Settings [r] Reload [n] New [d] Demo [?] [q] Quit' : '[Tab] Pane [Enter] Open [Space] Toggle [c] Connect [s] [?] [q]';
  put(2, height - 2, shortcuts, colors.accent);
  return quitOverlay(lines, state, width, height);
}
export async function runWorkbench({ directory = process.cwd(), configs = [], env = process.env } = {}) {
  assert(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb', 'openmcp requires an interactive terminal. Use --help for CLI commands.');
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
    if (!timer && !state.quit && state.motion && state.mode === 'browse' && state.progress < 1) {
      state.buildStarted ??= performance.now() - state.progress * 360;
      timer = setTimeout(() => { timer = undefined; if (advanceBuild(state)) render(); }, 16);
    }
  };
  const transition = () => { state.buildStarted = undefined; state.progress = state.motion ? 0 : 1; state.tool = 0; state.mode = 'browse'; state.form = undefined; };
  const stop = action => { if (stopped) return; stopped = true; finish(action); };
  const safeError = error => {
    const secrets = state.projects.flatMap(p => p.config?.sources.filter(s => s.auth.type !== 'none').map(s => env[s.auth.env]) ?? []);
    state.status = redact(error instanceof UserError ? error.message : 'Action failed. Run validate or press r to reload.', secrets); state.error = true;
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
    if (state.quit) {
      if (quitKey(state, name) === 'exit') stop(); else render();
      return;
    }
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
    if (quitKey(state, name)) { render(); return; }
    if (name === 'n') { stop({ action: 'create', directory: resolve(directory) }); return; }
    if (name === 'd') { stop({ action: 'demo', directory: resolve(directory) }); return; }
    if (name === '?') { state.mode = state.mode === 'help' ? 'browse' : 'help'; render(); return; }
    if (name === 'r') {
      await save(async () => { state.projects = await readProjects(resolve(directory), configs); state.rows = menuRows(state.projects); state.row = Math.min(state.row, Math.max(0, state.rows.length - 1)); transition(); state.progress = 1; state.status = 'Project configurations reloaded.'; }); return;
    }
    if (name === 'ESCAPE') { state.mode = 'browse'; state.pane = 'mcps'; state.editor = undefined; render(); return; }
    if (name === 'c' && project?.config) {
      await save(async () => {
        state.hosts = await inspectHosts(project.path, project.config, { env }); state.host = 0; state.mode = 'connect';
        state.status = 'Choose a host and press Enter to configure it. Existing settings are kept.';
      }); return;
    }
    if (state.mode === 'connect') {
      if (name === 'UP' || name === 'k') state.host = Math.max(0, state.host - 1);
      if (name === 'DOWN' || name === 'j') state.host = Math.min(state.hosts.length - 1, state.host + 1);
      if (name === 'ENTER') await save(async () => {
        const host = state.hosts[state.host]; await connectHost(host, project.path);
        state.hosts = await inspectHosts(project.path, project.config, { env });
        const envs = [...new Set(project.config.sources.filter(s => s.auth.type !== 'none').map(s => s.auth.env))];
        state.status = `Configured for ${host.name}. Restart the host to load tools.${envs.length ? ` Host env: ${envs.join(', ')}.` : ''}`;
      });
      else if (name === 't') await save(async () => {
        const { selected } = await compileProject(project.config, project.directory);
        const result = await diagnose(project.config, project.path, selected, { env });
        state.status = `Local server tested: ${result.tools.length} tools listed. Host-session connection is not probed.`;
      });
      render(); return;
    }
    if (name === 's' && project?.config) {
      if (state.mode === 'settings') state.mode = 'browse';
      else { state.mode = 'settings'; state.form = formFor(project, row.sourceId, state.motion); state.field = 0; state.status = 'Enter: edit. Choose Save to persist changes.'; }
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
          state.mode = 'browse'; state.status = 'Settings saved. Reconnect your client.';
        });
        else if ([0, 2, 4, 5].includes(state.field)) {
          if ((state.field === 2 && state.form.auth.type === 'none') || (state.field === 4 && state.form.auth.type !== 'apiKey')) state.status = 'This field is not needed for the selected auth type.';
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
    if (name === 'LEFT') { state.pane = 'mcps'; state.status = 'Up/Down or mouse wheel: choose an MCP. Enter: open.'; }
    if (name === 'RIGHT' || name === 'ENTER') {
      if (state.pane === 'mcps' && row?.action) { stop({ action: row.action, directory: resolve(directory) }); return; }
      openToolPane(state);
    }
    if (name === 'UP' || name === 'k' || name === 'DOWN' || name === 'j') {
      moveSelection(state, name === 'UP' || name === 'k' ? -1 : 1);
    }
    if (name === ' ' && state.pane === 'tools' && tools[state.tool]) await save(async () => {
      state.projects[row.projectIndex] = await toggleTool(project, row.sourceId, tools[state.tool].operation);
      state.status = `${tools[state.tool].name} ${tools[state.tool].enabled ? 'disabled' : 'enabled'} and saved. Reconnect your client.`;
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
