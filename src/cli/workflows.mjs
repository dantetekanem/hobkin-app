import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { atomicJson } from './config.mjs';
import { fileVersion } from './file-version.mjs';
import { parseSchedule } from './schedules.mjs';

/**
 * Workflows (065-integration-drops): each integration's folder of `<name>.md` files, a second source of routines that
 * hobkin only reads. A file is a routine's: JSON front matter between --- lines and the directions as its body, with
 * these differences. Its id is `<integration id>/<file name>`, so it says none or that name. Its schedule (`at` or
 * `window`, with `timezone` and a `weekday`, `day` or `date`) may be left out, and its cadence follows from what it gives:
 * weekly with `weekday`, monthly with `day`, once with `date`, daily otherwise. `on` lists what else starts it:
 * `press`, `start` and `after:<command>`. `model`, `effort` and `cwd` default to the home's background ones, and
 * `context` to none. Whether it is on is the home's (`runtime/workflows.json`), never the file's.
 */

const INTEGRATION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const STARTS = /^(press|start|after:[A-Za-z0-9][A-Za-z0-9_.:-]{0,119})$/;
const MOST_BYTES = 65536;
const fields = new Set(['id', 'title', 'at', 'window', 'timezone', 'harness', 'model', 'effort', 'cwd', 'context', 'weekday', 'day', 'date', 'on']);
const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const switchesFile = root => join(root, 'runtime', 'workflows.json');
/** Whether a workflow keeps a schedule of its own. One with none starts only by what its `on` lists. */
export const hasSchedule = schedule => schedule.at !== undefined || schedule.window !== undefined;

/** The folders the host's integrations give, `[{ id, folder, tools }]`. One that is not well formed is left out. */
export function workflowFoldersOf(integrations) {
  let folders;
  try {
    folders = integrations?.workflowFolders?.();
  } catch {
    return [];
  }
  const seen = new Set();
  return (Array.isArray(folders) ? folders : []).filter(item => {
    if (!item || typeof item.id !== 'string' || !INTEGRATION_ID.test(item.id) || seen.has(item.id) || typeof item.folder !== 'string' || !isAbsolute(item.folder)) return false;
    seen.add(item.id);
    return true;
  }).map(({ id, folder, tools }) => ({ id, folder, tools: Array.isArray(tools) ? tools.filter(name => typeof name === 'string') : [] }));
}

/** One workflow file, checked as a routine is, as the runner keeps it. */
export function parseWorkflow(source, { integration, name, path }, defaults) {
  try {
    if (Buffer.byteLength(source) > MOST_BYTES) throw Error('workflow is too large');
    const match = source.match(frontMatter);
    if (!match) throw Error('expected JSON metadata between --- lines');
    const value = JSON.parse(match[1]);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('metadata must be an object');
    for (const key of Object.keys(value)) if (!fields.has(key)) throw Error(`unknown setting: ${key}`);
    if (value.id !== undefined && value.id !== name) throw Error('id must be the file name, or left out');
    const on = value.on ?? [];
    if (!Array.isArray(on) || on.length > 20 || new Set(on).size !== on.length || on.some(start => typeof start !== 'string' || !STARTS.test(start))) {
      throw Error('on must list distinct starts: press, start or after:<command>');
    }
    const { on: _on, id: _id, ...routine } = value;
    const scheduled = hasSchedule(routine);
    if (!scheduled && !on.length) throw Error('a workflow needs a schedule or something in on that starts it');
    if (!scheduled && ['timezone', 'weekday', 'day', 'date'].some(key => routine[key] !== undefined)) throw Error('timezone, weekday, day and date go with a schedule');
    const cadence = routine.weekday !== undefined ? 'weekly' : routine.day !== undefined ? 'monthly' : routine.date !== undefined ? 'once' : 'daily';
    // Checked as a routine is: one with no schedule is checked with a stand-in time that it does not keep.
    const checked = { harness: 'pi', model: defaults.model ?? null, effort: defaults.effort, cwd: defaults.cwd, context: [], ...routine,
      id: name, enabled: true, ...(scheduled ? {} : { at: '00:00', timezone: 'UTC' }) };
    const parsed = parseSchedule(`---\n${JSON.stringify(checked)}\n---\n${match[2]}`, cadence, path);
    const { at, timezone, enabled: _enabled, ...kept } = parsed;
    const times = scheduled ? { ...(at === undefined ? {} : { at }), timezone, cadence } : { cadence: null };
    return { ...kept, ...times, id: `${integration}/${name}`, integration, on };
  } catch (error) {
    throw Error(error.message.startsWith(`${path}: `) ? error.message : `${path}: ${error.message}`, { cause: error });
  }
}

// The runner reads every workflow each second, so a file is parsed again only when it, or the defaults it takes, change.
const parsedWorkflows = new Map();
function readWorkflow(path, place, defaults) {
  const key = `${path}\0${JSON.stringify(defaults)}`;
  const version = fileVersion(path);
  const known = parsedWorkflows.get(key);
  if (known && version !== null && known.version === version) return known.value;
  let value;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw Error('workflow must be a regular file, not a symlink');
    if (stat.size > MOST_BYTES) throw Error('workflow is too large');
    value = { schedule: parseWorkflow(readFileSync(path, 'utf8'), { ...place, path }, defaults) };
  } catch (error) {
    value = { error: { path, message: error.message } };
  }
  if (parsedWorkflows.size > 1024) parsedWorkflows.clear();
  if (version !== null) parsedWorkflows.set(key, { version, value });
  return value;
}

/** Whether the user turned each workflow on or off, by its id, as `{ enabled, at }`. A file that cannot be read turns every one off. */
export function readWorkflowSwitches(root) {
  try {
    const saved = JSON.parse(readFileSync(switchesFile(root), 'utf8'));
    if (!saved || typeof saved.switches !== 'object' || Array.isArray(saved.switches)) throw Error('workflow switches must be an object');
    return { switches: saved.switches };
  } catch (error) {
    if (error.code === 'ENOENT') return { switches: {} };
    return { switches: {}, error: { path: switchesFile(root), message: `${error.message}; every workflow stays off until it is fixed` } };
  }
}

/** Turns one workflow on or off in the home. Turning one on again stamps when, so the times it missed meanwhile never run. */
export function switchWorkflow(root, id, enabled, now = new Date()) {
  const { switches, error } = readWorkflowSwitches(root);
  if (error) throw Error(error.message);
  atomicJson(switchesFile(root), { version: 1, switches: { ...switches, [id]: { enabled, at: new Date(now).toISOString() } } });
}

/**
 * Every workflow in these folders, in folder and then name order, with whether it is on. `defaults` are the home's
 * background `{ model, effort, cwd }`. A missing folder has none; a file that does not parse is an error, as a routine's is.
 */
export function loadWorkflows(root, folders, defaults) {
  const schedules = [];
  const errors = [];
  const { switches, error } = readWorkflowSwitches(root);
  if (error) errors.push(error);
  for (const { id: integration, folder } of folders) {
    let names;
    try {
      if (!lstatSync(folder).isDirectory()) throw Error('workflows must be a real directory');
      names = readdirSync(folder).filter(file => file.endsWith('.md') && file !== 'README.md').sort();
    } catch (failure) {
      if (failure.code !== 'ENOENT') errors.push({ path: folder, message: failure.message });
      continue;
    }
    for (const file of names) {
      const path = join(folder, file);
      const name = file.slice(0, -3);
      if (!NAME.test(name)) {
        errors.push({ path, message: 'a workflow is named in lowercase letters, digits, dots, dashes and underscores' });
        continue;
      }
      const { schedule, error: failed } = readWorkflow(path, { integration, name }, defaults);
      if (failed) {
        errors.push({ ...failed });
        continue;
      }
      const turned = switches[schedule.id];
      const enabled = !error && turned?.enabled !== false;
      schedules.push({ ...schedule, enabled, ...(enabled && turned?.at ? { enabledAt: turned.at } : {}) });
    }
  }
  return { schedules, errors };
}
