import { homedir } from 'node:os';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { atomicJson, loadConfig } from './config.mjs';
import { postClientNotice } from './client-notices.mjs';
import { fileVersion } from './file-version.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { tierBinding, tierNames } from './tiers.mjs';

/**
 * Which of pi-extended-teams' tiers each of hobkin's drives, paired by what the work is for (the user, 2026-11-25:
 * "i also need a way to replicate the agent tiers into pi-extended-team tiers. so they share the same").
 */
export const teamsTiersOf = {
  fast: ['read-collect', 'write-patch'],
  mid: ['read-review', 'write-feature'],
  high: ['read-analyze', 'write-system'],
  max: ['read-critical', 'write-critical'],
};

/**
 * Where pi-extended-teams reads its tiers: its global settings under the user's home, whatever PI_CODING_AGENT_DIR says
 * (its `src/utils/settings.ts`). Its project files are never written: teams reads no tiers from them.
 */
export const teamsSettingsFile = home => join(home, '.pi', 'agent', 'pi-extended-teams', 'settings.json');

/**
 * The model and thinking level of each teams tier: what its hobkin tier runs on now, its own model or the one it follows.
 * A tier that follows a model Pi picks by itself names none, and its teams tiers are left as they are.
 */
export function teamsTiers(config) {
  const wanted = {};
  for (const name of tierNames) {
    const { model, effort } = tierBinding(config, name);
    if (!model) continue;
    for (const slot of teamsTiersOf[name]) wanted[slot] = { model, thinking: effort };
  }
  return wanted;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The settings in `file`, and the file a link there points to, or the problem that leaves them alone. A missing file holds none yet. */
function readTeamsSettings(file, slots) {
  let target = file;
  let text;
  try {
    const found = lstatSync(file, { throwIfNoEntry: false });
    if (!found) return { target, settings: {} };
    // A link is followed, so the file it names is the one written and the link stays.
    if (found.isSymbolicLink()) target = realpathSync(file);
    text = readFileSync(target, 'utf8');
  } catch (error) {
    return { problem: `cannot be read (${error.code ?? error.message})` };
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    return { problem: 'is not valid JSON' };
  }
  if (!isObject(settings)) return { problem: 'does not hold a settings object' };
  const favorites = settings.favoriteModels ?? {};
  if (!isObject(favorites)) return { problem: 'has favoriteModels that is not an object' };
  const odd = slots.find(slot => favorites[slot] != null && !isObject(favorites[slot]));
  if (odd) return { problem: `has a ${odd} tier that is not an object` };
  return { target, settings };
}

/**
 * Writes `wanted`, the tiers `teamsTiers` gives, into teams' settings at `file`. Only the model and thinking of those
 * tiers change: a tier's harness and other fields, the tiers hobkin has no say in and every other setting stay as they
 * are. Nothing is written when they already match. Answers `{ changed }`, or `{ problem }` for a file left alone.
 */
export function writeTeamsTiers(file, wanted) {
  const read = readTeamsSettings(file, Object.keys(wanted));
  if (read.problem) return read;
  const { target, settings } = read;
  const favoriteModels = { ...settings.favoriteModels };
  let changed = false;
  for (const [slot, { model, thinking }] of Object.entries(wanted)) {
    const tier = favoriteModels[slot] ?? {};
    if (tier.model === model && tier.thinking === thinking) continue;
    favoriteModels[slot] = { ...tier, model, thinking };
    changed = true;
  }
  if (!changed) return { changed };
  try {
    atomicJson(target, { ...settings, favoriteModels });
  } catch (error) {
    return { problem: `cannot be written (${error.code ?? error.message})` };
  }
  return { changed };
}

/** The file as the user knows it, from their home. */
const shown = file => (file.startsWith(`${homedir()}${sep}`) ? `~${file.slice(homedir().length)}` : file);

/**
 * Keeps pi-extended-teams' tiers equal to hobkin's while hobkin runs: on its first tick, and on any tick after
 * `config.json` changed the model or level a tier runs on. A tier the user changes in teams stays so until hobkin's
 * own changes. A file hobkin cannot make sense of is left alone and told once in Chat, and tried again when it changes.
 */
export class TeamsTiers {
  constructor({ root, home }) {
    this.root = root;
    this.config = join(resolveDataRoot(root), 'config.json');
    this.file = teamsSettingsFile(home);
  }

  tick() {
    const seen = fileVersion(this.config);
    const blocked = this.blocked === undefined ? undefined : fileVersion(this.file);
    if (seen === this.seen && blocked === this.blocked) return;
    this.seen = seen;
    let wanted;
    try {
      wanted = teamsTiers(loadConfig(this.root));
    } catch {
      // A configuration that cannot be read just now leaves teams' tiers as hobkin last wrote them.
      return;
    }
    const kept = JSON.stringify(wanted);
    if (kept === this.kept && this.blocked === undefined) return;
    const { problem } = writeTeamsTiers(this.file, wanted);
    if (!problem) {
      this.blocked = undefined;
      this.kept = kept;
      return;
    }
    this.blocked = fileVersion(this.file);
    postClientNotice(this.root, {
      key: `teams-tiers:${this.blocked ?? 'none'}`,
      line: `hobkin cannot keep pi-extended-teams' tiers equal to its own: ${shown(this.file)} ${problem}, so it was left as it is.`,
      tone: 'blocked',
    });
  }
}
