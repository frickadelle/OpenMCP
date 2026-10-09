import { setTimeout as pause } from 'node:timers/promises';

export const animated = () => Boolean(process.stderr.isTTY && !process.env.OPEN_MCP_NO_ANIMATION && !process.env.CI && process.env.TERM !== 'dumb');
const frames = ['[>    ]', '[=>   ]', '[==>  ]', '[===> ]', '[====>]', '[=====]'];
const steps = ['API importieren', 'Tools auswaehlen', 'Zugang einstellen', 'Lokal starten', 'Client verbinden'];
const scenes = {
  import: [
    '  +----------------+       +-------------------+',
    '  | API-Bauplan    |  ===> | Open MCP liest:    |',
    '  | openapi.yaml   |       | GET  /notes/{id}   |',
    '  | oder REST      |       | POST /notes       |',
    '  +----------------+       +-------------------+'
  ],
  tools: [
    '  API kann viel. Du gibst einzelne Tools frei.',
    '  +--------------------+     +------------------+',
    '  | [x] Notiz lesen    | ==> | demo_getNote     |',
    '  | [x] Notiz anlegen  | ==> | demo_createNote  |',
    '  | [ ] Notizen listen | -X- | bleibt verborgen |',
    '  +--------------------+     +------------------+'
  ],
  auth: [
    '  +--------------------+     +------------------+',
    '  | Deine Umgebung     | ==> | API-Anfrage      |',
    '  | MY_API_TOKEN=***** |     | mit Zugang       |',
    '  +--------------------+     +------------------+',
    '            |                         ^',
    '            +--- Konfig speichert ----+',
    '                 nur den Variablennamen'
  ],
  local: [
    '  +----------------+      +-------------------+',
    '  | Deine Konfig   | ==> | Lokaler MCP-Server |',
    '  | open-mcp.yaml  |     | prueft Eingaben    |',
    '  +----------------+     | ruft deine API auf |',
    '                         +-------------------+',
    '  Kein Cloud-Konto. Kein LLM-API-Key.'
  ],
  client: [
    '  +----------+    +-----------+    +----------+',
    '  | Client   | -> | Open MCP  | -> | Deine API|',
    '  | ruft Tool|    | uebersetzt|    | antwortet|',
    '  +----------+    +-----------+    +----------+',
    '       ^                                |',
    '       +---------- Ergebnis ------------+'
  ]
};
export function explain(title, lines = []) {
  process.stderr.write(`\n  ${title}\n  ${'-'.repeat(Math.min(title.length, 60))}\n`);
  for (const line of lines) process.stderr.write(`  ${line}\n`);
  process.stderr.write('\n');
}
export async function chapter(index, title, lines, scene) {
  explain(`Schritt ${index}/5: ${title}`, lines);
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
  explain(`${tools.length} Tools bewusst freigegeben`, ['Nur diese Namen sieht dein MCP-Client:']);
  for (const tool of tools) {
    process.stderr.write(`  [x] ${tool.name}\n      ${tool.operation}\n`);
    if (animated()) await pause(85);
  }
  if (!tools.length) process.stderr.write('  Noch keine. Mit "tools --choose" kannst du sie spaeter auswaehlen.\n');
}
export async function banner() {
  const lines = [
    '  +--------------------------------------------------+',
    '  |   O P E N   M C P  /  working title               |',
    '  |   Deine HTTP-API wird zu Tools fuer einen Client. |',
    '  +--------------------------------------------------+'
  ];
  if (!process.stderr.isTTY) return;
  for (const line of lines) { process.stderr.write(`${line}\n`); if (animated()) await pause(65); }
  explain('Was du hier baust', [
    'Ein Tool ist eine Aktion, z.B. "Notiz lesen".',
    'Open MCP verbindet diese Aktion mit deiner HTTP-API.',
    'Du waehlst die erlaubten Aktionen. Eine Konfig speichert deine Auswahl.',
    'Tastatur: Pfeile = navigieren, Leertaste = markieren, Enter = weiter.',
    'Abbrechen: Ctrl+C. Animationen aus: OPEN_MCP_NO_ANIMATION=1.'
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
