import { setTimeout as pause } from 'node:timers/promises';

export const animated = () => Boolean(process.stderr.isTTY && !process.env.OPEN_MCP_NO_ANIMATION && !process.env.CI && process.env.TERM !== 'dumb');
const frames = ['[>    ]', '[=>   ]', '[==>  ]', '[===> ]', '[====>]', '[=====]'];
const steps = ['Import API', 'Choose tools', 'Set up auth', 'Start locally', 'Connect client'];
const scenes = {
  import: [
    '  +----------------+       +-------------------+',
    '  | API spec       |  ===> | Open MCP reads:   |',
    '  | openapi.yaml   |       | GET  /notes/{id}  |',
    '  | or REST        |       | POST /notes       |',
    '  +----------------+       +-------------------+'
  ],
  tools: [
    '  Your API offers actions. Choose which to expose.',
    '  +--------------------+     +------------------+',
    '  | [x] Read note      | ==> | demo_getNote     |',
    '  | [x] Create note    | ==> | demo_createNote  |',
    '  | [ ] List notes     | -X- | stays hidden     |',
    '  +--------------------+     +------------------+'
  ],
  auth: [
    '  +--------------------+     +------------------+',
    '  | Your environment   | ==> | API request      |',
    '  | MY_API_TOKEN=***** |     | authenticated    |',
    '  +--------------------+     +------------------+',
    '            |                         ^',
    '            +--- config stores -------+',
    '                 only the variable name'
  ],
  local: [
    '  +----------------+      +-------------------+',
    '  | Your config    | ==> | Local MCP server  |',
    '  | open-mcp.yaml  |     | validates inputs  |',
    '  +----------------+     | calls your API    |',
    '                         +-------------------+',
    '  No cloud account. No LLM API key.'
  ],
  client: [
    '  +----------+    +-----------+    +----------+',
    '  | Client   | -> | Open MCP  | -> | Your API |',
    '  | calls    |    | maps      |    | responds |',
    '  +----------+    +-----------+    +----------+',
    '       ^                                |',
    '       +---------- result --------------+'
  ]
};
export function explain(title, lines = []) {
  process.stderr.write(`\n  ${title}\n  ${'-'.repeat(Math.min(title.length, 60))}\n`);
  for (const line of lines) process.stderr.write(`  ${line}\n`);
  process.stderr.write('\n');
}
export async function chapter(index, title, lines, scene) {
  explain(`Step ${index}/5: ${title}`, lines);
  if (process.stderr.isTTY) {
    process.stderr.write(`  ${steps.map((s, i) => `${i + 1 < index ? '[x]' : i + 1 === index ? '[>]' : '[ ]'} ${i + 1}`).join(' --- ')}\n\n`);
  }
  if (scene) await animateScene(scene);
}
export async function animateScene(kind) {
  const drawing = scenes[kind];
  if (!drawing) return;
  for (const line of drawing) process.stderr.write(`${line}\n`);
  if (!animated()) return;
  // Animate only a reserved line, before a prompt starts. Never redraw active input.
  const packets = kind === 'client' ? ['[Client] o----> [MCP] -----> [API]', '[Client] -----> [MCP] o----> [API]', '[Client] <----- [MCP] <---o [API]', '[Client] <---o- [MCP] <----- [API]'] :
    ['[ API ] o-------> [ Tool ] -------> [ Client ]', '[ API ] --o-----> [ Tool ] -------> [ Client ]', '[ API ] ----o---> [ Tool ] -------> [ Client ]', '[ API ] ------o-> [ Tool ] -------> [ Client ]', '[ API ] --------> [ Tool ] --o----> [ Client ]', '[ API ] --------> [ Tool ] ----o--> [ Client ]'];
  for (let cycle = 0; cycle < 2; cycle++) for (const packet of packets) {
    process.stderr.write(`\r\x1b[2K  ${packet}`);
    await pause(65);
  }
  process.stderr.write('\r\x1b[2K\n');
}
export async function ribbon(stage) {
  if (!animated()) return;
  for (const frame of frames) {
    process.stderr.write(`\r  ${frame} ${stage.padEnd(32)} API ---> tools ---> MCP`);
    await pause(55);
  }
  process.stderr.write('\n');
}
export async function revealTools(tools) {
  explain(`${tools.length} tools explicitly enabled`, ['Your MCP client sees only these names:']);
  for (const tool of tools) {
    process.stderr.write(`  [x] ${tool.name}\n      ${tool.operation}\n`);
    if (animated()) await pause(85);
  }
  if (!tools.length) process.stderr.write('  None yet. Use "tools --choose" to select them later.\n');
}
export async function banner() {
  const lines = [
    '  +--------------------------------------------------+',
    '  |   O P E N   M C P  /  working title               |',
    '  |   Your HTTP API becomes tools for an MCP client. |',
    '  +--------------------------------------------------+'
  ];
  if (!process.stderr.isTTY) return;
  for (const line of lines) { process.stderr.write(`${line}\n`); if (animated()) await pause(65); }
  explain('What you are building', [
    'A tool is an action, e.g. "Read a note".',
    'Open MCP connects that action to your HTTP API.',
    'You choose the allowed actions. A configuration stores your selection.',
    'Keyboard: arrows navigate, Space selects, Enter continues.',
    'Cancel: Ctrl+C. Disable animation: OPEN_MCP_NO_ANIMATION=1.'
  ]);
}
export async function busy(label, action) {
  if (!animated()) return action();
  let i = 0;
  const spinner = setInterval(() => process.stderr.write(`\r  ${['|', '/', '-', '\\'][i++ % 4]} ${label} ${frames[i % frames.length]}   `), 80);
  let passed = false;
  try { const result = await action(); passed = true; return result; }
  finally { clearInterval(spinner); process.stderr.write(`\r  [${passed ? 'done' : 'failed'}] ${label}                         \n`); }
}
