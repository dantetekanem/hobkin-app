import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { extensionArguments } from '../pi-extensions.mjs';

const TAB_LABEL = 'Work Mode';
const START_TIMEOUT_MS = 60000;
const PROMPT_TIMEOUT_MS = 60000;
const POLL_MS = 3000;
// An agent goes idle between turns while its own sub-agents finish, so idle alone does not mean done.
const IDLE_GRACE_MS = 30000;
const MAX_NAME_LENGTH = 32;
// Four panes make a true grid, each a quarter of the tab, and that is as small as a pane stays readable.
const MAX_PANES_PER_TAB = 4;
const EVEN_SPLIT = '0.5';
const MOSTLY_WIDE = 0.75;
const LAST_LINES = 20;
const MAX_REASON_LENGTH = 1000;

const runCommand = promisify(execFile);
const defaultExec = async (command, args) => (await runCommand(command, args, { maxBuffer: 16 * 1024 * 1024 })).stdout;

// Other harnesses start with the user's own settings, including how they handle approvals.
const piArguments = ({ model, effort, sessionFile, extensions }) => [
  '--session', sessionFile,
  '--thinking', effort,
  '--approve',
  ...(model ? ['--model', model] : []),
  ...extensionArguments(extensions),
];

// A session of a known name is what lets its usage be read afterwards. Model and effort go on only when the run is bound to them, and no permission flag ever does.
const claudeArguments = ({ claudeSession, bound, model, effort }) => [
  ...(claudeSession ? ['--session-id', claudeSession] : []),
  ...(bound ? ['--model', model, '--effort', effort] : []),
];

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
  constructor({ workspace = process.env.HERDR_WORKSPACE_ID, exec = defaultExec, pollMs = POLL_MS, idleGraceMs = IDLE_GRACE_MS, tab = TAB_LABEL, extensionsFor = async () => undefined, startTimeoutMs = START_TIMEOUT_MS } = {}) {
    Object.assign(this, { workspace, exec, pollMs, idleGraceMs, tab, extensionsFor, startTimeoutMs });
  }

  // Herdr says what went wrong in JSON on stderr. The failed command itself can run to thousands of bytes of extensions.
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

  // Until a new pane's shell shows its prompt, Herdr refuses any line over 1024 bytes, and naming every extension takes more.
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

  async agentStatus(name) {
    try {
      return (await this.herdr('agent', 'get', name)).agent.agent_status;
    } catch (error) {
      throw Error(`The agent exited without writing its report. ${error.stderr ?? error.message}`.trim());
    }
  }

  prompt(name, text) {
    return this.herdr('agent', 'prompt', name, text, '--wait', '--until', 'working', '--timeout', String(PROMPT_TIMEOUT_MS));
  }

  // The report file is the one finish line every harness can reach, so it decides when a run is over.
  async waitForReport({ name, report, signal, onStatus }) {
    let idleSince = null;
    let asked = false;
    while (!existsSync(report)) {
      signal?.throwIfAborted();
      const status = await this.agentStatus(name);
      onStatus?.(status);
      if (existsSync(report)) return;
      if (status === 'idle' || status === 'done') {
        idleSince ??= Date.now();
        if (Date.now() - idleSince >= this.idleGraceMs) {
          if (asked) throw Error('The agent stopped without writing its report.');
          asked = true;
          idleSince = null;
          await this.prompt(name, `If you have finished, write your report to ${report} now. If not, carry on and write it when you finish.`);
        }
      } else {
        idleSince = null;
      }
      await delay(this.pollMs, undefined, { signal }).catch(() => {});
    }
  }

  /** Unlike a run, this is the user's to keep: the pane stays open and nobody waits for a report. */
  async startSession({ name, cwd, brief }) {
    const pane = await this.openPane(cwd);
    try {
      await this.startAgent(name, 'pi', pane, ['--approve', ...extensionArguments(await this.extensionsFor(cwd))]);
    } catch (error) {
      await this.closePane(pane);
      throw error;
    }
    try {
      await this.prompt(name, `Read ${brief} and follow it.`);
    } catch (error) {
      throw Error(`Pi is running in pane ${pane} as ${name}, but the brief may not have arrived: ${error.message}. Look there before starting another session.`);
    }
    return { name, pane };
  }

  async run({ name, kind, cwd, model, effort, sessionFile, brief, report, signal, claudeSession, bound, onStatus }) {
    let pane = null;
    let started = false;
    try {
      signal?.throwIfAborted();
      pane = await this.openPane(cwd);
      const claude = kind === 'claude' ? claudeArguments({ claudeSession, bound, model, effort }) : [];
      const args = kind === 'pi' ? piArguments({ model, effort, sessionFile, extensions: await this.extensionsFor(cwd) }) : claude;
      await this.startAgent(name, kind, pane, args);
      started = true;
      await this.prompt(name, `Read ${brief} and follow it.`);
      await this.waitForReport({ name, report, signal, onStatus });
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
