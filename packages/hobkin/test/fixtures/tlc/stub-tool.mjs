// Stands in for `java` and `tlapm` in the proof tests, so they need neither. It replays the output files its plan names,
// from this folder, and writes each call to the plan's log. The plan is a JSON file whose path the wrapper script passes
// in HOBKIN_STUB:
//   { log, java: "21.0.2" | null, sany: step, tlc: step, graph: step, tlapm: step }
//   step = { stdout?, stderr?, code?, holdMs?, ignoreTerm?, dot? }
// `graph` is the TLC run that dumps the state graph; without one, that run replays `tlc`.
import { appendFileSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = name => fileURLToPath(new URL(name, import.meta.url));
const plan = JSON.parse(readFileSync(process.env.HOBKIN_STUB, 'utf8'));
const args = process.argv.slice(2);
appendFileSync(plan.log, `${JSON.stringify({ args, pid: process.pid })}\n`);

if (args[0] === '-version') {
  if (plan.java) {
    process.stderr.write(`openjdk version "${plan.java}" 2024-01-16\nOpenJDK Runtime Environment Homebrew (build ${plan.java})\n`);
  } else {
    process.stderr.write('The operation couldn’t be completed. Unable to locate a Java Runtime.\n');
    process.exitCode = 1;
  }
} else {
  const dumping = args.includes('-dump');
  const tool = args.includes('tla2sany.SANY') ? 'sany'
    : args.includes('tlc2.TLC') ? (dumping && plan.graph ? 'graph' : 'tlc')
      : args.includes('--toolbox') ? 'tlapm' : 'unknown';
  const step = plan[tool] ?? { stderr: null, code: 99 };
  if (step.ignoreTerm) process.on('SIGTERM', () => {});
  if (step.stdout) process.stdout.write(readFileSync(here(step.stdout), 'utf8'));
  if (step.stderr) process.stderr.write(readFileSync(here(step.stderr), 'utf8'));
  if (dumping && step.dot) copyFileSync(here(step.dot), args[args.indexOf('-dump') + 2]);
  if (step.holdMs) setTimeout(() => {}, step.holdMs);
  process.exitCode = step.code ?? 0;
}
