import { atomicJson } from '../config.mjs';
import { paths, readKeptJson } from './store.mjs';

const DAY_MS = 86400000;
const SIGNALS_EVERY_MS = 30 * DAY_MS;
// A look that recorded nothing comes round again, but not on every tick.
const SIGNALS_RETRY_MS = DAY_MS;
// Below this nothing shows requests or runs, so there is nothing for a watch look to read.
const FIRST_WATCHED_SIGNAL = 2;
const wantedBy = { service: 4, app: 4, site: 3, package: 1, tool: 1 };
const projectTypes = Object.keys(wantedBy);
// These answer while the process is up, whatever the app behind them is doing.
const BARE_PING = /^\/(up|health|healthz|healthcheck|ping|status|ready|live)\/?$/i;

const said = text => typeof text === 'string' && text.trim().length > 0;
const ran = proof => said(proof?.command) && said(proof?.saw);

function isWebAddress(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

const answered = ({ url, status }) => isWebAddress(url) && Number.isInteger(status) && status >= 200 && status < 400;
const realPage = ({ url, page }) => page === true && isWebAddress(url) && !BARE_PING.test(new URL(url).pathname);
const proveItIsUp = health => Boolean(health) && (ran(health.smoke) || realPage(health));

// In order, because each signal says hobkin can do everything the ones below it can.
const steps = [
  ['deploy', ({ deploy }) => ran(deploy)],
  ['logs', ({ logs }) => ran(logs)],
  ['probe', ({ health }) => proveItIsUp(health)],
  ['errors', ({ errors }) => ran(errors) && errors.grouped === true && errors.release === true],
];

export const readSignals = (root, slug) => readKeptJson(paths(root, slug).signals, null);

export function signalOf(signals) {
  const first = steps.findIndex(([, proved]) => !proved(signals));
  return first < 0 ? steps.length : first;
}

/** The keys of the items that would take a project up to what it wants. */
export const signalGaps = signals => steps.slice(0, signals.wants).filter(([, proved]) => !proved(signals)).map(([name]) => `signal:${name}`);

/** No signals yet is not being under anything: nobody has looked. */
export const belowWanted = signals => Boolean(signals) && signals.signal < signals.wants;

export const canWatch = signals => (signals?.signal ?? 0) >= FIRST_WATCHED_SIGNAL;

export function signalsDue(signals, lastSignalsAt, now) {
  if (lastSignalsAt && now - Date.parse(lastSignalsAt) < SIGNALS_RETRY_MS) return false;
  return !signals || now - Date.parse(signals.checkedAt) >= SIGNALS_EVERY_MS;
}

function assertRan(name, proof) {
  if (proof !== null && !ran(proof)) throw Error(`${name} needs the command you ran and what it printed, as command and saw. Leave out what you did not run.`);
}

function assertHealth(health) {
  if (health === null || ran(health.smoke) || answered(health)) return;
  throw Error('health needs an http or https url with the status it answered, or a smoke command and what it printed.');
}

/** A run says what it ran. The number, what is wanted and the date are hobkin's, so nothing a run sends can set them. */
function checked({ type, deploy = null, logs = null, errors = null, health = null, flags = null, rollback = null }) {
  if (!projectTypes.includes(type)) throw Error(`type must be one of: ${projectTypes.join(', ')}`);
  assertRan('deploy', deploy);
  assertRan('logs', logs);
  assertRan('errors', errors);
  assertHealth(health);
  return { type, deploy, logs, errors, health, flags, rollback };
}

export function recordSignals(root, slug, report, now = Date.now()) {
  const proved = checked(report);
  const signals = {
    ...proved,
    signal: signalOf(proved),
    wants: wantedBy[proved.type],
    checkedAt: new Date(now).toISOString(),
  };
  atomicJson(paths(root, slug).signals, signals);
  return signals;
}
