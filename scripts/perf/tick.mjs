// The scheduler's idle tick on a home the size of today's, with nothing running: CPU and whole-file reads per tick.
// Usage: node scripts/perf/tick.mjs [--ticks 40] [--project] [--work-off] [--learning] [--files]
//   --project  times one whole rebuild (`project()`) instead of a tick
//   --files    also lists the files read in the measured ticks
// Spec 052 A15 asks for 4.9 ms of CPU per idle tick or less, and no read of a file that did not change.
import { setTimeout as wait } from 'node:timers/promises';
import { countReads, makeHome, median, openApp, scratch } from './home.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const ticks = Number(args[args.indexOf('--ticks') + 1]) || (flag('--project') ? 10 : 40);
const base = scratch('tick', 170);
const reads = await countReads();
const home = await makeHome(base, { workOn: !flag('--work-off'), learning: flag('--learning') });
const app = await openApp(home.root);

const settle = async () => {
  for (let i = 0; i < 200; i++) {
    await wait(30);
    if (app.refreshing) await app.refreshing.catch(() => {});
    const { director } = app;
    if (!app.refreshTimer && !app.refreshing && app.runner.jobs.size === 0 && !director.surveying && !director.settlingMerges && !director.watching && !director.pickingUp) return;
  }
};
// Routines due today run once with the fake harness, the folder survey runs, and every cache fills.
let quiet = 0;
for (let i = 0; i < 80 && quiet < 3; i++) {
  const before = Object.keys((await app.runtime.runIndex()).runs).length;
  await app.runner.tick();
  await settle();
  quiet = Object.keys((await app.runtime.runIndex()).runs).length === before ? quiet + 1 : 0;
}
await wait(200);
await settle();

let rebuilds = 0;
const project = app.project.bind(app);
app.project = (...rest) => { rebuilds++; return project(...rest); };
const times = [];
const cpu0 = process.cpuUsage();
reads.on = true;
for (let i = 0; i < ticks; i++) {
  const started = performance.now();
  if (flag('--project')) await project();
  else await app.runner.tick();
  times.push(performance.now() - started);
  // Only the tick's own work counts: what it asks for afterwards is a rebuild, counted apart.
  reads.on = false;
  await settle();
  reads.on = true;
}
reads.on = false;
const cpu = process.cpuUsage(cpu0);
const out = {
  measured: flag('--project') ? 'project()' : 'idle tick',
  ticks,
  workOn: !flag('--work-off'),
  learning: flag('--learning'),
  docMB: +(home.docBytes / 1e6).toFixed(2),
  cpuMsEach: +((cpu.user + cpu.system) / 1000 / ticks).toFixed(2),
  wallMsMedian: +median(times).toFixed(2),
  readsEach: +(reads.reads / ticks).toFixed(1),
  readKBEach: +(reads.bytes / 1024 / ticks).toFixed(1),
  rebuildsAsked: flag('--project') ? null : rebuilds,
};
if (flag('--files')) out.files = Object.fromEntries([...reads.files].sort((a, b) => b[1] - a[1]).map(([file, n]) => [file, +(n / ticks).toFixed(2)]));
console.log(JSON.stringify(out, null, flag('--files') ? 2 : 0));
await app.close();
process.exit(0);
