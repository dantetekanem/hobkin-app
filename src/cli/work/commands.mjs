import { resolveDataRoot } from '../migration/admission.mjs';
import {
  chooseProject, dropProject, fileItem, proposeProject, readItems, readMode, readProjects, skipProject, startWork, updateItem, writeMode,
} from './store.mjs';

const USAGE = 'Usage: pi-companion work [on [folder] | off | propose | choose <slug or path> [level] | skip <slug> | drop <slug> | item <slug>]';

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
    };
  });
  const attention = readProjects(root).flatMap(({ slug }) => readItems(root, slug)
    .filter(item => (item.kind === 'attention' && item.state === 'open') || item.state === 'stuck')
    .map(({ id, title, state }) => ({ slug, id, title, state })));
  const { enabled, folder } = readMode(root);
  return { enabled, folder, projects, attention };
}

/** These take no lock. They only append or rewrite `mode.json`, and the owner picks that up on its next tick. */
export async function runWorkCommand(requestedRoot, [action, ...args], input) {
  const root = resolveDataRoot(requestedRoot);
  switch (action) {
    case undefined: return workStatus(root);
    case 'on': return startWork(root, args[0]);
    case 'off': return writeMode(root, { enabled: false });
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
