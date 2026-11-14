import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join } from 'node:path';

export const DRAWING_MAX_BYTES = 2 * 1024 * 1024;
const TITLE_MAX = 120;
const OWNER = /^(main|[0-9a-f]{8})$/;

const folder = root => join(root, 'canvas');
const stateFile = root => join(folder(root), 'state.json');

function owned(owner) {
  if (typeof owner !== 'string' || !OWNER.test(owner)) throw Error('A canvas belongs to main or to a durable hobkin by its eight-character id.');
  return owner;
}

/** The drawing file of an owner, whether or not it exists. */
export function drawingFile(root, owner) {
  return join(folder(root), `${owned(owner)}.html`);
}

function atomicWrite(file, content) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, content, { mode: 0o600 });
    renameSync(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temporary file may never have been written.
    }
    throw error;
  }
}

function validEntry(entry) {
  return entry && typeof entry === 'object' && typeof entry.open === 'boolean' && Number.isInteger(entry.revision);
}

/** Every canvas as it was written. A missing or unreadable file gives none, and one bad entry never hides the others. */
export function readCanvases(root) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(stateFile(root), 'utf8'));
  } catch {
    return {};
  }
  const canvases = {};
  for (const [owner, entry] of Object.entries(parsed?.canvases ?? {})) {
    if (!OWNER.test(owner) || !validEntry(entry)) continue;
    canvases[owner] = {
      open: entry.open,
      kind: entry.kind === 'page' || entry.kind === 'drawing' ? entry.kind : null,
      url: typeof entry.url === 'string' ? entry.url : null,
      title: typeof entry.title === 'string' ? entry.title : null,
      revision: entry.revision,
      key: typeof entry.key === 'string' ? entry.key : null,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '',
    };
  }
  return canvases;
}

function write(root, owner, entry) {
  const canvases = { ...readCanvases(root), [owner]: { ...entry, updatedAt: new Date().toISOString() } };
  atomicWrite(stateFile(root), `${JSON.stringify({ version: 1, canvases }, null, 2)}\n`);
  return canvases[owner];
}

function cleanTitle(title) {
  if (title === undefined || title === null) return null;
  if (typeof title !== 'string') throw Error('The title must be text.');
  const text = title.trim();
  if (text.length > TITLE_MAX) throw Error(`The title is at most ${TITLE_MAX} characters.`);
  return text || null;
}

function address(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('That is not a web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw Error('The canvas shows only http and https pages.');
  if (!url.hostname) throw Error('That address has no host.');
  if (url.username || url.password) throw Error('The canvas does not take an address with a sign-in in it.');
  return url.href;
}

const blank = { open: false, kind: null, url: null, title: null, revision: 0, key: null };

export function showPage(root, owner, { url, title } = {}) {
  owned(owner);
  const page = address(url);
  const old = readCanvases(root)[owner] ?? blank;
  return write(root, owner, {
    ...old,
    open: true,
    kind: 'page',
    url: page,
    title: cleanTitle(title),
    revision: old.revision + 1,
  });
}

export function drawCanvas(root, owner, { html, title } = {}) {
  owned(owner);
  if (typeof html !== 'string' || !html.trim()) throw Error('The drawing is empty.');
  if (html.includes('\0')) throw Error('The drawing is not text.');
  if (Buffer.byteLength(html, 'utf8') > DRAWING_MAX_BYTES) throw Error('The drawing is over 2 MiB.');
  const name = cleanTitle(title);
  const old = readCanvases(root)[owner] ?? blank;
  atomicWrite(drawingFile(root, owner), html);
  return write(root, owner, {
    ...old,
    open: true,
    kind: 'drawing',
    url: null,
    title: name,
    revision: old.revision + 1,
    key: old.key ?? randomBytes(16).toString('hex'),
  });
}

export function closeCanvas(root, owner) {
  owned(owner);
  const old = readCanvases(root)[owner] ?? blank;
  return write(root, owner, { ...old, open: false });
}

/** The state and the absolute path of the drawing, or null when there is none. */
export function readCanvas(root, owner) {
  owned(owner);
  const file = drawingFile(root, owner);
  return { state: readCanvases(root)[owner] ?? { ...blank, updatedAt: '' }, file: existsSync(file) ? file : null };
}

function slug(title) {
  const text = (title ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return text || 'canvas';
}

function copyNew(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  try {
    copyFileSync(from, to, 1);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  return true;
}

export function saveCanvas(root, owner, { path, downloads, home = homedir() } = {}) {
  const { state, file } = readCanvas(root, owner);
  if (!file) throw Error('There is no drawing to save.');
  if (path) {
    const full = path.startsWith('~/') ? join(home, path.slice(2)) : path;
    if (!isAbsolute(full)) throw Error('Give the path in full, or starting with ~/.');
    const target = extname(full) ? full : `${full}.html`;
    if (!copyNew(file, target)) throw Error('That file already exists. Saving never replaces a file.');
    return { path: target };
  }
  const base = join(downloads ?? join(home, 'Downloads'), slug(state.title));
  for (let n = 1; ; n += 1) {
    const target = `${base}${n === 1 ? '' : `-${n}`}.html`;
    if (copyNew(file, target)) return { path: target };
  }
}

/** The canvas skill as the model reads it. */
export function canvasSkill() {
  return readFileSync(new URL('../prompts/canvas.md', import.meta.url), 'utf8');
}

/** What the `hobkin canvas` command prints: one line a model can read. */
export function summary(root, owner) {
  const { state, file } = readCanvas(root, owner);
  return {
    open: state.open,
    kind: state.kind,
    ...(state.url ? { url: state.url } : {}),
    title: state.title,
    revision: state.revision,
    file,
  };
}

const TOO_BIG = 'The drawing is over 2 MiB.';

/** Standard input, read only as far as a drawing may go, so input that never ends is refused instead of filling memory. */
async function readText(input) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > DRAWING_MAX_BYTES) throw Error(TOO_BIG);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** A drawing's file: a regular file of at most a drawing's size. A device or a pipe has no size to check, so it is refused. */
function readDrawingFile(file) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    throw Error(`There is no file at ${file}.`);
  }
  if (!stat.isFile()) throw Error('Give the drawing as a file, or - for standard input.');
  if (stat.size > DRAWING_MAX_BYTES) throw Error(TOO_BIG);
  return readFileSync(file);
}

/** `hobkin canvas show|draw|read|save|close`. Writes the store files only; the running app follows them. */
export async function runCanvasCommand(root, args, { hobkin, title, input, downloads, home } = {}) {
  const [action, argument, ...extra] = args;
  const owner = hobkin ?? 'main';
  if (extra.length) throw Error('Too many arguments for hobkin canvas.');
  if (action === 'show') {
    if (!argument) throw Error('Usage: hobkin canvas show <url> [--title text] [--hobkin id]');
    showPage(root, owner, { url: argument, title });
    return summary(root, owner);
  }
  if (action === 'draw') {
    if (!argument) throw Error('Usage: hobkin canvas draw <file|-> [--title text] [--hobkin id]');
    const bytes = argument === '-' ? await readText(input ?? process.stdin) : readDrawingFile(argument);
    if (bytes.length > DRAWING_MAX_BYTES) throw Error(TOO_BIG);
    let html;
    try {
      html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw Error('The drawing is not text.');
    }
    drawCanvas(root, owner, { html, title });
    return summary(root, owner);
  }
  if (action === 'read' && !argument) return summary(root, owner);
  if (action === 'save') return saveCanvas(root, owner, { path: argument, downloads, home });
  if (action === 'close' && !argument) {
    closeCanvas(root, owner);
    return summary(root, owner);
  }
  throw Error('Usage: hobkin canvas show <url> | draw <file|-> | read | save [path] | close  [--title text] [--hobkin id]');
}
