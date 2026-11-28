/**
 * What one Ludicrous agent costs on this computer (spec 076 S1), so the machine tiers and the start spacing come from numbers.
 * It starts bare Pi processes the way the conductor does, with no extension but Pi's own MCP support when asked, waits until each
 * answers, then reads the memory and CPU of each one's whole process tree, MCP servers included. Nothing is prompted, so no tokens
 * are spent. Usage: node scripts/perf/ludicrous-measure.ts [count=10]
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpus, totalmem } from 'node:os';
import { statfsSync } from 'node:fs';
import { homedir } from 'node:os';

const BARE = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files', '--offline'];
const MCP = ['--extension', 'builtin:mcp', '--extension', 'builtin:codemode', '--extension', 'builtin:tool-search'];
const SETTLE_MS = 6000;

type Row = { pid: number; ppid: number; rssKb: number; cpuSeconds: number };

// `ps` writes CPU time as [[dd-]hh:]mm:ss.cc.
function seconds(time: string): number {
  const [days, rest] = time.includes('-') ? time.split('-') : ['0', time];
  return rest.split(':').map(Number).reduce((total, part) => total * 60 + part, 0) + Number(days) * 86400;
}

function processTable(): Row[] {
  return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,time='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [pid, ppid, rss, time] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), cpuSeconds: seconds(time) };
  });
}

function treeOf(rows: Row[], root: number) {
  const inside = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of rows) if (!inside.has(row.pid) && inside.has(row.ppid)) { inside.add(row.pid); grew = true; }
  }
  const own = rows.filter(row => inside.has(row.pid));
  return { processes: own.length, rssMb: own.reduce((sum, row) => sum + row.rssKb, 0) / 1024, cpuSeconds: own.reduce((sum, row) => sum + row.cpuSeconds, 0) };
}

/** Starts one Pi and resolves with how long it took to answer its first command. */
function startPi(flags: string[]): Promise<{ child: ChildProcess; readyMs: number }> {
  const started = performance.now();
  const child = spawn('pi', [...BARE, ...flags], { cwd: homedir(), detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
  return new Promise((resolve, reject) => {
    let buffered = '';
    child.on('error', reject);
    child.stdout!.on('data', chunk => {
      buffered += chunk;
      if (buffered.includes('"command":"get_state"')) resolve({ child, readyMs: Math.round(performance.now() - started) });
    });
    child.stdin!.write(`${JSON.stringify({ id: 'ready', type: 'get_state' })}\n`);
  });
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (value: number, places = 1) => Math.round(value * 10 ** places) / 10 ** places;

async function measure(label: string, flags: string[], count: number) {
  const wall = performance.now();
  const started = await Promise.all(Array.from({ length: count }, () => startPi(flags)));
  const allReadyMs = Math.round(performance.now() - wall);
  await new Promise(done => setTimeout(done, SETTLE_MS));
  const rows = processTable();
  const trees = started.map(({ child }) => treeOf(rows, child.pid!));
  for (const { child } of started) process.kill(-child.pid!, 'SIGKILL');
  return {
    label, count, allReadyMs,
    readyMs: { first: Math.min(...started.map(each => each.readyMs)), median: median(started.map(each => each.readyMs)) },
    perAgent: {
      processes: median(trees.map(tree => tree.processes)),
      rssMb: round(median(trees.map(tree => tree.rssMb))),
      cpuSecondsToSettle: round(median(trees.map(tree => tree.cpuSeconds)), 2),
    },
  };
}

const count = Number(process.argv[2] ?? 10);
const { bavail, bsize } = statfsSync(homedir());
const machine = {
  model: execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim(),
  cores: cpus().length,
  performanceCores: Number(execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu'], { encoding: 'utf8' })),
  memoryGb: round(totalmem() / 2 ** 30),
  freeDiskGb: round((bavail * bsize) / 2 ** 30),
};
const results = [];
for (const [label, flags, many] of [['bare', [], 1], ['bare with MCP', MCP, 1], ['bare', [], count], ['bare with MCP', MCP, count]] as const) {
  results.push(await measure(label, [...flags], many));
}
console.log(JSON.stringify({ machine, results }, null, 2));
