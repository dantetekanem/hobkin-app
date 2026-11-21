// The main chat streaming a reply with tools, through the real `connectMain` subscriber, with the scheduler ticking every second
// as the live app does, on a home the size of today's. Prints the runtime's share of a core and its whole rebuilds a second.
// Usage: node scripts/perf/main-chat.mjs <tool steps/s> <words/s> <seconds>   (spec 052 A13: 2 20 30, 3.2% of a core or less)
import { setTimeout as wait } from 'node:timers/promises';
import { makeHome, openApp, scratch } from './home.mjs';

const [steps = 2, words = 20, seconds = 30] = process.argv.slice(2).map(Number);
const base = scratch('main-chat', seconds + 120);
const home = await makeHome(base);
// Each event goes where the main chat's own listener sends it (`connectMain` in runtime.mjs).
const listeners = new Set();
let published = 0, rebuilds = 0;
const app = await openApp(home.root, {
  intervalMs: 1000,
  onChange: () => { published++; },
  createSession: made => {
    const subscribe = made.session.subscribe.bind(made.session);
    made.session.subscribe = listener => {
      listeners.add(listener);
      const off = subscribe(listener);
      return () => { listeners.delete(listener); off(); };
    };
    return made;
  },
});
const project = app.project.bind(app);
app.project = (...rest) => { rebuilds++; return project(...rest); };
await wait(4000);
if (!listeners.size) throw Error('The main chat listener was not reached.');

const emit = event => { for (const listener of listeners) listener(event); };
// A tool step is one event of a turn's cycle: the reply's start and end, the tool's start and end, the turn's start and end.
const cycle = ['message_start', 'message_end', 'tool_execution_start', 'tool_execution_end', 'turn_start', 'turn_end'];
let k = 0, text = '';
const timers = [];
if (steps > 0) timers.push(setInterval(() => {
  const type = cycle[k++ % cycle.length];
  const message = { role: 'assistant', content: [{ type: 'text', text }], timestamp: Date.now() };
  emit(type.startsWith('tool')
    ? { type, toolCallId: `c${Math.floor(k / 6)}`, toolName: 'bash', args: { command: 'ls' }, result: { content: [{ type: 'text', text: 'ok' }] } }
    : { type, message });
}, 1000 / steps));
if (words > 0) timers.push(setInterval(() => {
  const delta = 'some words of the reply ';
  text += delta;
  emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta }, message: { role: 'assistant' } });
}, 1000 / words));

const before = { cpu: process.cpuUsage(), published, rebuilds, at: performance.now() };
await wait(seconds * 1000);
const cpu = process.cpuUsage(before.cpu);
const elapsed = (performance.now() - before.at) / 1000;
for (const timer of timers) clearInterval(timer);
console.log(JSON.stringify({
  toolStepsPerSecond: steps, wordsPerSecond: words, seconds: +elapsed.toFixed(1), docMB: +(home.docBytes / 1e6).toFixed(2),
  cpuPercentOfCore: +((cpu.user + cpu.system) / 1000 / elapsed / 10).toFixed(1),
  publishesPerSecond: +((published - before.published) / elapsed).toFixed(1),
  rebuildsPerSecond: +((rebuilds - before.rebuilds) / elapsed).toFixed(2),
}));
await app.close();
process.exit(0);
