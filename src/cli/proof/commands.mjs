import { setupProof } from './setup.mjs';

const USAGE = 'Usage: hobkin proof setup';

/** `hobkin proof setup`: downloads the pinned TLC, only when asked, and says what it did in a line. */
export async function runProofCommand(home, args, output) {
  const [command, ...rest] = args;
  if (command === 'setup' && !rest.length) {
    const said = await setupProof({ home });
    output.write(`${said.message}\n`);
    return said.ok ? 0 : 1;
  }
  throw Error(USAGE);
}
