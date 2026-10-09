import { setTimeout as pause } from 'node:timers/promises';

export const animated = () => Boolean(process.stderr.isTTY && !process.env.OPEN_MCP_NO_ANIMATION && !process.env.CI && process.env.TERM !== 'dumb');
const frames = ['[>    ]', '[=>   ]', '[==>  ]', '[===> ]', '[====>]', '[=====]'];
export async function ribbon(stage) {
  if (!animated()) return;
  for (const frame of frames) {
    process.stderr.write(`\r  ${frame} ${stage.padEnd(32)} API ---> tools ---> MCP`);
    await pause(35);
  }
  process.stderr.write('\n');
}
export function banner() {
  if (!animated()) return;
  process.stderr.write('\n  +-----------------------------------------+\n  |  O P E N   M C P  /  working title      |\n  |  { API } ==>[ tools ]==>[ your client ] |\n  +-----------------------------------------+\n\n');
}
export async function busy(label, action) {
  if (!animated()) return action();
  let i = 0;
  const spinner = setInterval(() => process.stderr.write(`\r  ${['|', '/', '-', '\\'][i++ % 4]} ${label} ${frames[i % frames.length]}   `), 80);
  let passed = false;
  try { const result = await action(); passed = true; return result; }
  finally { clearInterval(spinner); process.stderr.write(`\r  [${passed ? 'done' : 'failed'}] ${label}                         \n`); }
}
