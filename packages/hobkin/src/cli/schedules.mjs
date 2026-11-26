import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseCompatibility } from './legacy-schedules.mjs';
import { writePrivate } from './reports.mjs';
import { readVersioned } from './file-version.mjs';
import { scheduleDefinition } from './checks.mjs';

const OLD_FOLDER = 'schedules';

export const cadences = ['daily', 'weekly', 'monthly', 'once'];
export const efforts = {
  pi: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
};
const legacyClaudeEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];
const fields = new Set(['id', 'title', 'at', 'window', 'timezone', 'enabled', 'enabledAt', 'harness', 'model', 'effort', 'cwd', 'context', 'weekday', 'day', 'date']);
const controls = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
const text = value => typeof value === 'string' && value.trim().length > 0 && !controls.test(value);
const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
const changeable = ['enabled', 'at', 'window'];

export function validateBinding(binding, { allowLegacyHarness = false } = {}) {
  let supportedEfforts;
  if (binding?.harness === 'pi') {
    supportedEfforts = efforts.pi;
  } else if (allowLegacyHarness && binding?.harness === 'claude') {
    supportedEfforts = legacyClaudeEfforts;
  } else {
    throw Error('harness must be pi');
  }
  if (!supportedEfforts.includes(binding.effort)) throw Error(`unsupported ${binding.harness} effort`);
  if (binding.model != null && (!text(binding.model) || binding.model.startsWith('-') || binding.model.length > 200)) {
    throw Error('invalid model');
  }
}

export function scheduleTimes({ at, window }) {
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  if (window !== undefined) {
    if (at !== undefined) throw Error('choose at or window, not both');
    if (!window || Array.isArray(window) || typeof window !== 'object'
      || Object.keys(window).some(key => !['start', 'end', 'everyMinutes'].includes(key))
      || !validTime(window.start) || !validTime(window.end)
      || window.start > window.end || !Number.isInteger(window.everyMinutes)
      || window.everyMinutes < 1 || window.everyMinutes > 1440) {
      throw Error('window needs same-day HH:mm start/end and everyMinutes from 1 to 1440');
    }
    const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    const start = minutes(window.start);
    const count = Math.floor((minutes(window.end) - start) / window.everyMinutes) + 1;
    if (count > 48) throw Error('window may contain at most 48 checks per day');
    return Array.from({ length: count }, (_, index) => {
      const minute = start + index * window.everyMinutes;
      return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    });
  }
  const times = Array.isArray(at) ? at : [at];
  if (!times.length || times.length > 48 || new Set(times).size !== times.length || times.some(time => !validTime(time))) {
    throw Error('at must be HH:mm or a list of 1–48 unique HH:mm times');
  }
  return [...times].sort();
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** When a check runs in a few words, so a list of them reads as the whole calendar. */
export function whenItRuns({ cadence, at, window, weekday, day, date }) {
  const days = {
    weekly: [weekday].flat().map(value => dayNames[value]).join(', '),
    monthly: `day ${day}`,
    once: date,
  }[cadence];
  const times = window ? `${window.start}-${window.end} every ${window.everyMinutes}m` : [at].flat().join(', ');
  return [days, times].filter(Boolean).join(' ');
}

export function scheduleDate(date) {
  const match = typeof date === 'string' && date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const value = match && new Date(Date.UTC(year, month - 1, day));
  if (!match || year < 1 || value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    throw Error('date must be a real YYYY-MM-DD calendar date');
  }
  return { year, month, day };
}

export function parseSchedule(source, cadence, path) {
  try {
    if (Buffer.byteLength(source) > 65536) throw Error('routine is too large');
    if (!cadences.includes(cadence)) throw Error('unknown recurrence folder');
    const match = source.match(frontMatter);
    if (!match) throw Error('expected JSON metadata between --- lines');
    const value = JSON.parse(match[1]);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error('metadata must be an object');
    for (const key of Object.keys(value)) if (!fields.has(key)) throw Error(`unknown setting: ${key}`);
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(value.id ?? '')) throw Error('invalid id');
    if (!text(value.title) || value.title.length > 160 || /[\r\n]/.test(value.title)) throw Error('invalid title');
    scheduleTimes(value);
    if (!text(value.timezone)) throw Error('timezone is required');
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
    if (typeof value.enabled !== 'boolean') throw Error('enabled must be true or false');
    if (value.enabledAt !== undefined && !Number.isFinite(Date.parse(value.enabledAt))) throw Error('enabledAt must be a timestamp');
    validateBinding(value);
    if (!text(value.cwd) || !isAbsolute(value.cwd)) throw Error('cwd must be an absolute path');
    if (
      !Array.isArray(value.context)
      || value.context.length > 20
      || value.context.some(item => !text(item) || isAbsolute(item) || item.split(/[\\/]/).includes('..'))
    ) {
      throw Error('context must contain relative paths within cwd');
    }
    const weekdays = [value.weekday].flat();
    if (cadence === 'weekly'
      ? !weekdays.length || new Set(weekdays).size !== weekdays.length
        || weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
      : value.weekday !== undefined) {
      throw Error('weekday must be 0–6 or a list of distinct 0–6 days, for weekly routines only');
    }
    if (cadence === 'monthly'
      ? !Number.isInteger(value.day) || value.day < 1 || value.day > 31
      : value.day !== undefined) {
      throw Error('day must be 1–31 for monthly routines only');
    }
    if (cadence === 'once') scheduleDate(value.date);
    else if (value.date !== undefined) throw Error('date is for once routines only');

    const prompt = match[2].trim();
    if (!text(prompt)) throw Error('instructions must be nonempty and contain no terminal controls');
    return { ...value, model: value.model ?? null, cadence, path, prompt };
  } catch (error) {
    throw Error(`${path}: ${error.message}`, { cause: error });
  }
}

export function formatSchedule(schedule) {
  const { cadence, path, prompt, ...metadata } = schedule;
  return `---\n${JSON.stringify(metadata, null, 2)}\n---\n${prompt}\n`;
}

/**
 * Turns one routine on or off, or gives it new times, in its own file. The change is checked as any routine file is
 * before it is written, and the rest of the file stays as it was. A routine from the old scheduler is not changed here.
 * Turning a routine on stamps `enabledAt`, so the slots that had already passed are never run; it waits for its next one.
 */
export function changeSchedule(root, id, change, now = new Date()) {
  const deleting = Object.hasOwn(change, 'delete');
  if (deleting && Object.keys(change).length !== 1) throw Error('Only deletion may be requested with a definition.');
  if (!deleting && (!Object.keys(change).length || Object.keys(change).some(key => !changeable.includes(key)))) throw Error('Only enabled, at or window change here.');
  const schedule = loadSchedules(root).schedules.find(item => item.id === id && item.cadence !== 'compatibility');
  if (!schedule) throw Error('Unknown exact native routine ID; list candidates first.');

  if (deleting) {
    if (change.delete !== scheduleDefinition(schedule)) throw Error('Routine definition changed; confirm the current routine before deleting.');
    unlinkSync(schedule.path);
    return { id: schedule.id, deleted: true };
  }
  const [, front, body] = readFileSync(schedule.path, 'utf8').match(frontMatter);
  const metadata = JSON.parse(front);
  if ('at' in change) delete metadata.window;
  if ('window' in change) delete metadata.at;
  Object.assign(metadata, change);
  if (change.enabled === true && !schedule.enabled) metadata.enabledAt = new Date(now).toISOString();
  scheduleTimes(metadata);
  const source = `---\n${JSON.stringify(metadata, null, 2)}\n---\n${body}`;
  const changed = parseSchedule(source, schedule.cadence, schedule.path);
  writePrivate(schedule.path, source);
  return changed;
}

/** A home keeps its old folder until a dashboard opens it, so a CLI call can never pull the folder out from under a running one. */
export function routinesFolder(root) {
  const folder = join(root, 'routines');
  const old = join(root, OLD_FOLDER);
  return !existsSync(folder) && existsSync(old) ? old : folder;
}

/**
 * Only the dashboard calls this, holding the lock, so nothing is reading the folder. The old path stays as a link because routines,
 * notes and memories can have it written out in full, and changing their text would count as changing them.
 */
export function moveRoutinesFolder(root) {
  const folder = join(root, 'routines');
  const old = join(root, OLD_FOLDER);
  if (existsSync(folder) || !lstatSync(old, { throwIfNoEntry: false })?.isDirectory()) return;

  renameSync(old, folder);
  symlinkSync('routines', old);
}

/** Runs keep their stored names. What a person or an agent reads says routine, and JSON escapes any quote inside a value, so this only ever matches a key. */
export const inRoutineWords = json => json.replaceAll('"scheduleId":', '"routineId":').replaceAll('"schedules":', '"routines":');

// The scheduler loads every routine each second, so a file is read and checked again only when its version changes. The parse is frozen,
// since every caller gets the same one, and so is what was wrong with a file that does not parse.
const parsedRoutines = new Map();
function parseRoutine(path, cadence) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw Error('routine must be a regular file, not a symlink');
    if (stat.size > (cadence === 'compatibility' ? 1048576 : 65536)) throw Error('routine is too large');
    const source = readFileSync(path, 'utf8');
    const schedule = cadence === 'compatibility' ? parseCompatibility(source, path) : parseSchedule(source, cadence, path);
    return { schedule };
  } catch (error) {
    return { error: { path, message: error.message } };
  }
}

export function loadSchedules(root) {
  const schedules = [];
  const errors = [];
  for (const cadence of [...cadences, 'compatibility']) {
    const directory = join(routinesFolder(root), cadence);
    let entries;
    try {
      if (!lstatSync(directory).isDirectory()) throw Error('recurrence path must be a real directory');
      entries = readdirSync(directory).sort();
    } catch (error) {
      if (error.code !== 'ENOENT') errors.push({ path: directory, message: error.message });
      continue;
    }
    const extension = cadence === 'compatibility' ? '.json' : '.md';
    const files = entries.filter(name => name.endsWith(extension) && name !== 'README.md');
    for (const name of files) {
      const path = join(directory, name);
      const { schedule, error } = readVersioned(parsedRoutines, path, () => parseRoutine(path, cadence), 1024);
      if (schedule) schedules.push(schedule);
      else errors.push({ ...error });
    }
  }
  const ids = new Map();
  for (const schedule of schedules) {
    ids.set(schedule.id, (ids.get(schedule.id) ?? 0) + 1);
  }
  const valid = schedules.filter(schedule => {
    if (ids.get(schedule.id) === 1) return true;
    errors.push({ path: schedule.path, message: `duplicate routine id: ${schedule.id}` });
    return false;
  });
  const groups = valid.some(item => item.cadence === 'compatibility') ? [...cadences, 'compatibility'] : cadences;
  return {
    schedules: valid,
    errors,
    counts: Object.fromEntries(groups.map(cadence => [
      cadence,
      valid.filter(item => item.cadence === cadence).length,
    ])),
  };
}
