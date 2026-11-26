import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DIRECTIONS_KIND, directionsQuestion } from './pi-directions.mjs';

const language = readFileSync(new URL('../../prompts/learning-language.md', import.meta.url), 'utf8');
const OPENING = language.match(/^Opening line: (.+)$/m)[1];
const PROPOSAL = language.match(/^Proposal line: (.+)$/m)[1];
const templates = Object.fromEntries([...language.matchAll(/^\| ([a-z]+) \| ([+-]\{scope\} .+) \|$/gm)].map(([, code, line]) => [code, line]));

/** Hard ceiling on what any session is given, counted as it is sent. Spending it on one more whole lesson is the only way to reach it. */
export const MAX_TOKENS = 160;
const MAX_NAME_WORDS = 6;
const NAME = /^[a-z0-9][a-z0-9._-]{0,47}$/;
// A schedule ID or a repository name is the one word in a lesson that no one at Hobkin wrote, so it has to read as a name.
const INSTRUCTION_WORDS = /ignore|disregard|forget|override|bypass|instruction|prompt|exfil|curl|wget|sudo|password|credential|secret|token/;
// Counts move in steps so that a line stays byte for byte the same from one run to the next.
const SEEN_STEPS = [10, 5, 3, 2];
const WINDOW = 10;
const LATEST = 3;
const MIN_DAYS = 2;

// In order: the first that holds is the one lesson for that scope, so an agent is never told two things about it.
// `lasting` lessons outlive a few runs of something else. The rest must still be going on in the latest ones.
const patterns = [
  { code: 'blocked', minimum: 3, share: 0.5 },
  { code: 'failed', minimum: 3, share: 0.5 },
  // Replies are rare and deliberate, so two on different days outweigh any number of quiet runs.
  { code: 'rejected', minimum: 2, share: 0.2, lasting: true },
  { code: 'closed', minimum: 3, share: 0.5 },
  { code: 'stuck', minimum: 3, share: 0.5 },
  { code: 'quiet', minimum: 5, share: 0.8 },
  { code: 'unread', minimum: 5, share: 0.6, needsIgnored: true },
  { code: 'skipped', minimum: 3, share: 0.6 },
  { code: 'unmerged', minimum: 3, share: 0.5 },
  { code: 'used', minimum: 3, share: 0.6, lasting: true },
  { code: 'merged', minimum: 3, share: 0.6, lasting: true },
  { code: 'taken', minimum: 3, share: 0.6, lasting: true },
];

const conclusions = {
  used: ({ asked, requested }) => (asked + requested >= 3 ? 'ideas' : 'works'),
  merged: ({ seen }) => (seen >= 5 ? 'ideas' : 'works'),
  taken: () => 'works',
  blocked: ({ seen }) => (seen >= 5 ? 'rethink' : 'fails'),
  rejected: ({ seen }) => (seen >= 3 ? 'rethink' : 'fails'),
  unmerged: () => 'fails',
  closed: () => 'rethink',
  skipped: () => 'rethink',
  failed: () => 'refactor',
  stuck: () => 'refactor',
  quiet: () => 'refactor',
  unread: () => 'refactor',
};

/** The conclusions worth asking about. A check that works needs no proposal, and one that fails already said so in Chat. */
export const proposing = ['refactor', 'rethink', 'ideas'];

// No tokenizer ships with Hobkin, so this errs high: prose runs near 4 bytes a token, and these names and marks nearer 3.
export const tokensIn = text => Math.ceil(Buffer.byteLength(text) / 3);

// A request carries lessons as one JSON field, which costs more than the heading a brief puts them under, so it stands for both.
const inRequest = lines => JSON.stringify({ learning: lines });
export const requestTokens = lines => tokensIn(inRequest(lines));

const isName = scope => typeof scope === 'string' && NAME.test(scope) && !INSTRUCTION_WORDS.test(scope)
  && scope.split(/[._-]/).length <= MAX_NAME_WORDS;

/** A lesson holds codes and counts, never text. Anything else in a store, however it got there, renders as nothing. */
export function lessonLine({ scope, code, seen }) {
  if (!isName(scope) || !Object.hasOwn(templates, code) || !Number.isInteger(seen)) return null;
  const step = SEEN_STEPS.find(value => seen >= value);
  return step ? templates[code].replace('{scope}', scope).replace('{seen}', step) : null;
}

export const lessonId = ({ scope, code }) => createHash('sha256').update(`${scope}:${code}`).digest('hex').slice(0, 6);

const familyOf = scope => (scope.startsWith('work.') ? scope.split('.').slice(0, 2).join('.') : scope);

const rank = (lessons, scope) => lessons
  .flatMap(lesson => {
    const line = lessonLine(lesson);
    return line ? [{ ...lesson, line, own: familyOf(lesson.scope) === familyOf(scope) }] : [];
  })
  .toSorted((left, right) => right.own - left.own
    || Number(right.line.startsWith('-')) - Number(left.line.startsWith('-'))
    || right.seen - left.seen
    || left.scope.localeCompare(right.scope));

/**
 * What a session is given: the opening line and whole lessons up to the cap, its own first and then what to avoid.
 * With nothing to say it says nothing, so a session with no lessons costs nothing.
 */
export function renderLessons(lessons, scope = '', sentAs = inRequest) {
  const kept = [OPENING];
  for (const line of new Set(rank(lessons, scope).map(lesson => lesson.line))) {
    if (tokensIn(sentAs([...kept, line])) <= MAX_TOKENS) kept.push(line);
  }
  return kept.length > 1 ? kept : [];
}

/** What search can find. No session is sent this, so the cap has nothing to count, and it holds the same filtered lines and nothing else of a lesson. */
export function lessonsMarkdown(lessons) {
  const [opening, ...lines] = renderLessons(lessons, '', () => '');
  return opening ? `# Lessons\n\n${opening}\n\n${lines.map(line => `- ${line}`).join('\n')}\n` : '';
}

export const proposalLine = ({ id, kind, scope }) => PROPOSAL.replace('{id}', id).replace('{kind}', kind).replace('{scope}', scope);

const factOf = code => templates[code].match(/\{scope\} (.+) x\{seen\}/)[1];

/** The evidence, in words, from numbers alone. */
export function evidenceText({ code, seen, runs, days, usd }) {
  const cost = usd > 0 ? `, about $${usd.toFixed(2)} a run` : '';
  return `${factOf(code)} ${seen} of the last ${runs}, over ${days} ${days === 1 ? 'day' : 'days'}${cost}`;
}

const asks = {
  rethink: 'Rethink it?',
  refactor: 'Refactor it?',
  ideas: 'Want new ideas built on it?',
};

/** What a proposal asks the user, the same in Chat and in Action Items. One from Pi's AGENTS.md lists its rules. */
export const proposalQuestion = proposal => (proposal.kind === DIRECTIONS_KIND ? directionsQuestion(proposal)
  : `${proposal.title}: ${evidenceText(proposal)}. ${asks[proposal.kind]}`);

export const isLesson = lesson => Boolean(lesson) && typeof lesson.latest === 'string' && lessonLine(lesson) !== null;

// Everything an agent could be shown from a proposal has to pass here. Its title goes only to the user.
export const isProposal = proposal => isLesson(proposal)
  && proposing.includes(proposal.kind)
  && /^[0-9a-f]{6}$/.test(proposal.id ?? '')
  && Number.isInteger(proposal.runs)
  && Number.isInteger(proposal.days)
  && (proposal.usd === undefined || Number.isFinite(proposal.usd));

const daysIn = verdicts => new Set(verdicts.map(({ at }) => at.slice(0, 10))).size;

// A report nobody came for and one with nothing in it both went unused, so a check that is ignored counts both.
const supports = code => ({ is }) => is === code || (code === 'unread' && is === 'quiet');

function patternHolds({ code, minimum, share, lasting, needsIgnored }, recent, ignored) {
  const seen = recent.filter(supports(code));
  const latest = recent.slice(-LATEST).filter(supports(code)).length;
  const often = seen.length / recent.length >= share && (lasting || latest > 0);
  // A long good record must not hide a check that has just broken.
  const started = !lasting && latest === LATEST;

  return seen.length >= minimum
    && (often || started)
    && (!needsIgnored || ignored)
    && daysIn(seen) >= MIN_DAYS;
}

/** What a scope's latest runs add up to. Mixed evidence teaches nothing, and a pattern that has stopped is no longer true. */
export function conclude({ verdicts, ignored = false, ...subject }) {
  const recent = verdicts.toSorted((left, right) => left.at.localeCompare(right.at)).slice(-WINDOW);
  const code = patterns.find(pattern => patternHolds(pattern, recent, ignored))?.code;
  if (!code) return { ...subject, runs: recent.length };

  const supporting = recent.filter(supports(code));
  const seen = supporting.length;
  const asked = recent.filter(({ by }) => by === 'asked').length;
  const requested = recent.filter(({ by }) => by === 'requested').length;
  const spent = recent.reduce((sum, { usd = 0 }) => sum + usd, 0);

  return {
    ...subject,
    runs: recent.length,
    id: lessonId({ scope: subject.scope, code }),
    code,
    seen,
    days: daysIn(supporting),
    latest: supporting.at(-1).at,
    conclusion: conclusions[code]({ seen, asked, requested }),
    ...(spent > 0 ? { usd: spent / recent.length } : {}),
  };
}
