import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { atomicJson, loadConfig } from './config.mjs';
import { cadences, efforts, loadSchedules, routinesFolder } from './schedules.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { assertTier, reviewTiers, tierBinding, tierNames, validateReview } from './tiers.mjs';

// A tier is a scope of its own, by its name. `all` is the chat, the checks and the routines, as it always was.
const scopes = ['main', 'background', 'routines', 'all', ...tierNames];
function selected(scope) {
  if (!scopes.includes(scope)) throw Error(`scope must be one of: ${scopes.join(', ')}`);
  return { main: scope === 'main' || scope === 'all', background: scope === 'background' || scope === 'all', routines: scope === 'routines' || scope === 'all', tier: tierNames.includes(scope) ? scope : null };
}
/** Every tier as it runs now, so asking for one shows them all: its own model and effort, or whose it follows. */
const tiersOf = config => Object.fromEntries(tierNames.map(name => {
  const { model, effort, follows } = tierBinding(config, name);
  return [name, { model, effort, follows }];
}));
function inspect(root, scope, scheduleId) {
  const targets = selected(scope);
  if (scheduleId !== undefined && scope !== 'routines') throw Error('routineId needs scope routines.');
  const config = loadConfig(root);
  let schedules = [];
  if (targets.routines) {
    const loaded = loadSchedules(root);
    const dirs = cadences.map(cadence => join(routinesFolder(root), cadence));
    const errors = loaded.errors.filter(item => dirs.some(dir => item.path === dir || item.path.startsWith(`${dir}${sep}`)));
    if (errors.length) throw Error(`Cannot update routines with invalid native bindings: ${errors.map(item => item.path).join(', ')}`);
    schedules = loaded.schedules.filter(item => item.cadence !== 'compatibility'
      && (scheduleId === undefined || item.id === scheduleId));
    if (scheduleId !== undefined && !schedules.length) throw Error(`Unknown routine: ${scheduleId}`);
  }
  return { targets, config, schedules };
}
function snapshot(scope, { targets, config, schedules }) {
  return {
    scope,
    ...(targets.main ? { main: { model: config.main.model, effort: config.main.effort } } : {}),
    ...(targets.background ? { background: { harness: config.background.harness, model: config.background.model, effort: config.background.effort } } : {}),
    ...(targets.routines ? { routines: schedules.map(({ id, cadence, enabled, harness, model, effort }) => ({ id, cadence, enabled, harness, model, effort })) } : {}),
    ...(targets.tier ? { tiers: tiersOf(config) } : {}),
  };
}
export function readSettings(root, scope = 'all', scheduleId) {
  return snapshot(scope, inspect(resolveDataRoot(root), scope, scheduleId));
}
function resolveModel(reference, modelRuntime) {
  if (typeof reference !== 'string' || /[\s\x00-\x1f\x7f]/.test(reference)) throw Error('model must be fully qualified as provider/model');
  const slash = reference.indexOf('/');
  if (slash < 1 || slash === reference.length - 1) throw Error('model must be fully qualified as provider/model');
  const provider = reference.slice(0, slash);
  const id = reference.slice(slash + 1);
  const model = modelRuntime?.getModel(provider, id);
  if (!model || model.provider !== provider || model.id !== id) throw Error(`Model is not installed in the Pi catalog: ${reference}`);
  // The conversation reopens on the saved model, so one it cannot use must never be saved.
  if (modelRuntime.hasConfiguredAuth?.(provider) === false) throw Error(`No credentials for ${provider}.`);
  return model;
}
const catalogModel = (reference, modelRuntime) => {
  const slash = reference?.indexOf('/') ?? -1;
  return slash > 0 ? modelRuntime?.getModel(reference.slice(0, slash), reference.slice(slash + 1)) : undefined;
};
// A check fails rather than run at a level Pi would clamp, so a level it can never use must not be saved.
function assertRunnable(schedules, model, effort, modelRuntime) {
  for (const schedule of schedules) {
    const target = model ?? catalogModel(schedule.model, modelRuntime);
    const level = effort ?? schedule.effort;
    const supported = target ? getSupportedThinkingLevels(target) : [level];
    if (!supported.includes(level)) {
      throw Error(`${schedule.id} cannot run at ${level} on ${target.provider}/${target.id}, which offers ${supported.join(', ')}.`);
    }
  }
}
function writeSchedule(path, model, effort) {
  const stat = lstatSync(path);
  if (!stat.isFile()) throw Error(`Routine is not a regular file: ${path}`);
  const source = readFileSync(path, 'utf8');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw Error(`Invalid routine frontmatter: ${path}`);
  const metadata = JSON.parse(match[1]);
  if (model !== undefined) metadata.model = `${model.provider}/${model.id}`;
  if (effort !== undefined) metadata.effort = effort;
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `---\n${JSON.stringify(metadata, null, 2)}\n---\n${source.slice(match[0].length)}`, { flag: 'wx', mode: stat.mode & 0o777 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export async function updateSettings(root, request, { modelRuntime, applyCurrent } = {}) {
  root = resolveDataRoot(root);
  const { scope, scheduleId, model: reference, effort } = request ?? {};
  const state = inspect(root, scope, scheduleId);
  if (reference === undefined && effort === undefined) throw Error('Specify model, effort, or both.');
  const bindings = [
    ...(state.targets.tier ? [{ scope: state.targets.tier, harness: 'pi' }] : []),
    ...(state.targets.main ? [{ scope: 'main', harness: 'pi' }] : []),
    ...(state.targets.background ? [{ scope: 'background', harness: state.config.background.harness }] : []),
    ...state.schedules.map(item => ({ scope: `routines:${item.id}`, harness: item.harness, path: item.path })),
  ];
  const incompatible = bindings.filter(item => (reference !== undefined && item.harness !== 'pi') || (effort !== undefined && !efforts[item.harness]?.includes(effort)));
  if (incompatible.length) {
    const incompatibleScopes = incompatible.map(item => item.scope);
    return {
      scope, error: `Requested model/effort settings are incompatible with target harnesses: ${incompatibleScopes.join(', ')}; nothing changed`,
      persisted: { status: 'unchanged', settings: snapshot(scope, state), completed: [] },
      activeRuntime: { status: 'unchanged', reason: 'cross-harness preflight rejected the update' },
      unchangedScopes: [...new Set([...scopesFor(state.targets), ...bindings.filter(item => item.harness === 'pi').map(item => item.scope)])], incompatibleScopes,
    };
  }
  const resolved = reference === undefined ? undefined : resolveModel(reference, modelRuntime);
  assertRunnable(state.schedules, resolved, effort, modelRuntime);
  const initial = snapshot(scope, state);
  const config = state.config;
  if (state.targets.tier) {
    // A tier holds a model and an effort of its own: what it was not given now, it keeps, or takes from the one it followed.
    const now = tierBinding(config, state.targets.tier);
    const model = resolved ? `${resolved.provider}/${resolved.id}` : now.model;
    if (!model) throw Error(`Name a model for the ${state.targets.tier} tier: the one it follows has none set.`);
    const level = effort ?? now.effort;
    const target = resolved ?? catalogModel(model, modelRuntime);
    const supported = target ? getSupportedThinkingLevels(target) : [level];
    if (!supported.includes(level)) throw Error(`The ${state.targets.tier} tier cannot run at ${level} on ${model}, which offers ${supported.join(', ')}.`);
    config.tiers = { ...config.tiers, [state.targets.tier]: { model, effort: level } };
  }
  if (state.targets.main) {
    if (resolved) config.main.model = `${resolved.provider}/${resolved.id}`;
    if (effort !== undefined) config.main.effort = effort;
  }
  if (state.targets.background) {
    if (resolved) config.background.model = `${resolved.provider}/${resolved.id}`;
    if (effort !== undefined) config.background.effort = effort;
  }
  const targetNames = bindings.map(item => item.scope);
  const completed = [];
  let attempting = 'config.json';
  try {
    if (state.targets.main || state.targets.background || state.targets.tier) {
      atomicJson(join(root, 'config.json'), config);
      if (state.targets.tier) completed.push(state.targets.tier);
      if (state.targets.main) completed.push('main');
      if (state.targets.background) completed.push('background');
    }
    for (const item of state.schedules) {
      attempting = `routines:${item.id}`;
      writeSchedule(item.path, resolved, effort);
      completed.push(attempting);
    }
  } catch (error) {
    const settings = safeSnapshot(root, scope, scheduleId);
    const changed = JSON.stringify(settings) !== JSON.stringify(initial);
    return { scope, persisted: { status: changed ? 'partial' : 'failed', settings, completed, failed: { target: attempting, error: error.message }, notWritten: targetNames.filter(name => !completed.includes(name) && name !== attempting) }, activeRuntime: { status: 'unchanged', reason: 'not attempted because persistence was incomplete' }, unchangedScopes: scopesFor(state.targets) };
  }
  let activeRuntime = state.targets.main ? { status: 'unchanged', reason: 'no active-session setter supplied' } : { status: 'unchanged', reason: 'scope excludes the current conversation' };
  if (state.targets.main && applyCurrent) {
    try {
      const effective = await applyCurrent({ model: resolved, effort });
      const observedBinding = effective && typeof effective === 'object' && !Array.isArray(effective);
      const expectedModel = resolved ? `${resolved.provider}/${resolved.id}` : undefined;
      const matchesRequest = observedBinding
        && (expectedModel === undefined || effective.model === expectedModel)
        && (effort === undefined || effective.effort === effort);
      activeRuntime = matchesRequest
        ? { status: 'verified', effective }
        : observedBinding ? { status: 'unverified', effective } : { status: 'unverified' };
    } catch (error) {
      const effective = error && typeof error === 'object' ? error.effective : undefined;
      activeRuntime = {
        status: 'unverified',
        ...(effective && typeof effective === 'object' ? { effective } : {}),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { scope, persisted: { status: 'complete', settings: safeSnapshot(root, scope, scheduleId), completed }, activeRuntime, unchangedScopes: scopesFor(state.targets) };
}
/** The tiers as a settings window shows them: the chat's own model, every tier as it runs now, and the tier of each review role. */
export function readTiers(root) {
  const config = loadConfig(resolveDataRoot(root));
  return { main: { model: config.main.model, effort: config.main.effort }, tiers: tiersOf(config), review: reviewTiers(config) };
}

/**
 * Saves tiers and review tiers in one write, or nothing at all. `tiers` gives a tier a model and an effort of its own,
 * or null to let it follow again; `review` names the tier of a review role. Every model is checked against Pi's
 * catalog and credentials, and every effort against what its model offers, before anything is written.
 */
export async function updateTiers(root, { tiers = {}, review = {} } = {}, { modelRuntime } = {}) {
  root = resolveDataRoot(root);
  const config = loadConfig(root);
  const own = { ...config.tiers };
  for (const [name, setting] of Object.entries(tiers)) {
    assertTier(name);
    if (setting === null) {
      delete own[name];
      continue;
    }
    const model = resolveModel(setting?.model, modelRuntime);
    const supported = getSupportedThinkingLevels(model);
    if (!supported.includes(setting.effort)) throw Error(`The ${name} tier cannot run at ${setting.effort} on ${setting.model}, which offers ${supported.join(', ')}.`);
    own[name] = { model: `${model.provider}/${model.id}`, effort: setting.effort };
  }
  validateReview(review);
  const next = { ...config, tiers: own, ...(Object.keys(review).length || config.review ? { review: { ...reviewTiers(config), ...review } } : {}) };
  if (!Object.keys(own).length) delete next.tiers;
  atomicJson(join(root, 'config.json'), next);
  return readTiers(root);
}

function scopesFor(targets) { return ['main', 'background', 'routines'].filter(scope => !targets[scope]); }
function safeSnapshot(root, scope, scheduleId) { try { return readSettings(root, scope, scheduleId); } catch (error) { return { error: error.message }; } }
