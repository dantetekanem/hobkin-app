import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from '../config.mjs';
import { findJava, jarPath } from '../proof/tools.mjs';
import { paths, readJson } from './store.mjs';

/**
 * The state machines a project's state-machines look found (_specs/050-tla-proofs), as it pipes them to `hobkin work machines <project>`: each
 * machine's name and the files it lives in, with the time and whether Java and TLC were found when the list came in. Readiness reads it, and a
 * change to a machine's file that no model covers is sent back to its branch for that model (`yolo-pass.mjs`). The prose under "State
 * machines" in the project file is the look's notes, and nothing here reads it.
 */

const MOST_MACHINES = 100;
const MOST_FILES = 100;
const LONGEST_NAME = 80;

const machinesFile = (root, slug) => join(paths(root, slug).directory, 'machines.json');

/**
 * Whether the TLA+ tools are in this home, without waiting for Java to answer. Setup puts the pinned jar in only after it found Java or
 * installed it, so the jar stands for both.
 */
export const toolsHere = root => existsSync(jarPath(root));

/** Whether a check could run now: the pinned jar is here and a Java that TLC can use answers. Java is asked only when the jar is here. */
export const toolsFound = async root => toolsHere(root) && Boolean((await findJava({ home: root })).path);

/** The last list a look recorded, or null when none has. */
export const readMachines = (root, slug) => readJson(machinesFile(root, slug), null);

const isOneLine = text => typeof text === 'string' && text.trim().length > 0 && !/[\r\n]/.test(text);
const projectPath = path => (typeof path === 'string' ? path.trim().replace(/^\.\//, '') : '');
const insideProject = path => isOneLine(path) && !path.startsWith('/') && !path.split('/').includes('..');

function machineOf({ name, files } = {}) {
  if (!isOneLine(name) || name.trim().length > LONGEST_NAME) throw Error(`name is the machine's name, in one line of at most ${LONGEST_NAME} characters.`);
  const paths = Array.isArray(files) ? files.map(projectPath) : [];
  if (!paths.length || paths.length > MOST_FILES || !paths.every(insideProject)) {
    throw Error(`files are the paths in the project that ${name.trim()} lives in, from its top folder: at least one and at most ${MOST_FILES}.`);
  }
  return { name: name.trim(), files: [...new Set(paths)] };
}

/**
 * What one state-machines look found, replacing the last list. `tlc` is hobkin's own word on whether the tools were found, never the look's.
 * An empty list says the look found no machine.
 */
export function recordMachines(root, slug, report, { tlc, now = Date.now() } = {}) {
  if (!Array.isArray(report?.machines) || report.machines.length > MOST_MACHINES) {
    throw Error(`machines is a list of each state machine the look found, at most ${MOST_MACHINES}, and an empty list when it found none.`);
  }
  const record = { at: new Date(now).toISOString(), tlc: tlc === true, machines: report.machines.map(machineOf) };
  atomicJson(machinesFile(root, slug), record);
  return record;
}

/**
 * The machines a change touches with no model to answer for it: each one with the files it touches that no spec at the change's head names.
 * `unit` is the survey's, whose `models` say which touched files each covering spec names.
 */
export function unmodeledIn(machines = [], unit = {}) {
  const touched = new Set(unit.paths ?? []);
  const covered = new Set((unit.models ?? []).flatMap(({ covers = [] }) => covers));
  return machines
    .map(({ name, files }) => ({ name, files: files.filter(file => touched.has(file) && !covered.has(file)) }))
    .filter(({ files }) => files.length);
}
