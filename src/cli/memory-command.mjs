import { askRunning, TURN_TOKEN } from './hobkin-tell.mjs';
import { memoryHandler } from './memory-tools.mjs';
import { MEMORY_KINDS, memoryIndex } from './memories.mjs';

/**
 * `hobkin memory`: how an agent with a shell and no hobkin tools reads and keeps hobkin's memories (057-shared-memory),
 * as `hobkin_recall`, `hobkin_remember` and `hobkin_suggest_memory` do on Pi. Inside a durable hobkin's turn it asks the
 * running hobkin, which knows the turn by its token (`HOBKIN_TURN`), reads private memories for it and saves as that
 * hobkin. Anywhere else it reads the home's shared memories itself, never a private one, saves nothing, and a
 * suggestion goes to the main hobkin's inbox from the run that `HOBKIN_RUN` names.
 */

export const MEMORY_REQUESTS = 'memory-requests';
/** The environment a run hobkin started carries: its title, so what it types is known as that run's. */
export const RUN_MARKER = 'HOBKIN_RUN';
export const MEMORY_USAGE = 'Usage: hobkin memory [list [kind] | get <name> | search <words> [--kind kind] [--limit n] | add | change | forget <name> | restore <name> | suggest]. add, change and suggest read the memory as JSON on standard input, with the fields hobkin_remember takes.';
const LIST_BYTES = 65536;
const MOST_INPUT = 16384;
const TOKEN = /^[0-9a-f]{32}$/;
const SAVES_IN_A_TURN = "Nothing was saved: hobkin memory saves only inside a durable hobkin's turn. From your own session, use hobkin remember <text>, which saves it at once; from a run hobkin started, use hobkin memory suggest.";
const SAVE_IT = 'Inside your turn you save a memory yourself: use hobkin memory add.';

async function readAll(input) {
  const pieces = [];
  let bytes = 0;
  for await (const piece of input) {
    pieces.push(Buffer.from(piece));
    bytes += piece.length;
    if (bytes > MOST_INPUT) throw Error('A memory is at most 16 KB of JSON.');
  }
  return Buffer.concat(pieces).toString('utf8');
}

async function jsonInput(input) {
  let value;
  try {
    value = JSON.parse(await readAll(input));
  } catch (error) {
    throw Error(/16 KB/.test(error.message) ? error.message : `Give the memory as one JSON object on standard input. ${MEMORY_USAGE}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`Give the memory as one JSON object on standard input. ${MEMORY_USAGE}`);
  return value;
}

/** The words after the action, with `--kind` and `--limit` taken out. */
function searchOf(words) {
  const params = {};
  const rest = [];
  for (let index = 0; index < words.length; index += 1) {
    if (words[index] === '--kind' && MEMORY_KINDS.includes(words[index + 1])) params.kind = words[++index];
    else if (words[index] === '--limit' && /^\d+$/.test(words[index + 1] ?? '')) params.limit = Number(words[++index]);
    else if (words[index].startsWith('--')) throw Error(MEMORY_USAGE);
    else rest.push(words[index]);
  }
  if (!rest.length) throw Error(MEMORY_USAGE);
  return { ...params, words: rest.join(' ') };
}

/** One request as the command makes it: `{ action, params }`, the memory read from standard input where one is given. */
async function requestOf(args, input) {
  const [action = 'list', ...words] = args;
  if (action === 'list' && words.length <= 1 && (!words.length || MEMORY_KINDS.includes(words[0]))) return { action, params: words.length ? { kind: words[0] } : {} };
  if (['get', 'forget', 'restore'].includes(action) && words.length === 1) return { action, params: { name: words[0] } };
  if (action === 'search') return { action, params: searchOf(words) };
  if (['add', 'change', 'suggest'].includes(action) && !words.length) return { action, params: await jsonInput(input) };
  throw Error(MEMORY_USAGE);
}

/**
 * What one request answers with `handler` (`memoryHandler`), `{ text, ... }`: in the running hobkin for a durable turn,
 * and in the command itself anywhere else. `list` with no kind is the whole index the handler's reader may have.
 */
export function answerMemoryRequest(root, handler, { action, params = {} } = {}, { now = Date.now(), private: includePrivate = true } = {}) {
  if (action === 'list' && !params.kind) {
    const text = memoryIndex(root, { private: includePrivate, maxBytes: LIST_BYTES, now, recall: 'hobkin memory' });
    return { text: text || 'hobkin remembers nothing yet.' };
  }
  if (action === 'list') return handler.recall({ kind: params.kind, limit: 20 });
  if (action === 'get') return handler.recall({ name: params.name });
  if (action === 'search') return handler.recall(params);
  if (action === 'suggest') {
    if (!handler.suggest) throw Error(SAVE_IT);
    return handler.suggest(params);
  }
  if (['add', 'change', 'forget', 'restore'].includes(action)) {
    if (!handler.remember) throw Error(SAVES_IN_A_TURN);
    return handler.remember({ ...params, action });
  }
  throw Error(MEMORY_USAGE);
}

const titleOf = value => (typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 80) : '');

/**
 * `hobkin memory [list [kind] | get <name> | search <words> | add | change | forget <name> | restore <name> | suggest]`.
 * It answers `{ text, ... }`, and throws a refusal in plain words.
 */
export async function runMemoryCommand(root, args, { env = process.env, input = process.stdin, waitMs, now = Date.now(), from } = {}) {
  const request = await requestOf(args, input);
  const token = env[TURN_TOKEN];
  if (typeof token === 'string' && TOKEN.test(token)) {
    if (request.action === 'suggest') throw Error(SAVE_IT);
    return askRunning(root, MEMORY_REQUESTS, { token, ...request }, { waitMs });
  }
  const run = titleOf(env[RUN_MARKER]);
  // Not a turn: the shared memories only, and a suggestion from the run that typed it, or from the session it names.
  const handler = memoryHandler(root, { kind: 'run', title: run || titleOf(from) || 'another session' }, { now: () => now });
  return answerMemoryRequest(root, handler, request, { now, private: false });
}
