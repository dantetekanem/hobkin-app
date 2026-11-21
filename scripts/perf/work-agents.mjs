// Work agents whose Pi session files grow, as Pi appends each assistant message, with the scheduler ticking every second, on a home
// the size of today's. Prints the runtime's share of a core and its whole rebuilds a second.
// Usage: node scripts/perf/work-agents.mjs [agents 8] [seconds 30] [append every ms 3000]   (spec 052 A14: no rebuild for tokens alone)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { makeHome, openApp, scratch } from './home.mjs';

const [agents = 8, seconds = 30, every = 3000] = process.argv.slice(2).map(Number);
const base = scratch('work-agents', seconds + 120);
const home = await makeHome(base, { quietRoutines: true });
let published = 0, rebuilds = 0;
const app = await openApp(home.root, { intervalMs: 1000, onChange: () => { published++; } });
const project = app.project.bind(app);
app.project = (...rest) => { rebuilds++; return project(...rest); };
await wait(6000);
mkdirSync(join(home.root, 'jobs'), { recursive: true });
// Entries as the director keeps its own runs (`start` in work/director.mjs), so its meter follows their session files.
const files = [];
for (let i = 0; i < agents; i++) {
  const harnessId = randomUUID();
  const sessionFile = join(home.root, 'jobs', `${harnessId}.jsonl`);
  const slug = home.slugs[i % home.slugs.length];
  writeFileSync(sessionFile, '');
  files.push(sessionFile);
  app.director.active.set(`bench:${i}`, {
    id: `work:${slug}:do:${harnessId}`, harnessId, kind: 'do', lane: 'do', slug, item: 'abc123', planKey: `item:${slug}:abc123`, title: `Bench ${i}`,
    level: 'important', estimate: { fresh: 100000 }, sessionFile, tokens: 0, cached: 0, harness: 'pi', startedAt: new Date().toISOString(),
  });
}
// Spread over the interval, as agents that started apart write apart.
const line = `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { input: 1200, output: 300, cacheRead: 40000, cacheWrite: 100 }, content: [{ type: 'text', text: 'working' }] } })}\n`;
const timers = files.map((file, i) => setTimeout(() => {
  timers.push(setInterval(() => appendFileSync(file, line), every));
}, Math.floor((every / files.length) * i)));
await wait(2000);
const before = { cpu: process.cpuUsage(), published, rebuilds, at: performance.now() };
await wait(seconds * 1000);
const cpu = process.cpuUsage(before.cpu);
const elapsed = (performance.now() - before.at) / 1000;
for (const timer of timers) clearInterval(timer);
const tokens = app.snapshot.work?.running?.reduce((sum, run) => sum + (run.tokens ?? 0), 0) ?? null;
app.director.active.clear();
console.log(JSON.stringify({
  agents, appendEveryMs: every, seconds: +elapsed.toFixed(1),
  cpuPercentOfCore: +((cpu.user + cpu.system) / 1000 / elapsed / 10).toFixed(1),
  publishesPerSecond: +((published - before.published) / elapsed).toFixed(1),
  rebuildsPerSecond: +((rebuilds - before.rebuilds) / elapsed).toFixed(2),
  tokensShown: tokens,
}));
await app.close();
process.exit(0);
