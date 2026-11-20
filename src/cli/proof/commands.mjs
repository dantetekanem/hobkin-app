import { join } from 'node:path';
import { CHECK_USAGE, parseCheckArgs, runCheck, stopProof } from './check.mjs';
import { runFolder } from './record.mjs';
import { setupProof } from './setup.mjs';

const USAGE = `${CHECK_USAGE}\n       hobkin proof stop <id>\n       hobkin proof setup`;

/** `hobkin proof check | stop | setup`. A check prints its run in a line of JSON and exits 0 only when it holds. */
export async function runProofCommand(home, args, output, { signals = process } = {}) {
  const [command, ...rest] = args;
  if (command === 'check') {
    const options = parseCheckArgs(rest);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signals.on('SIGTERM', abort);
    signals.on('SIGINT', abort);
    try {
      const run = await runCheck({ ...options, home, signal: controller.signal });
      const { id, outcome, spec, broken, message, stats, counts } = run;
      output.write(`${JSON.stringify({ id, outcome, spec, ...(broken ? { broken } : {}), ...(message ? { message } : {}), stats, counts, result: join(runFolder(home, id), 'result.json') })}\n`);
      return outcome === 'holds' ? 0 : 1;
    } finally {
      signals.removeListener('SIGTERM', abort);
      signals.removeListener('SIGINT', abort);
    }
  }
  if (command === 'stop' && rest.length === 1) {
    output.write(`${JSON.stringify(await stopProof({ home, id: rest[0] }))}\n`);
    return 0;
  }
  if (command === 'setup' && !rest.length) {
    const said = await setupProof({ home });
    output.write(`${said.message}\n`);
    return said.ok ? 0 : 1;
  }
  throw Error(USAGE);
}
