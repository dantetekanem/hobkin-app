import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEFT_OUT_OF_THE_MAIN_CHAT } from './pi-extensions.mjs';
import { SELECTION_KINDS } from './resource-policy.mjs';

/*
 * What Pi has on at user level, as hobkin offers it to each kind of agent (the client's `_specs/038-resources`). It is read
 * with Pi's own resolution, so nothing is installed or run to build it. Nothing running uses it yet.
 */

// hobkin has its own face, so this is offered to no kind. It stays installed in Pi.
export const NEVER_OFFERED = Object.freeze(['pi-emote']);
const BUILT_INS = {
  mcp: { name: 'MCP', line: 'The MCP servers Integrations has on' },
  'llama.cpp': { name: 'llama.cpp', line: 'Local models through llama.cpp' },
};
// The one file Pi takes from a folder, in its order (`loadContextFileFromDir`, Pi's dist/core/resource-loader.js).
const CONTEXT_NAMES = ['AGENTS.override.md', 'AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD'];
const MOST_MANIFEST_BYTES = 1048576;
const MOST_LINE_CHARS = 200;

const promptFile = name => ({ id: `prompt:${name}`, name: `${name}.md`, path: fileURLToPath(new URL(`../prompts/${name}.md`, import.meta.url)) });
const part = (id, name, more = {}) => ({ id, name, ...more });
/** What hobkin's own runs read, by kind. These always load and are never chosen. */
export const HOBKIN_INSTRUCTIONS = Object.freeze({
  main: [
    ...['prompt', 'taste', 'learning-context', 'v2-runtime', 'memory', 'canvas'].map(promptFile),
    part('persona', 'Persona'), part('directions', "hobkin's directions"), part('memory', 'Memory'), part('decided', 'Decided items'), part('tools', "hobkin's tools"),
  ],
  background: [
    promptFile('background'),
    ...[part('directions', "hobkin's directions"), part('memory', 'Memory'), part('routine-memory', "The routine's memory"), part('routine-log', "The routine's log")]
      .map(item => ({ ...item, routine: true })),
  ],
  work: [...['background', 'work-discover', 'work-look', 'work-do'].map(promptFile), part('directions', "hobkin's directions"), part('memory', 'Memory')],
  durable: ['durable', 'canvas'].map(promptFile),
});

const oneLine = text => (typeof text === 'string' ? text.replace(/[\p{Cc}\s]+/gu, ' ').trim().slice(0, MOST_LINE_CHARS) : '');

function samePlace(a, b) {
  const real = path => { try { return realpathSync(path); } catch { return resolve(path); } };
  return real(a) === real(b);
}

function manifest(folder) {
  try {
    const file = join(folder, 'package.json');
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MOST_MANIFEST_BYTES) return {};
    const value = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return { name: typeof value?.name === 'string' ? value.name : undefined, description: typeof value?.description === 'string' ? value.description : undefined };
  } catch {
    return {};
  }
}

function firstLine(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const bytes = Buffer.alloc(4096);
    const text = bytes.subarray(0, readSync(fd, bytes, 0, bytes.length, 0)).toString('utf8');
    return oneLine(text.split('\n').map(line => line.replace(/^#+/, '').trim()).find(Boolean));
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The one context file Pi takes from this folder, as Pi finds it: the first name in its order that is a file, a linked one included. */
export function contextFileIn(folder) {
  for (const name of CONTEXT_NAMES) {
    const file = join(folder, name);
    try {
      if (existsSync(file) && statSync(file).isFile()) return file;
    } catch {}
  }
  return undefined;
}

// Inside Pi's folder an id holds the path from there, so it reads the same on any Mac; outside it, the whole path.
const idPath = (path, agentDir) => {
  const inside = relative(agentDir, path);
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
};

function extensionName(path, agentDir) {
  const inFolder = relative(join(agentDir, 'extensions'), path);
  if (!inFolder.startsWith('..') && !isAbsolute(inFolder) && inFolder.includes(sep)) {
    const entry = inFolder.split(sep)[0];
    return { name: entry, folder: join(agentDir, 'extensions', entry) };
  }
  if (/^index\.[cm]?[jt]s$/.test(basename(path))) return { name: basename(dirname(path)), folder: dirname(path) };
  return { name: basename(path).replace(/\.[^.]+$/, ''), folder: undefined };
}

/** Each kind it is offered to, and for the others a code that says why. */
function offering(item) {
  const marks = item.type === 'package' || item.type === 'extension' || item.type === 'skill'
    ? new Set([item.name, item.name.split('/').at(-1), ...[item.from, ...item.paths.extensions, ...item.paths.skills].flatMap(path => path.split(sep))])
    : new Set();
  const never = NEVER_OFFERED.some(name => marks.has(name));
  const notMain = LEFT_OUT_OF_THE_MAIN_CHAT.some(name => marks.has(name));
  const notOffered = {};
  for (const kind of SELECTION_KINDS) {
    if (never) notOffered[kind] = 'hobkin-has-its-own-face';
    else if (kind === 'main' && notMain) notOffered[kind] = 'left-out-of-the-main-chat';
    else if (kind === 'main' && item.id === 'builtin:mcp') notOffered[kind] = 'no-mcp-in-the-main-chat';
  }
  return { ...item, offered: Object.fromEntries(SELECTION_KINDS.map(kind => [kind, !notOffered[kind]])), notOffered };
}

/**
 * The catalog of one Pi folder. The folder is always named, so a host started for development or a test reads its own and
 * never ~/.pi/agent. `cwd`, when given, is the folder a run works in, for `context:folder`; `root` is hobkin's home, whose
 * AGENTS.md is hobkin's directions and never comes in a second time as a folder's file.
 */
export async function buildCatalog({ agentDir, root, cwd } = {}) {
  if (typeof agentDir !== 'string' || !isAbsolute(agentDir)) {
    throw Error('The resource catalog needs the Pi folder it reads named as an absolute path, so it never falls back to ~/.pi/agent.');
  }
  if (cwd !== undefined && (typeof cwd !== 'string' || !isAbsolute(cwd))) throw Error('A run folder for the resource catalog must be absolute.');
  const { DefaultPackageManager, SettingsManager, loadProjectContextFiles, loadSkills } = await import('@earendil-works/pi-coding-agent');
  // An untrusted folder: Pi reads nothing of a folder's .pi, neither its settings nor its packages, extensions or skills.
  const settingsManager = SettingsManager.create(agentDir, agentDir, { projectTrusted: false });
  const manager = new DefaultPackageManager({ cwd: agentDir, agentDir, settingsManager, builtinExtensions: Object.keys(BUILT_INS) });
  // A package that is missing is skipped, never installed.
  const resolved = await manager.resolve(async () => 'skip');
  const warnings = [
    ...settingsManager.drainErrors().map(({ path, error }) => ({ path, message: oneLine(error?.message) })),
    ...(resolved.installFailures ?? []).map(({ source, message }) => ({ path: source, message: oneLine(message) })),
  ];
  const on = list => list.filter(found => found.enabled && found.metadata?.scope === 'user');
  // Pi also finds skills in $HOME/.agents. They are not Pi's folder or its settings, so they are not offered.
  const inPiFolder = found => found.metadata.origin === 'package' || found.metadata.source !== 'auto' || samePlace(found.metadata.baseDir ?? '', agentDir);
  const extensions = on(resolved.extensions);
  const skills = on(resolved.skills).filter(inPiFolder);
  const loaded = loadSkills({ cwd: agentDir, agentDir, skillPaths: skills.map(found => found.path), includeDefaults: false });
  const skillByPath = new Map(loaded.skills.map(found => [found.filePath, found]));
  const skillWarnings = paths => loaded.diagnostics.filter(item => paths.includes(item.path)).map(({ type, message }) => ({ type, message: oneLine(message) }));
  const skillName = path => skillByPath.get(path)?.name ?? basename(dirname(path));
  const blank = () => ({ extensions: [], skills: [], context: [] });

  const packages = new Map(), own = [], builtIns = [];
  const holder = found => {
    const { source } = found.metadata;
    if (!packages.has(source)) packages.set(source, { source, root: found.metadata.packageRoot, paths: blank() });
    return packages.get(source);
  };
  for (const found of extensions) {
    if (found.metadata.source === 'builtin') {
      const name = found.path.slice('builtin:'.length);
      if (BUILT_INS[name]) builtIns.push({ id: found.path, type: 'builtin', ...BUILT_INS[name], from: 'Pi', paths: { ...blank(), extensions: [found.path] } });
    } else if (found.metadata.origin === 'package') {
      holder(found).paths.extensions.push(found.path);
    } else {
      const { name, folder } = extensionName(found.path, agentDir);
      own.push({ id: `extension:${idPath(found.path, agentDir)}`, type: 'extension', name, line: oneLine(folder && manifest(folder).description),
        from: found.path, paths: { ...blank(), extensions: [found.path] } });
    }
  }
  for (const found of skills) {
    if (found.metadata.origin === 'package') {
      holder(found).paths.skills.push(found.path);
    } else {
      own.push({ id: `skill:${idPath(found.path, agentDir)}`, type: 'skill', name: skillName(found.path), line: oneLine(skillByPath.get(found.path)?.description),
        from: found.path, paths: { ...blank(), skills: [found.path] }, warnings: skillWarnings([found.path]) });
    }
  }
  const packageItems = [...packages.values()].map(({ source, root: packageRoot, paths }) => {
    const from = packageRoot ?? paths.extensions[0] ?? paths.skills[0];
    const about = packageRoot ? manifest(packageRoot) : {};
    return {
      id: `package:${source}`, type: 'package', source, name: about.name || basename(from), line: oneLine(about.description), from,
      holds: {
        extensions: paths.extensions.map(path => ({ name: (packageRoot && relative(packageRoot, path)) || basename(path), path })),
        skills: paths.skills.map(path => ({ name: skillName(path), path })),
      },
      paths, warnings: skillWarnings(paths.skills),
    };
  });

  const contextItems = [];
  const piFile = contextFileIn(agentDir);
  if (piFile) contextItems.push({ id: 'context:pi', type: 'context', name: basename(piFile), line: firstLine(piFile), from: piFile, paths: { ...blank(), context: [piFile] } });
  const leftOut = [agentDir, ...(root ? [root] : [])];
  const folderFiles = cwd
    ? loadProjectContextFiles({ cwd, agentDir }).map(file => file.path).filter(path => !leftOut.some(folder => samePlace(dirname(path), folder)))
    : [];
  contextItems.push({ id: 'context:folder', type: 'context', name: 'AGENTS.md and CLAUDE.md', line: 'From the folder a run works in and the folders above it',
    from: cwd ?? '', paths: { ...blank(), context: folderFiles } });

  const items = [...contextItems, ...packageItems, ...own.filter(item => item.type === 'extension'), ...own.filter(item => item.type === 'skill'), ...builtIns]
    .map(item => offering({ warnings: [], ...item }));
  return { version: 1, agentDir, items, hobkin: structuredClone(HOBKIN_INSTRUCTIONS), warnings };
}
