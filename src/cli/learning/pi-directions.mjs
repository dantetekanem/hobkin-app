import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson } from '../config.mjs';

/*
 * What hobkin learned from Pi's own AGENTS.md (the client's `_specs/038-resources`, A23). Pi's file still loads into no
 * run. When it changes, one fixed run lists the rules it has that Your directions lack, and hobkin files them as one
 * learning proposal. This file keeps the version last looked at and that proposal, in hobkin's own data root.
 */

export const DIRECTIONS_KIND = 'directions';
const SCOPE = 'pi-directions';
export const MOST_RULES = 20;
export const MOST_RULE_CHARS = 600;
const MAX_STATE_BYTES = 65536;
// Asked later, the proposal waits this long before it comes back, as learning's others do.
const LATER_MS = 7 * 24 * 3600000;
const EMPTY = { looked: null, proposal: null };

const statePath = root => join(root, 'runtime', 'pi-directions.json');
const iso = time => new Date(time).toISOString();

export const versionOf = text => createHash('sha256').update(text).digest('hex');

const isRule = rule => typeof rule === 'string' && rule.trim() !== '' && !/[\p{Cc}]/u.test(rule) && rule.length <= MOST_RULE_CHARS;
const isDirectionsProposal = proposal => proposal?.kind === DIRECTIONS_KIND
  && /^[0-9a-f]{6}$/.test(proposal.id ?? '')
  && Number.isFinite(Date.parse(proposal.at))
  && Array.isArray(proposal.rules) && proposal.rules.length > 0 && proposal.rules.length <= MOST_RULES && proposal.rules.every(isRule);

/** The version last looked at and the proposal it filed. A file that is missing, damaged or shared counts as none, so Pi's file is looked at again. */
export function readPiDirections(root) {
  try {
    const file = statePath(root);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    // Whatever can write this file can speak to the main agent, so a link or a shared file counts as no file at all.
    if (!stat?.isFile() || (stat.mode & 0o077) || stat.size > MAX_STATE_BYTES) return EMPTY;
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved?.version !== 1 || typeof saved.looked !== 'string') return EMPTY;
    return { looked: saved.looked, proposal: isDirectionsProposal(saved.proposal) ? saved.proposal : null };
  } catch {
    return EMPTY;
  }
}

/** One look at a version, with the rules it found. That version is not looked at again, and its proposal, if any, replaces the one before. */
export function recordLook(root, version, rules, now) {
  const at = iso(now);
  const proposal = rules.length ? {
    id: createHash('sha256').update(`${SCOPE}:${version}:${at}`).digest('hex').slice(0, 6),
    scope: SCOPE,
    kind: DIRECTIONS_KIND,
    title: "Rules from Pi's AGENTS.md",
    rules,
    definition: version,
    at,
    latest: at,
  } : null;
  atomicJson(statePath(root), { version: 1, looked: version, at, proposal });
  return proposal;
}

/** The proposal as it stands. A week after a later it is raised again, under a newer time, so it is asked anew. */
export function piDirectionsProposals(root, answers, now = Date.now()) {
  const { proposal } = readPiDirections(root);
  if (!proposal) return [];
  const putOff = Math.max(-Infinity, ...answers
    .filter(entry => entry.id === proposal.id && entry.answer === 'later')
    .map(entry => Date.parse(entry.at)));
  const back = putOff >= Date.parse(proposal.at) && now >= putOff + LATER_MS;
  return [back ? { ...proposal, at: iso(putOff + LATER_MS) } : proposal];
}

const them = ({ rules }) => (rules.length === 1 ? 'it' : 'them');

/** What the proposal asks the user, the same in Chat and in Action Items. */
export function directionsQuestion(proposal) {
  const { rules } = proposal;
  const count = rules.length === 1 ? 'one rule' : `${rules.length} rules`;
  return `Pi's AGENTS.md has ${count} that Your directions lack:\n${rules.map(rule => `- ${rule}`).join('\n')}\nAdd ${them(proposal)} to Your directions?`;
}

/** What the main agent is handed with the user's yes. */
export const directionsMessage = proposal => `**Learning:** ${directionsQuestion(proposal)} Say yes to add ${them(proposal)} to AGENTS.md as short rules, later to be asked again in a week, or no to leave ${them(proposal)} out until Pi's AGENTS.md changes.`;
