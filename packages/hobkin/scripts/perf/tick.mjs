// The scheduler's idle tick on a home the size of today's, with nothing running: CPU and whole-file reads per tick.
// Usage: node scripts/perf/tick.mjs [--ticks 40] [--project] [--work-off] [--learning] [--files]
//   --project  times one whole rebuild (`project()`) instead of a tick
//   --files    also lists the files read in the measured ticks
//   --profile <file>  writes a CPU profile of the measured ticks to <file>
// Spec 052 A15 asks for 4.9 ms of CPU per idle tick or less, and no read of a file that did not change.
import { writeFileSync } from 'node:fs';
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

// The minute floor asks for one rebuild a minute. Its CPU is counted apart, so a run that crosses a minute measures the same tick.
let rebuilds = 0, rebuildCpu = 0;
const project = app.project.bind(app);
app.project = async (...rest) => {
  rebuilds++;
  const started = process.cpuUsage();
  try {
    return await project(...rest);
  } finally {
    const used = process.cpuUsage(started);
    rebuildCpu += used.user + used.system;
  }
};
const times = [];
const profileTo = flag('--profile') ? args[args.indexOf('--profile') + 1] : null;
let session;
if (profileTo) {
  const { Session } = await import('node:inspector/promises');
  session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 200 });
  await session.post('Profiler.start');
}
const cpu0 = process.cpuUsage();
reads.on = true;
for (let i = 0; i < ticks; i++) {
  const started = performance.now();
  if (flag('--project')) await project();
  else await app.runner.tick();
  times.push(performance.now() - started);
  // What the tick started and did not wait for counts too, such as the director's look at the folder.
  await settle();
}
reads.on = false;
const cpu = process.cpuUsage(cpu0);
if (session) {
  writeFileSync(profileTo, JSON.stringify((await session.post('Profiler.stop')).profile));
  session.disconnect();
}
const out = {
  measured: flag('--project') ? 'project()' : 'idle tick',
  ticks,
  workOn: !flag('--work-off'),
  learning: flag('--learning'),
  docMB: +(home.docBytes / 1e6).toFixed(2),
  cpuMsEach: +((cpu.user + cpu.system - (flag('--project') ? 0 : rebuildCpu)) / 1000 / ticks).toFixed(2),
  wallMsMedian: +median(times).toFixed(2),
  readsEach: +(reads.reads / ticks).toFixed(1),
  readKBEach: +(reads.bytes / 1024 / ticks).toFixed(1),
  rebuildsAsked: flag('--project') ? null : rebuilds,
  rebuildCpuMs: flag('--project') ? null : +(rebuildCpu / 1000).toFixed(1),
};
if (flag('--files')) out.files = Object.fromEntries([...reads.files].sort((a, b) => b[1] - a[1]).map(([file, n]) => [file, +(n / ticks).toFixed(2)]));
console.log(JSON.stringify(out, null, flag('--files') ? 2 : 0));
await app.close();
process.exit(0);
