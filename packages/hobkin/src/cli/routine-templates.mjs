import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './config.mjs';
import { routinesFolder } from './schedules.mjs';

export const TEMPLATE_GROUPS = ['day', 'code', 'week', 'life', 'machine'];
const EFFORTS = ['low', 'medium', 'high'];
const WHOLE_NUMBER = /^[1-9]\d*$/;
const REQUIRED = ['title', 'summary', 'recurrence', 'group', 'fits'];
// A template is named for what it does. README.md, RULES.md or any other file named another way is about templates, not one.
const TEMPLATE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const LARGEST_TEMPLATE = 16384;

const shipped = fileURLToPath(new URL('../prompts/routine-templates/', import.meta.url));

/** Where the user's own templates go, beside their routines. The routine loader reads only its cadence folders, so these never run. */
export const yourTemplates = root => join(routinesFolder(root), 'templates');

/** The header is plain `key: value` lines between two `---` lines, so a person can write one by hand. */
function readHeader(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) throw Error('needs a header between two --- lines at the top');
  const header = {};
  for (const line of match[1].split('\n').filter(entry => entry.trim())) {
    const colon = line.indexOf(':');
    if (colon < 1) throw Error(`has a header line with no key: ${line.trim()}`);
    header[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return header;
}

function readTemplate(file, source) {
  const stat = lstatSync(file);
  if (!stat.isFile()) throw Error('must be a regular file, not a link');
  if (stat.size > LARGEST_TEMPLATE) throw Error('is too large');
  const header = readHeader(readFileSync(file, 'utf8'));
  const missing = REQUIRED.filter(key => !header[key]);
  if (missing.length) throw Error(`needs ${missing.join(', ')} in its header`);
  if (!TEMPLATE_GROUPS.includes(header.group)) throw Error(`has the group ${header.group}, and a group is one of ${TEMPLATE_GROUPS.join(', ')}`);
  const effort = header.effort || 'medium';
  if (!EFFORTS.includes(effort)) throw Error(`has the effort ${effort}, and an effort is one of ${EFFORTS.join(', ')}`);
  const version = header.version || '1';
  if (!WHOLE_NUMBER.test(version)) throw Error(`has the version ${version}, and a version is a whole number from 1`);
  return {
    id: basename(file, '.md'),
    title: header.title,
    summary: header.summary,
    recurrence: header.recurrence,
    group: header.group,
    needs: header.needs ? header.needs.split(',').map(need => need.trim()).filter(Boolean) : [],
    effort,
    fits: header.fits,
    asks: header.asks || null,
    version: Number(version),
    file,
    source,
  };
}

function readFolder(folder, source) {
  const found = { templates: [], errors: [] };
  if (!existsSync(folder)) return found;
  for (const name of readdirSync(folder).filter(entry => TEMPLATE_NAME.test(entry))) {
    const file = join(folder, name);
    try {
      found.templates.push(readTemplate(file, source));
    } catch (error) {
      found.errors.push({ file, message: `${name} ${error.message}` });
    }
  }
  return found;
}

const inMenuOrder = (first, second) => TEMPLATE_GROUPS.indexOf(first.group) - TEMPLATE_GROUPS.indexOf(second.group) || first.id.localeCompare(second.id);

const seenPath = root => join(root, 'runtime', 'templates-seen.json');

function readSeen(root) {
  try {
    return JSON.parse(readFileSync(seenPath(root), 'utf8')).seen ?? null;
  } catch {
    return null;
  }
}

/**
 * hobkin's own templates the user has not heard of yet, by name and version, from what an earlier open saw. A newer version is news too,
 * because a routine made from the old one does not change by itself. The first look only remembers, because setup offers them all anyway.
 * Templates of the user's own are never news, and what this returns is remembered as told.
 */
export function templateNews(root) {
  const shippedNow = readFolder(shipped, 'hobkin').templates;
  const seen = readSeen(root);
  const added = seen ? shippedNow.filter(({ id }) => seen[id] === undefined) : [];
  const updated = seen ? shippedNow.filter(({ id, version }) => seen[id] !== undefined && version > seen[id]) : [];
  if (!seen || added.length || updated.length) {
    const versions = Object.fromEntries(shippedNow.map(({ id, version }) => [id, version]));
    atomicJson(seenPath(root), { version: 1, seen: { ...seen, ...versions } });
  }
  return { added, updated };
}

const titlesOf = templates => {
  const titles = templates.map(({ title }) => title);
  return titles.length > 1 ? `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}` : titles[0];
};

/** One line for Chat about what an update brought, or null when it brought nothing. */
export function templateNotice({ added, updated }) {
  const parts = [
    added.length && `${added.length === 1 ? 'A new routine template' : `${added.length} new routine templates`}: ${titlesOf(added)}.`,
    updated.length && `Updated: ${titlesOf(updated)}.`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(' ')} Each waits in Action Items, and hobkin routines templates lists them all.` : null;
}

/**
 * What setup can offer: hobkin's templates and the user's own, one per name, with the user's winning. Adding one is adding a file.
 * A template that cannot be read is reported, not listed. `rules` go into every routine made from a template.
 */
export function listTemplates(root) {
  const own = readFolder(shipped, 'hobkin');
  const theirs = readFolder(yourTemplates(root), 'yours');
  const replaced = new Set(theirs.templates.map(({ id }) => id));
  return {
    rules: readFileSync(join(shipped, 'RULES.md'), 'utf8').trim(),
    templates: [...own.templates.filter(({ id }) => !replaced.has(id)), ...theirs.templates].toSorted(inMenuOrder),
    errors: [...own.errors, ...theirs.errors],
  };
}
