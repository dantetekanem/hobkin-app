import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { learningEnabled } from '../config.mjs';
import { readItems, readProjects } from '../work/store.mjs';
import { gatherEvidence, rejectsReport, stillOpen } from './judge.mjs';
import { conclude, proposalLine, proposalQuestion, proposing, renderLessons } from './lessons.mjs';
import { learningNote, NO_LEARNING, noteInContext } from './note.mjs';
import { appendAction, learningState, readActions, readState, saveState } from './store.mjs';

const HOUR_MS = 3600000;
const SETTLE_EVERY_MS = HOUR_MS / 6;
const PULL_REQUEST_EVERY_MS = 6 * HOUR_MS;
const MAX_PULL_REQUESTS_A_PASS = 5;
const GH_TIMEOUT_MS = 15000;
const MAX_WAITING_PROPOSALS = 3;
// Asked later, a proposal waits this long before it comes back.
const LATER_MS = 7 * 24 * HOUR_MS;
const PULL_REQUEST = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
const FINISHED_STATES = ['MERGED', 'CLOSED'];

const shell = promisify(execFile);
const askGitHubFor = async url => JSON.parse((await shell('gh', ['pr', 'view', url, '--json', 'state'], { timeout: GH_TIMEOUT_MS })).stdout).state;

const iso = time => new Date(time).toISOString();
const sameDay = (at, now) => new Date(at).toDateString() === new Date(now).toDateString();
const proposalId = ({ scope, conclusion, definition }) => createHash('sha256').update(`${scope}:${conclusion}:${definition ?? ''}`).digest('hex').slice(0, 6);
// When the user last asked to hear about a proposal later, or never.
const putOffAt = (answers, id) => answers
  .filter(answer => answer.id === id && answer.answer === 'later')
  .reduce((last, answer) => Math.max(last, Date.parse(answer.at)), -Infinity);

export const proposalMessage = proposal => `**Learning:** ${proposalQuestion(proposal)} Say yes for a plan, later to be asked again in a week, or no and this will not come up again.`;

const proposalOrder = (left, right) => proposing.indexOf(left.kind) - proposing.indexOf(right.kind)
  || right.seen - left.seen
  || left.scope.localeCompare(right.scope);

// The store keeps a conclusion without its evidence, so nothing about a single run outlives this pass.
const keptLesson = ({ id, scope, title, code, seen, runs, days, usd, latest, conclusion }) => ({
  id,
  scope,
  title,
  code,
  seen,
  runs,
  days,
  usd,
  latest,
  conclusion,
});

/**
 * Judges what finished and keeps what it teaches. It has no way to start a model run: every verdict comes from what
 * Hobkin already recorded, and the only call out is `gh`, with a limit.
 */
export class Learner {
  post = null;

  constructor({ root, telemetry, now = Date.now, pullRequestState = askGitHubFor }) {
    Object.assign(this, { root, telemetry, now, pullRequestState });
    this.settledAt = -Infinity;
  }

  enabled() { return learningEnabled(this.root); }

  /** Cheap enough for every tick. A real pass waits for something to have moved, or for evidence to have aged. */
  settle({ runs, schedules, attention = [] }) {
    if (!this.enabled()) return false;

    const now = this.now();
    const moved = `${runs.filter(run => run.finishedAt).length}:${this.telemetry.events.length}`;
    if (moved === this.moved && now - this.settledAt < SETTLE_EVERY_MS) return false;
    Object.assign(this, { moved, settledAt: now });

    const actions = readActions(this.root);
    const saved = readState(this.root);
    const projects = readProjects(this.root);
    const subjects = gatherEvidence({
      runs,
      schedules,
      projects,
      attention,
      now,
      itemsOf: slug => readItems(this.root, slug),
      signals: { ...this.telemetry.signals(), rejected: actions.rejected },
      pullRequests: saved.pullRequests,
      clears: actions.clears,
    });
    const concluded = subjects.map(conclude);
    const unanswered = subjects.map(subject => conclude(stillOpen(subject, schedules, runs)));
    const proposals = this.proposalsFrom(unanswered.filter(item => item.code), saved, actions);

    this.asking ??= this.askGitHub(projects).finally(() => { this.asking = null; });
    this.post ??= this.nextPost(proposals, actions);

    const next = {
      judged: {
        runs: concluded.reduce((sum, item) => sum + item.runs, 0),
        scopes: concluded.filter(item => item.runs).length,
      },
      lessons: concluded.filter(item => item.code).map(keptLesson),
      proposals,
      pullRequests: saved.pullRequests,
    };
    const changed = JSON.stringify(next) !== JSON.stringify(saved);
    if (changed) saveState(this.root, next);

    return changed || Boolean(this.post);
  }

  /**
   * A no holds for good, and a no to work holds for its whole repo. A yes holds until the schedule changes, because then a new failure is a new
   * question. Later puts a question off for a week, after which it comes back to be answered.
   */
  proposalsFrom(learned, saved, { answers }) {
    const holds = (answer, { scope, conclusion, definition }) => {
      if (answer.answer === 'no' && answer.repo) return scope.startsWith(`${answer.repo}.`);
      if (answer.scope !== scope || answer.kind !== conclusion) return false;
      if (answer.answer === 'later') return this.now() < Date.parse(answer.at) + LATER_MS;
      return answer.answer === 'no' || answer.definition === definition;
    };
    const answered = item => answers.some(answer => holds(answer, item));
    // Back from a later, a proposal is raised anew, so the later stops hiding it.
    const raisedAt = id => {
      const known = saved.proposals.find(item => item.id === id)?.at;
      return known && Date.parse(known) > putOffAt(answers, id) ? known : iso(this.now());
    };

    return learned
      .filter(item => proposing.includes(item.conclusion) && !answered(item))
      .map(item => {
        const id = proposalId(item);
        return { ...keptLesson(item), id, kind: item.conclusion, definition: item.definition, at: raisedAt(id) };
      })
      .toSorted(proposalOrder);
  }

  /**
   * One a day and a few at a time, because a backlog of history must not arrive as a wall of questions. One back from a later is asked
   * again, under a new notice so Chat does not take it for the first one.
   */
  nextPost(proposals, { posted, answers }) {
    const now = this.now();
    const told = ({ id }) => posted.some(post => post.id === id && Date.parse(post.at) > putOffAt(answers, id));
    const next = proposals.find(proposal => !told(proposal));
    const waiting = proposals.filter(told).length;
    if (!next || waiting >= MAX_WAITING_PROPOSALS || posted.some(({ at }) => sameDay(at, now))) return null;

    const again = putOffAt(answers, next.id) > -Infinity;
    const id = again ? `notice:learning:${next.id}:${now}` : `notice:learning:${next.id}`;
    return { proposal: next.id, id, role: 'assistant', content: proposalMessage(next), at: iso(now) };
  }

  /** A proposal counts as told only once Chat has it, so a close in between cannot lose it. One that cannot be marked waits. */
  takePost() {
    if (!this.post) return null;
    const { proposal, ...post } = this.post;
    try {
      appendAction(this.root, { type: 'posted', id: proposal, at: post.at });
    } catch {
      return null;
    }
    this.post = null;
    return post;
  }

  /** Asks only about PRs still open, a few at a time. Without `gh` it simply never hears, and judges nothing from that. */
  async askGitHub(projects) {
    try {
      const now = this.now();
      const known = { ...readState(this.root).pullRequests };
      const urls = projects.filter(({ state }) => state === 'chosen')
        .flatMap(({ slug }) => readItems(this.root, slug))
        .filter(({ state, pr }) => state === 'pr' && PULL_REQUEST.test(pr ?? ''))
        .map(({ pr }) => pr)
        .filter(url => !FINISHED_STATES.includes(known[url]?.state) && now - (known[url]?.checkedAt ?? -Infinity) >= PULL_REQUEST_EVERY_MS)
        .slice(0, MAX_PULL_REQUESTS_A_PASS);
      for (const url of urls) {
        if (!this.enabled()) break;
        known[url] = { ...known[url], checkedAt: now };
        known[url].state = await this.pullRequestState(url).catch(() => known[url].state);
      }
      if (!urls.length) return;
      saveState(this.root, { ...readState(this.root), pullRequests: known });
      this.moved = null;
    } catch {
      // A question GitHub cannot answer judges nothing.
    }
  }

  /** Only the outcome is kept. The reply itself goes nowhere. */
  noteReply(id, text) {
    try {
      if (this.enabled() && rejectsReport(text)) appendAction(this.root, { type: 'reply', id, at: iso(this.now()) });
    } catch {
      // An unread reply counts for nothing, so a problem here cannot reach the conversation.
    }
  }

  // Chat holds the evidence, so the agent gets only what lets it record an answer. Those few lines always fit, and lessons share what is left.
  currentNote() {
    if (!this.enabled()) return '';
    const { lessons, proposals } = learningState(this.root);
    const told = new Set(readActions(this.root).posted.map(({ id }) => id));
    const waiting = proposals.filter(({ id }) => told.has(id)).slice(0, MAX_WAITING_PROPOSALS).map(proposalLine);
    const lines = renderLessons(lessons, '', kept => learningNote({ lines: kept, proposals: waiting }));
    if (!lines.length && !waiting.length) return '';
    return learningNote({ lines, proposals: waiting });
  }

  /** What the next message should carry. Nothing, as long as the agent can still see what is current, and never a reason not to send it. */
  note(messages) {
    try {
      const current = this.currentNote();
      const last = noteInContext(messages);
      if (current === last) return '';
      if (current) return current;
      return !last || last === NO_LEARNING ? '' : NO_LEARNING;
    } catch {
      return '';
    }
  }
}
