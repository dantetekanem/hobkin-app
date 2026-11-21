import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cadences, routinesFolder, validateBinding } from './schedules.mjs';
import { validateLauncher } from './launcher.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { readVersioned } from './file-version.mjs';
import { validatePersona } from './persona.mjs';
import { validateReview, validateTiers } from './tiers.mjs';
import { changeSelection, normalizeSelection, validateResourceSelection, resolveResourcePolicy } from './resource-policy.mjs';

export const defaultRoot = () => process.env.HOBKIN_HOME || join(homedir(), '.hobkin');
export const legacySources = (home = homedir()) => [
  join(home, '.hobkin-schedules.md'),
  join(home, '.hobkin-notes'),
  join(home, '.hobkin-reports-updates.md'),
  join(home, '.pi', 'agent', 'hobkin'),
];

export function atomicJson(file, value, { exclusive = false } = {}) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    if (exclusive) linkSync(temporary, file);
    else renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function loadConfig(root) {
  root = resolveDataRoot(root);
  const file = join(root, 'config.json');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 65536) throw Error('Hobkin configuration must be a bounded regular file.');
  return validateConfig(JSON.parse(readFileSync(file, 'utf8')), { allowLegacyHarness: true });
}

// The settings as saved, read again whenever the file's version changes, so `hobkin learning` in another terminal reaches a running
// dashboard on its next look. Null when the file cannot be read, which is not worth failing a refresh. Only the switches below read this.
const savedSettings = new Map();
function savedConfig(root) {
  const home = resolveDataRoot(root);
  return readVersioned(savedSettings, join(home, 'config.json'), () => {
    try {
      return loadConfig(home);
    } catch {
      return null;
    }
  }, 16);
}

function settingOn(root, name) {
  return savedConfig(root)?.[name]?.enabled === true;
}

function setSetting(root, name, enabled) {
  atomicJson(join(resolveDataRoot(root), 'config.json'), { ...loadConfig(root), [name]: { enabled } });
  return { enabled };
}

export const learningEnabled = root => settingOn(root, 'learning');

export const setLearning = (root, enabled) => setSetting(root, 'learning', enabled);

/** On unless the user turned it off. A configuration hobkin cannot read sends nothing. */
function settingNotOff(root, name) {
  const config = savedConfig(root);
  return config ? config[name]?.enabled !== false : false;
}

/** Feedback goes only on the user's yes to each report. Off stops what waits in the outbox too. */
export const feedbackEnabled = root => settingNotOff(root, 'feedback');

export const setFeedback = (root, enabled) => setSetting(root, 'feedback', enabled);

/** Usage events go by themselves, from a machine enrolled with hobkin's server, until the user turns this off. */
export const telemetryUploadEnabled = root => settingNotOff(root, 'telemetryUpload');

export const setTelemetryUpload = (root, enabled) => setSetting(root, 'telemetryUpload', enabled);

export function readPersona(root) {
  root = resolveDataRoot(root);
  try {
    return validatePersona(loadConfig(root).persona);
  } catch (error) {
    if (error.code === 'ENOENT' && error.path === join(root, 'config.json')) return 'Normal';
    throw error;
  }
}

export function setPersona(root, persona) {
  persona = validatePersona(persona);
  atomicJson(join(resolveDataRoot(root), 'config.json'), { ...loadConfig(root), persona });
  return persona;
}

export function readResourceSelection(root, candidates) {
  const selection = validateResourceSelection(loadConfig(root).resourceSelection);
  resolveResourcePolicy(selection, 'main', candidates);
  return selection;
}

export function setResourceSelection(root, selection, candidates) {
  selection = validateResourceSelection(selection);
  resolveResourcePolicy(selection, 'main', candidates);
  const config = { ...loadConfig(root), resourceSelection: selection };
  if (Buffer.byteLength(`${JSON.stringify(config, null, 2)}\n`) > 65536) throw Error('Resource selection exceeds bounded configuration size.');
  atomicJson(join(resolveDataRoot(root), 'config.json'), config);
  return selection;
}

/** What each kind of agent loads of Pi's, as version 2 (`_specs/038-resources`). Version 1 or none reads as nothing chosen. */
export const readSelection = root => normalizeSelection(loadConfig(root).resourceSelection);

/** Turns ids on or off for one kind, checked against a catalog, and keeps the result in config.json within its bound. */
export function applySelection(root, change, catalog) {
  const current = loadConfig(root);
  const resourceSelection = changeSelection(normalizeSelection(current.resourceSelection), change, catalog);
  const config = { ...current, resourceSelection };
  if (Buffer.byteLength(`${JSON.stringify(config, null, 2)}\n`) > 65536) throw Error('Resource selection exceeds bounded configuration size.');
  atomicJson(join(resolveDataRoot(root), 'config.json'), config);
  return resourceSelection;
}

/** The most routines and `hobkin session` jobs that `concurrency` may let run at once. A new home starts at 2 (`initialize`). */
export const MOST_CONCURRENCY = 16;

export function validateConfig(config, { allowLegacyHarness = false } = {}) {
  if (
    config.version !== 2
    || !Number.isFinite(Date.parse(config.initializedAt))
    || !isAbsolute(config.main?.cwd ?? '')
  ) {
    throw Error('Invalid Hobkin configuration.');
  }
  validateBinding({ harness: 'pi', ...config.main }, { allowLegacyHarness });
  validateBinding(config.background, { allowLegacyHarness });
  validateLauncher(config.launcher);
  validatePersona(config.persona);
  // A version 2 selection is checked as one; every other value is checked as before.
  if (config.resourceSelection?.version === 2) normalizeSelection(config.resourceSelection);
  else validateResourceSelection(config.resourceSelection);
  validateTiers(config.tiers);
  validateReview(config.review);
  // Jobs have no automatic deadline; a timeoutMs left in older configs is ignored.
  if (!Number.isInteger(config.concurrency) || config.concurrency < 1 || config.concurrency > MOST_CONCURRENCY) {
    throw Error('Invalid execution limits.');
  }
  return config;
}

export function initialize(root, { cwd = process.cwd(), now = new Date().toISOString(), legacySources: sources = [] } = {}) {
  root = resolveDataRoot(root);
  if (existsSync(join(root, 'config.json'))) return loadConfig(root);
  if (sources.some(path => existsSync(path))) {
    throw Error('Legacy Hobkin data detected. A verified migration is required before initialization; nothing was changed.');
  }
  if (!isAbsolute(cwd) || !Number.isFinite(Date.parse(now))) throw Error('Initialization requires an absolute cwd and a valid date.');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!lstatSync(root).isDirectory()) throw Error('Hobkin home must be a real directory.');
  const routines = routinesFolder(root);
  for (const cadence of cadences) {
    mkdirSync(join(routines, cadence), { recursive: true, mode: 0o700 });
  }

  const guide = join(routines, 'README.md');
  try {
    writeFileSync(guide, readFileSync(new URL('../prompts/routine-setup.md', import.meta.url)), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const config = {
    version: 2,
    initializedAt: now,
    main: { cwd, model: null, effort: 'medium' },
    background: { harness: 'pi', model: null, effort: 'medium' },
    concurrency: 2,
  };
  try {
    atomicJson(join(root, 'config.json'), config, { exclusive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return loadConfig(root);
}
