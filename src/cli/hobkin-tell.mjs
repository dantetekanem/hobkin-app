import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import lockfile from 'proper-lockfile';

/**
 * `hobkin tell`: how a durable hobkin messages the main hobkin or another durable hobkin (the client's
 * `_specs/034-durable-hobkins`). It runs in the turn's own shell, another process, so it hands the words to the running
 * hobkin as a file in its home and waits for the answer. Who sends is never typed: hobkin gives each turn's process a
 * token it holds for that turn alone, and names the sender from it (`Hobkins.takeTells`).
 */

/** The environment a turn's process carries: its token, and the home of the hobkin that runs it. */
export const TURN_TOKEN = 'HOBKIN_TURN';
export const TURN_HOME = 'HOBKIN_HOME';
/** The longest message one hobkin sends another, in characters. */
export const TELL_MAX = 4096;

const TOKEN = /^[0-9a-f]{32}$/;
const REQUEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/;
const ANSWER = '.answer.json';
// What a write or a take leaves for a moment: `<id>.json.tmp`, `<id>.answer.json.tmp` and `<id>.json.taken`.
const PASSING = /\.json\.(tmp|taken)$/;
const ANSWER_WAIT_MS = 15000;
const LOOK_MS = 25;
// An answer nobody came for, or a moment's file left by a stop, is this old at least.
const STALE_MS = 60000;
// The same stale age hobkin locks its runtime with, so "running" means what it means there.
const LOCK_STALE_MS = 300000;
const MOST_REQUEST_BYTES = 65536;

const OUTSIDE = "Nothing was sent: hobkin tell works only inside a durable hobkin's turn, which tells hobkin who is sending.";
const NOT_RUNNING = 'Nothing was sent: hobkin is not running.';
const NO_ANSWER = 'Nothing was sent: hobkin did not take the message in time. Try once more.';
const UNKNOWN = 'hobkin took the message but did not answer, so whether it was sent is not known.';
export const USAGE = 'Usage: hobkin tell [main | <id>] [<words> | -]';
export const TOO_LONG = `Write a message of at most ${TELL_MAX} characters.`;

/** A token for one turn. */
export const turnToken = () => randomBytes(16).toString('hex');

/** The folder `hobkin tell` writes to, made when missing so the running hobkin can watch it. */
export function tellRequests(root) {
  const folder = join(root, 'runtime', 'tell-requests');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return folder;
}

const writeWhole = (file, value) => {
  writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
};

async function readAll(input) {
  const pieces = [];
  for await (const piece of input) pieces.push(Buffer.from(piece));
  return Buffer.concat(pieces).toString('utf8');
}

async function running(root) {
  try {
    return await lockfile.check(join(root, 'runtime'), { stale: LOCK_STALE_MS });
  } catch {
    return false;
  }
}

/**
 * The JSON in a small regular file. It never follows a link, never waits on a pipe and never reads past the bound, so
 * whatever is put in the folder, reading it ends at once. Null for anything else.
 */
function readSmall(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MOST_REQUEST_BYTES) return null;
    const { size } = stat;
    const bytes = Buffer.alloc(size);
    for (let read = 0; read < size;) {
      const got = readSync(fd, bytes, read, size - read, read);
      if (!got) break;
      read += got;
    }
    return JSON.parse(bytes.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

function readAnswer(file) {
  try {
    return readSmall(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** True when the request was still there to take back, so hobkin never saw it. */
function takeBack(file) {
  try {
    rmSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * `hobkin tell [main | <id>] [<words> | -]`. With a recipient it sends the words, or standard input for `-`. With none
 * it lists who the turn can reach. It answers with what the running hobkin said, and throws its refusal.
 */
export async function runTellCommand(root, args, { env = process.env, input = process.stdin, waitMs = ANSWER_WAIT_MS } = {}) {
  const token = env[TURN_TOKEN];
  if (typeof token !== 'string' || !TOKEN.test(token)) throw Error(OUTSIDE);
  const [to, ...words] = args;
  const request = { token };
  if (to !== undefined) {
    const text = words.length === 1 && words[0] === '-' ? await readAll(input) : words.join(' ');
    if (!text.trim()) throw Error(USAGE);
    if (text.length > TELL_MAX) throw Error(TOO_LONG);
    Object.assign(request, { to, text });
  }
  if (!await running(root)) throw Error(NOT_RUNNING);

  const id = randomUUID();
  const file = join(tellRequests(root), `${id}.json`);
  const answer = join(tellRequests(root), `${id}${ANSWER}`);
  writeWhole(file, request);
  let deadline = Date.now() + waitMs;
  let taken = false;
  for (;;) {
    const answered = readAnswer(answer);
    if (answered) {
      rmSync(answer, { force: true });
      if (!answered.ok) throw Error(answered.error);
      return answered.value;
    }
    if (Date.now() >= deadline) {
      if (taken) throw Error(UNKNOWN);
      if (takeBack(file)) throw Error(NO_ANSWER);
      // hobkin took it, so its answer is on the way.
      taken = true;
      deadline = Date.now() + waitMs;
    }
    await wait(LOOK_MS);
  }
}

/** Takes one request: renamed first, so a second look at the same moment finds nothing to take. Undefined when it was not taken. */
function take(path, name) {
  const mine = `${path}.taken`;
  try {
    renameSync(path, mine);
  } catch {
    return undefined;
  }
  let request = null;
  try {
    request = readSmall(mine);
  } catch {
    // Answered as a request that cannot be read.
  }
  try {
    rmSync(mine, { force: true });
  } catch {
    // Not a file after all. It is stale in a minute and left alone, and the request is still answered.
  }
  return { id: name.slice(0, -'.json'.length), request };
}

/**
 * The requests waiting, each taken once: whoever renames one first answers it, so two looks at the same moment never
 * answer one twice. A request that cannot be read comes back as null, to be answered with a refusal. Only a regular
 * file is a request: a link or a pipe in its place is removed unread, and a folder is left alone. Each entry is looked
 * at on its own, so one that is not what it should be never costs another its answer. What a write, a take or an
 * answer left behind for over a minute is removed.
 */
export function takeTellRequests(root, now = Date.now()) {
  const taken = [];
  let folder;
  let names;
  try {
    folder = tellRequests(root);
    names = readdirSync(folder);
  } catch {
    return taken;
  }
  for (const name of names) {
    try {
      const path = join(folder, name);
      const entry = lstatSync(path);
      if (name.endsWith(ANSWER) || PASSING.test(name)) {
        if (!entry.isDirectory() && now - entry.mtimeMs > STALE_MS) rmSync(path, { force: true });
      } else if (REQUEST.test(name)) {
        if (entry.isFile()) {
          const request = take(path, name);
          if (request) taken.push(request);
        } else if (!entry.isDirectory()) {
          rmSync(path, { force: true });
        }
      }
    } catch {
      // The next look tries this entry again.
    }
  }
  return taken;
}

/** The answer the waiting command reads: `{ ok: true, value }` or `{ ok: false, error }`. */
export const answerTell = (root, id, answer) => writeWhole(join(tellRequests(root), `${id}${ANSWER}`), answer);
