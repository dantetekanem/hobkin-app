import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feedbackEnabled } from '../config.mjs';
import { recordEvent } from '../events.mjs';
import { draftFeedback } from './draft.mjs';
import { saveCrashDraft } from './outbox.mjs';

export const CRASH_MESSAGE = 'The dashboard stopped on an uncaught error.';
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAX_FRAMES = 40;
const MAX_FRAME_BYTES = 280;
const MAX_FILE_BYTES = 240;
const CLASS = /^[A-Z][A-Za-z0-9]{0,79}$/;
const LOCATION = /^(.+?):([1-9]\d{0,6})(?::([1-9]\d{0,5}))?$/;
const PACKAGE_FILE = /^[A-Za-z0-9_@./-]+\.(?:mjs|cjs|js|ts)$/;
const NODE_FILE = /^node:(?:internal\/)?[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const CATEGORIES = { uncaughtException: 'uncaught_exception', unhandledRejection: 'unhandled_rejection' };

function rootsOf(packageRoot) {
  const roots = [packageRoot];
  try {
    roots.push(realpathSync(packageRoot));
  } catch {
    // A package root that is not on disk is still compared as written.
  }
  return [...new Set(roots.map(root => root.replace(/\/+$/, '') || '/'))];
}

// A frame reads `at name (location)` or `at location`. An eval frame nests its parentheses, and has no location to keep.
function locationOf(line) {
  const text = line.trim();
  if (!text.startsWith('at ')) return null;
  return text.match(/\(([^()]*)\)$/)?.[1] ?? text.slice(3);
}

function pathOf(file) {
  if (!file.startsWith('file://')) return file;
  try {
    return fileURLToPath(file);
  } catch {
    return null;
  }
}

function insidePackage(path, roots) {
  for (const root of roots) {
    const inside = relative(root, path).split(sep).join('/');
    if (inside && !inside.startsWith('..') && !isAbsolute(inside)) return inside;
  }
  return null;
}

const nodeFile = file => (NODE_FILE.test(file) ? file : null);

function packageFile(file, roots) {
  const path = pathOf(file);
  const inside = path && isAbsolute(path) ? insidePackage(path, roots) : null;
  if (!inside || !PACKAGE_FILE.test(inside)) return null;
  return inside.split('/').some(part => ['', '.', '..'].includes(part)) ? null : `hobkin/${inside}`;
}

function frameOf(location, roots) {
  const [, file, line, column] = location?.match(LOCATION) ?? [];
  if (!file) return null;

  const name = file.startsWith('node:') ? nodeFile(file) : packageFile(file, roots);
  if (!name || Buffer.byteLength(name) > MAX_FILE_BYTES) return null;

  const frame = column ? `${name}:${line}:${column}` : `${name}:${line}`;
  return Buffer.byteLength(frame) <= MAX_FRAME_BYTES ? frame : null;
}

/**
 * The stack as frames the server takes: a file inside the installed hobkin package as `hobkin/<path>:<line>[:<column>]`,
 * Node's own as `node:...`. Every other frame is dropped, so no user path, repository, argument or message goes.
 */
export function normalizeFrames(stack, { packageRoot = PACKAGE_ROOT } = {}) {
  const roots = rootsOf(packageRoot);
  return String(stack ?? '')
    .split('\n')
    .map(line => frameOf(locationOf(line), roots))
    .filter(Boolean)
    .slice(0, MAX_FRAMES);
}

const isShortName = name => typeof name === 'string' && name !== 'Error' && CLASS.test(name);

/** A short identifier, like TypeError, taken from the error's name or its class. Never anything the error says. */
export function errorClass(error) {
  if (!(error instanceof Error)) return 'Error';
  return [error.name, error.constructor?.name].find(isShortName) ?? 'Error';
}

export const crashDraft = (error, { now = Date.now(), packageRoot } = {}) => draftFeedback({
  kind: 'crash',
  message: CRASH_MESSAGE,
  now,
  crash: {
    error_class: errorClass(error),
    frames: normalizeFrames(error instanceof Error ? error.stack : '', { packageRoot }),
  },
});

/**
 * Watches the dashboard process for an error nothing caught. The monitor leaves Node's own handling alone, so the process
 * stops as it would have. Each crash becomes a structured fact in the local event stream and, with feedback on, a draft
 * that the next start offers. Nothing here sends anything.
 */
export function captureCrashes(root, events = process, { now = Date.now } = {}) {
  const capture = (error, origin) => {
    const at = now();
    // Another handler would keep the process running, and then this crash did not end it.
    const fatal = (events.listenerCount?.('uncaughtException') ?? 0) === 0;
    recordEvent(root, 'crash_occurred', { component: 'cli', category: CATEGORIES[origin] ?? 'unknown', fatal }, at);
    try {
      if (feedbackEnabled(root)) saveCrashDraft(root, crashDraft(error, { now: at }), at);
    } catch {
      // A crash that cannot be written down still stops the process the way it would have.
    }
  };
  events.on('uncaughtExceptionMonitor', capture);
  return () => events.removeListener('uncaughtExceptionMonitor', capture);
}
