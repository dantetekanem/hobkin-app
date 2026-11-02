import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { usageExtension } from './usage.mjs';

const TAB_LABEL = 'Work Mode';
/** Where what the user reads or carries on with opens, so it never takes a place from the agents in Work Mode. */
export const SESSION_TAB = 'Hobkin';
const START_TIMEOUT_MS = 60000;
const PROMPT_TIMEOUT_MS = 60000;
const POLL_MS = 3000;
// An agent goes idle between turns while its own sub-agents finish, so idle alone does not mean done.
const IDLE_GRACE_MS = 30000;
const MAX_NUDGES = 3;
// A run waiting on its own code review sits idle for minutes, so once it has been nudged it gets far longer before the next.
const PATIENCE_AFTER_NUDGE = 10;
// Answering a nudge is itself a short turn, so only an agent still at it this long after one has gone back to work.
const BACK_AT_WORK_MS = 120000;
// Long enough to look something up in another pane and come back to a review.
const LEFT_ALONE_MS = 300000;
// pi-auto-review gives a quiet reviewer one push after five minutes, so that comes first. Hobkin speaks up when nothing else will.
const HELPER_QUIET_MS = 360000;
const BRIEF_RETRIES = 3;
const MAX_NAME_LENGTH = 32;
// Four panes make a true grid, each a quarter of the tab, and that is as small as a pane stays readable.
const MAX_PANES_PER_TAB = 4;
const EVEN_SPLIT = '0.5';
const MOSTLY_WIDE = 0.75;
const LAST_LINES = 20;
const MAX_REASON_LENGTH = 1000;

const runCommand = promisify(execFile);
const defaultExec = async (command, args) => (await runCommand(command, args, { maxBuffer: 16 * 1024 * 1024 })).stdout;

const atRest = status => status === 'idle' || status === 'done';

/** Agents with these names are Hobkin's, and it closes them itself. Any other named agent was opened by a tool, such as a code review. */
const HOBKIN_AGENT = /^(work|hobkin)-/;
const openedByATool = ({ name }) => Boolean(name) && !HOBKIN_AGENT.test(name);

/**
 * With no Hobkin agent left in a tab, everything a tool opened there has nobody to answer to. Beside one that is still going, a review
 * shares that agent's folder, so it stays. In a folder with no Hobkin agent, what the ending run left goes, and so does what has stopped.
 */
function leftoversIn(agents, endedIn) {
  const hobkins = agents.filter(({ name }) => HOBKIN_AGENT.test(name));
  const opened = agents.filter(openedByATool);
  if (!hobkins.length) return opened;

  return opened
    .filter(agent => !hobkins.some(({ cwd }) => cwd === agent.cwd))
    .filter(agent => agent.cwd === endedIn || atRest(agent.agent_status));
}

// Nobody answers in a run's pane, so the tools that ask are not offered. Pi reads a path given to `--append-system-prompt`,
// and there the brief carries the weight it has in a background run. A pane has every extension the user has, which is why nothing
// here says `--no-extensions`. Naming the reader only adds it, and without it the reserve would be judged on numbers from before this run.
const piArguments = ({ model, effort, sessionFile, brief }) => [
  '--session', sessionFile,
  '--thinking', effort,
  '--approve',
  '--exclude-tools', 'ask_user,ask_user_batch',
  '--append-system-prompt', brief,
  '--extension', usageExtension,
  ...(model ? ['--model', model] : []),
];

// A pane must never sit waiting for approval, and git can bring back whatever a run gets wrong. The user's Claude settings skip the prompt this flag raises on first use.
// A session of a known name is what lets its usage be read afterwards. Model and effort go on only when the run is bound to them.
const claudeArguments = ({ claudeSession, bound, model, effort }) => [
  '--dangerously-skip-permissions',
  ...(claudeSession ? ['--session-id', claudeSession] : []),
  ...(bound ? ['--model', model, '--effort', effort] : []),
];

const codexArguments = ['--dangerously-bypass-approvals-and-sandbox'];

export const insideHerdr = (env = process.env) => env.HERDR_ENV === '1' && Boolean(env.HERDR_WORKSPACE_ID);

export const agentName = (lane, slug) => `work-${lane}-${slug}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, MAX_NAME_LENGTH);

/** Which of this family a tab is: `Work Mode` is 1, `Work Mode 2` is 2, and anything else the user named is not ours. */
const tabNumber = (label, family) => {
  if (label === family) return 1;
  const number = String(label).startsWith(`${family} `) ? String(label).slice(family.length + 1) : '';
  return /^[1-9]\d*$/.test(number) && Number(number) > 1 ? Number(number) : null;
};

/**
 * The biggest pane gives up half of itself: one across the whole tab splits sideways and any other splits down. Four panes end as
 * a true grid. A closed pane's neighbour takes its space, so that pane is the biggest and the next agent fills the gap.
 */
function nextSplit({ area, panes }) {
  const size = ({ rect }) => rect.width * rect.height;
  const biggest = panes.reduce((best, pane) => (size(pane) > size(best) ? pane : best));
  return { pane: biggest.pane_id, direction: biggest.rect.width > area.width * MOSTLY_WIDE ? 'right' : 'down' };
}

/** Runs project work where the user can watch it: one agent per pane, up to four to a Herdr tab, and each pane closes with its run. */
export class WorkPanes {
  constructor({
    workspace = process.env.HERDR_WORKSPACE_ID, exec = defaultExec, pollMs = POLL_MS, idleGraceMs = IDLE_GRACE_MS, backAtWorkMs = BACK_AT_WORK_MS,
    leftAloneMs = LEFT_ALONE_MS, helperQuietMs = HELPER_QUIET_MS, tab = TAB_LABEL, startTimeoutMs = START_TIMEOUT_MS,
  } = {}) {
    Object.assign(this, { workspace, exec, pollMs, idleGraceMs, backAtWorkMs, leftAloneMs, helperQuietMs, tab, startTimeoutMs });
  }

  // Herdr says what went wrong in JSON on stderr, and that reads better than the whole command that failed.
  async herdr(...args) {
    try {
      return JSON.parse(await this.exec('herdr', args)).result;
    } catch (error) {
      const reason = /"message":"((?:[^"\\]|\\.)*)"/.exec(error.stderr ?? '')?.[1];
      throw reason ? Object.assign(Error(reason), { stderr: error.stderr }) : error;
    }
  }

  // One at a time, so runs starting together share a tab instead of each making one, and a pane closing cannot take a tab from under a split.
  inTurn(action) {
    const turn = (this.opening ?? Promise.resolve()).catch(() => {}).then(action);
    this.opening = turn;
    return turn;
  }

  openPane(cwd) {
    return this.inTurn(() => this.createPane(cwd));
  }

  async newTab(numbers, cwd) {
    const number = Array.from({ length: numbers.length + 1 }, (_, index) => index + 1).find(free => !numbers.includes(free));
    const label = number === 1 ? this.tab : `${this.tab} ${number}`;
    const created = await this.herdr('tab', 'create', '--workspace', this.workspace, '--label', label, '--cwd', cwd, '--no-focus');
    return created.root_pane.pane_id;
  }

  // The lowest tab with room comes first, so a gap fills before another tab opens. Herdr closes an empty tab by itself.
  async createPane(cwd) {
    const { tabs } = await this.herdr('tab', 'list', '--workspace', this.workspace);
    const family = tabs.flatMap(tab => {
      const number = tabNumber(tab.label, this.tab);
      return number ? [{ ...tab, number }] : [];
    }).toSorted((left, right) => left.number - right.number);
    const room = family.find(tab => (tab.pane_count ?? 0) < MAX_PANES_PER_TAB);
    if (!room) return this.newTab(family.map(tab => tab.number), cwd);

    const { panes } = await this.herdr('pane', 'list', '--workspace', this.workspace);
    const member = panes.find(pane => pane.tab_id === room.tab_id);
    const { layout } = await this.herdr('pane', 'layout', '--pane', member.pane_id);
    const { pane: target, direction } = nextSplit(layout);
    const { pane } = await this.herdr('pane', 'split', target, '--direction', direction, '--ratio', EVEN_SPLIT, '--cwd', cwd, '--no-focus');
    return pane.pane_id;
  }

  // Until a new pane's shell shows its prompt, Herdr refuses any line over 1024 bytes, and a start line with long paths can reach that.
  async startAgent(name, kind, pane, args) {
    const giveUpAt = Date.now() + this.startTimeoutMs;
    for (;;) {
      try {
        return await this.herdr('agent', 'start', name, '--kind', kind, '--pane', pane, '--timeout', String(START_TIMEOUT_MS), '--', ...args);
      } catch (error) {
        const shellStarting = String(error.stderr ?? error.message).includes('agent_start_input_failed');
        if (!shellStarting || Date.now() >= giveUpAt) throw error;
        await delay(this.pollMs);
      }
    }
  }

  closePane(pane) {
    return this.inTurn(() => this.herdr('pane', 'close', pane)).catch(() => {});
  }

  // A tool opens its agents beside whoever called it and closes them from there, so once that pane has gone nobody else will.
  // Herdr closes a tab when its last pane goes. This is housekeeping, so a failure only leaves them for the next time.
  async closeLeftovers(endedIn) {
    try {
      const { tabs } = await this.herdr('tab', 'list', '--workspace', this.workspace);
      const { agents } = await this.herdr('agent', 'list');
      const ours = tabs.filter(tab => tabNumber(tab.label, this.tab));
      const leftovers = ours.flatMap(({ tab_id: id }) => leftoversIn(agents.filter(agent => agent.tab_id === id), endedIn));
      await Promise.all(leftovers.map(agent => this.closePane(agent.pane_id)));
    } catch {
      // Nothing depends on this.
    }
  }

  async closeWithLeftovers(pane) {
    await this.closePane(pane);
    await this.closeLeftovers();
  }

  /** Whether the pane itself is gone, which is the user closing it rather than the agent inside it exiting. */
  async paneIsGone(pane) {
    try {
      await this.herdr('pane', 'get', pane);
      return false;
    } catch (error) {
      return String(error.stderr ?? error.message).includes('pane_not_found');
    }
  }

  // A pane does not stay open to be read, so a failure keeps the end of what it showed. This goes in the run's report and nowhere else.
  async lastLines(pane) {
    try {
      return (await this.exec('herdr', ['pane', 'read', pane, '--source', 'recent', '--lines', String(LAST_LINES)])).trim();
    } catch {
      return '';
    }
  }

  // One failed call says nothing about the agent, and taking it for an exit would fail a healthy run. Only Herdr saying it has no such agent means it has gone.
  async readAgent(name) {
    try {
      return (await this.herdr('agent', 'get', name)).agent;
    } catch (error) {
      const said = String(error.stderr ?? error.message);
      if (!said.includes('agent_not_found')) return { agent_status: 'unknown' };
      throw Error(`The agent exited without writing its report. ${said}`.trim());
    }
  }

  async agentStatus(name) {
    return (await this.readAgent(name)).agent_status;
  }

  prompt(name, text) {
    return this.herdr('agent', 'prompt', name, text, '--wait', '--until', 'working', '--timeout', String(PROMPT_TIMEOUT_MS));
  }

  // Herdr says a stall does not prove the prompt went nowhere, so it goes again only to an agent that is still at rest.
  async giveBrief({ name, brief, signal }) {
    for (let retries = BRIEF_RETRIES; ; retries -= 1) {
      try {
        return await this.prompt(name, `Read ${brief} and follow it.`);
      } catch (error) {
        const stalled = String(error.stderr ?? error.message).includes('agent_prompt_stalled');
        if (!retries || !stalled) throw error;
        await delay(this.pollMs, undefined, { signal });
        if (!atRest(await this.agentStatus(name))) return;
      }
    }
  }

  /** What a tool opened to work for this agent: it opens beside the agent that called it, in the same folder. */
  async helpersOf(name) {
    const { agents } = await this.herdr('agent', 'list').catch(() => ({ agents: [] }));
    const agent = agents.find(candidate => candidate.name === name);
    if (!agent) return [];

    return agents.filter(helper => openedByATool(helper) && helper.tab_id === agent.tab_id && helper.cwd === agent.cwd);
  }

  // Herdr calls a Pi `done` once its own turn ends, and its lanes can still be running, so a screen that keeps changing counts as work.
  async isAtWork({ pane_id: pane, agent_status: status }, screens) {
    if (status === 'working') return true;

    const shown = await this.lastLines(pane);
    if (screens.get(pane)?.shown !== shown) screens.set(pane, { shown, changedAt: Date.now() });
    return Date.now() - screens.get(pane).changedAt < this.helperQuietMs;
  }

  // The ping, which takes no model and no tokens. An agent waiting on a helper at work has not stopped. With none at work, all it has have stopped.
  async helperCheck(name, screens) {
    const helpers = await this.helpersOf(name);
    const atWork = await Promise.all(helpers.map(helper => this.isAtWork(helper, screens)));
    return { waiting: atWork.some(Boolean), stopped: helpers.map(helper => helper.name) };
  }

  // Herdr refuses a prompt for as long as it still sees the question, and a stall proves nothing, so a nudge that does not land is no
  // failure. It still counts, and the next look at the agent settles it.
  async nudge({ name, report, status, signal, stoppedHelpers }) {
    if (status === 'blocked') {
      await this.herdr('agent', 'send-keys', name, 'esc').catch(() => {});
      await delay(this.pollMs, undefined, { signal }).catch(() => {});
    }
    const finish = `If you have finished, write your report to ${report} now. If not, carry on and write it when you finish.`;
    const notice = stoppedHelpers.length
      ? `${stoppedHelpers.join(', ')} stopped, and nothing is running for you. Do not wait for it. Finish without it and say so in your report. `
      : '';
    await this.prompt(name, `${notice}${finish}`).catch(() => {});
  }

  // The report file is the one finish line every harness can reach, so it decides when a run is over.
  // Nobody answers in a run's pane, so a blocked agent has stopped. A session's question waits for the user watching it.
  async waitForReport({ name, report, signal, watched = false }) {
    let stoppedSince = null;
    let nudges = 0;
    let nudgedAt = 0;
    const screens = new Map();
    while (!existsSync(report)) {
      signal?.throwIfAborted();
      const status = await this.agentStatus(name);
      if (existsSync(report)) return;
      const atRestOrStuck = atRest(status) || (status === 'blocked' && !watched);
      const helpers = atRestOrStuck ? await this.helperCheck(name, screens) : { waiting: false, stopped: [] };
      if (existsSync(report)) return;
      if (atRestOrStuck && !helpers.waiting) {
        stoppedSince ??= Date.now();
        const patience = this.idleGraceMs * (nudges ? PATIENCE_AFTER_NUDGE : 1);
        if (Date.now() - stoppedSince >= patience) {
          if (nudges === MAX_NUDGES) throw Error('The agent stopped without writing its report.');
          await this.nudge({ name, report, status, signal, stoppedHelpers: helpers.stopped });
          nudges += 1;
          nudgedAt = Date.now();
          stoppedSince = null;
        }
      } else {
        stoppedSince = null;
        if (Date.now() - nudgedAt >= this.backAtWorkMs) nudges = 0;
      }
      await delay(this.pollMs, undefined, { signal }).catch(() => {});
    }
  }

  async startPi(name, cwd) {
    const pane = await this.openPane(cwd);
    try {
      await this.startAgent(name, 'pi', pane, ['--approve']);
    } catch (error) {
      await this.closePane(pane);
      throw error;
    }
    return pane;
  }

  /**
   * Opens pi-coder on a range, in front of the user. `followReview` is what closes it.
   * `--wait` would stall, because a slash command opens a screen and the agent never goes to work.
   */
  async startDiff({ name, cwd, range }) {
    // Pi hands a command it does not know to the model as a message.
    const packages = await this.exec('pi', ['list']);
    if (!packages.includes('pi-coder')) throw Error('Showing a diff takes pi-coder. Run `pi install npm:pi-coder`.');

    const pane = await this.startPi(name, cwd);
    try {
      await this.herdr('agent', 'focus', name);
      await this.herdr('agent', 'prompt', name, `/diff ${range}`);
    } catch (error) {
      await this.closePane(pane);
      throw error;
    }
    return { name, pane };
  }

  // A review is the user's for as long as they are in it, or its agent is working on what they handed it. An agent that has gone ends it too.
  async followReview({ name, pane }) {
    let leftAt = null;
    try {
      while (leftAt === null || Date.now() - leftAt < this.leftAloneMs) {
        await delay(this.pollMs);
        const { agent_status: status, focused } = await this.readAgent(name);
        leftAt = atRest(status) && !focused ? (leftAt ?? Date.now()) : null;
      }
    } catch {
      // The agent has gone, and the pane goes with it.
    }
    await this.closeWithLeftovers(pane);
  }

  /** Starts a session and returns straight away. `followSession` is what closes it, for any session that is not the user's to keep. */
  async startSession({ name, cwd, brief }) {
    const pane = await this.startPi(name, cwd);
    try {
      await this.prompt(name, `Read ${brief} and follow it.`);
    } catch (error) {
      throw Error(`Pi is running in pane ${pane} as ${name}, but the brief may not have arrived: ${error.message}. Look there before starting another session.`);
    }
    return { name, pane };
  }

  // However a session ends its pane closes: a written report, an agent that stopped without one, or an agent that has gone.
  async followSession({ name, pane, report }) {
    await this.waitForReport({ name, report, watched: true }).catch(() => {});
    await this.closeWithLeftovers(pane);
  }

  runArguments({ kind, model, effort, sessionFile, brief, claudeSession, bound }) {
    if (kind === 'pi') return piArguments({ model, effort, sessionFile, brief });
    if (kind === 'claude') return claudeArguments({ claudeSession, bound, model, effort });
    return codexArguments;
  }

  async run(request) {
    try {
      return await this.runInPane(request);
    } finally {
      await this.closeLeftovers(request.cwd);
    }
  }

  async runInPane({ name, kind, cwd, model, effort, sessionFile, brief, report, signal, claudeSession, bound }) {
    let pane = null;
    let started = false;
    try {
      signal?.throwIfAborted();
      pane = await this.openPane(cwd);
      await this.startAgent(name, kind, pane, this.runArguments({ kind, model, effort, sessionFile, brief, claudeSession, bound }));
      started = true;
      await this.giveBrief({ name, brief, signal });
      await this.waitForReport({ name, report, signal });
      await this.closePane(pane);
      return { status: 'completed', text: readFileSync(report, 'utf8').trim(), cost: null };
    } catch (error) {
      if (signal?.aborted) {
        if (pane) await this.closePane(pane);
        return { status: 'interrupted', cost: null, error: 'Harness cancelled.' };
      }
      if (started && await this.paneIsGone(pane)) return { status: 'interrupted', cost: null, paneClosed: true, error: 'The pane was closed by hand.' };
      const lines = started ? await this.lastLines(pane) : '';
      if (pane) await this.closePane(pane);
      const reason = String(error.message ?? error).slice(0, MAX_REASON_LENGTH);
      return { status: 'failed', cost: null, error: lines ? `${reason}\n\nLast lines in the pane:\n${lines.slice(-MAX_REASON_LENGTH)}` : reason };
    }
  }
}
