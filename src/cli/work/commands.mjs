import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDataRoot } from '../migration/admission.mjs';
import {
  answerAllowance, chooseProject, currentRequest, dailyLimit, dropProject, fileItem, isPacing, nextDiscoveryAt,
  nextLookAt, noteDiscovery, paths, proposeProject, readDiscovery, readItems, readMode, readProjects, readState,
  setDailyTokens, setHarness, skipProject, startWork, tokensToday, updateItem, writeMode,
} from './store.mjs';
import { removeTree } from './tree.mjs';

const USAGE = 'Usage: hobkin work [on [folder] | off | reset | harness <kind> | tokens <daily limit> | allow [tokens | no] | progress | propose | choose <slug or path> [level] | skip <slug> | drop <slug> | item <slug>]';

async function readJson(input) {
  let text = '';
  for await (const chunk of input) text += chunk;
  return JSON.parse(text);
}

/** Status for agents and for the Work tab. `open` and `prs` count what each project has going. */
export function workStatus(root) {
  const projects = readProjects(root).map(project => {
    const items = readItems(root, project.slug);
    return {
      ...project,
      open: items.filter(item => ['open', 'doing'].includes(item.state) && item.kind !== 'attention').length,
      prs: items.filter(item => item.state === 'pr').length,
      stuck: items.filter(item => item.state === 'stuck').length,
      nextLookAt: project.state === 'chosen' ? nextLookAt(root, project) : null,
      lookError: readState(root, project.slug).lookError ?? null,
    };
  });
  const attention = readProjects(root).flatMap(({ slug }) => readItems(root, slug)
    .filter(item => (item.kind === 'attention' && item.state === 'open') || item.state === 'stuck')
    .map(({ id, title, state }) => ({ slug, id, title, state })));
  const mode = readMode(root);
  const { enabled, folder, harness } = mode;
  const limit = dailyLimit(mode);
  const today = tokensToday(root);
  const pacing = isPacing(root, limit);
  return {
    enabled,
    folder,
    harness,
    dailyTokens: limit,
    tokensToday: today,
    pacing,
    paused: enabled && (pacing || today >= limit),
    allowanceRequest: enabled ? currentRequest(mode) : null,
    discovery: readDiscovery(root),
    nextDiscoveryAt: nextDiscoveryAt(mode),
    projects,
    attention,
  };
}

/** Forgets what work mode found, so the next start looks from nothing. Its folder, harness, limits and directions stay. */
async function resetWork(root) {
  const mode = readMode(root);
  if (mode.enabled) throw Error('Turn work mode off first, so nothing is running in the trees this removes.');
  const projects = readProjects(root);
  for (const { slug, path } of projects) {
    const { directory, lookTree, doTree } = paths(root, slug);
    for (const tree of [lookTree, doTree]) await removeTree({ repo: path, tree });
    rmSync(directory, { recursive: true, force: true });
  }
  const aside = join(root, 'runtime', `work-reset-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(aside, { recursive: true, mode: 0o700 });
  for (const name of ['projects.jsonl', 'discovery.jsonl']) {
    const file = join(root, 'work', name);
    if (existsSync(file)) renameSync(file, join(aside, name));
  }
  for (const check of readdirSync(join(root, 'checks'), { withFileTypes: true })) {
    if (check.isDirectory() && check.name.startsWith('work.')) rmSync(join(root, 'checks', check.name), { recursive: true, force: true });
  }
  writeMode(root, { lastDiscoveryAt: null });
  return { forgot: projects.length, kept: aside };
}

/** These take no lock. They only append or rewrite `mode.json`, and the owner picks that up on its next tick. */
export async function runWorkCommand(requestedRoot, [action, ...args], input) {
  const root = resolveDataRoot(requestedRoot);
  switch (action) {
    case undefined: return workStatus(root);
    case 'on': return startWork(root, args[0]);
    case 'off': return writeMode(root, { enabled: false });
    case 'reset': return resetWork(root);
    case 'harness': return setHarness(root, args[0]);
    case 'tokens': return setDailyTokens(root, Number(args[0]));
    case 'allow': {
      if (args[0] === 'no') return answerAllowance(root, false);
      return answerAllowance(root, args[0] ? Number(args[0]) : true);
    }
    case 'progress': return noteDiscovery(root, await readJson(input));
    case 'propose': return proposeProject(root, await readJson(input));
    case 'choose': return chooseProject(root, args[0], args[1]);
    case 'skip': return skipProject(root, args[0]);
    case 'drop': return dropProject(root, args[0]);
    case 'item': {
      const item = await readJson(input);
      return item.id ? updateItem(root, args[0], item.id, item) : fileItem(root, args[0], item);
    }
    default: throw Error(USAGE);
  }
}
