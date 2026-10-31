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

export const insideHerdr = (env = process.env) => env.HERDR_ENV === '1' && Boolean(env.HERDR_WORKSPACE_ID);

export const agentName = (lane, slug) => `work-${lane}-${slug}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, MAX_NAME_LENGTH);

/** Runs project work where the user can watch it: one agent per pane, in a Herdr tab of their own. */
export class WorkPanes {
  constructor({ workspace = process.env.HERDR_WORKSPACE_ID, exec = defaultExec, pollMs = POLL_MS, idleGraceMs = IDLE_GRACE_MS, tab = TAB_LABEL, extensionsFor = async () => undefined } = {}) {
    Object.assign(this, { workspace, exec, pollMs, idleGraceMs, tab, extensionsFor });
  }

  async herdr(...args) {
    return JSON.parse(await this.exec('herdr', args)).result;
  }

  // One at a time, so runs starting together share a tab instead of each making one.
  openPane(cwd) {
    const opened = (this.opening ?? Promise.resolve()).catch(() => {}).then(() => this.createPane(cwd));
    this.opening = opened;
    return opened;
  }

  async createPane(cwd) {
    const { tabs } = await this.herdr('tab', 'list', '--workspace', this.workspace);
    const tab = tabs.find(entry => entry.label === this.tab);
    if (!tab) {
      const created = await this.herdr('tab', 'create', '--workspace', this.workspace, '--label', this.tab, '--cwd', cwd, '--no-focus');
      return created.root_pane.pane_id;
    }
    const { panes } = await this.herdr('pane', 'list', '--workspace', this.workspace);
    const inTab = panes.filter(pane => pane.tab_id === tab.tab_id);
    const direction = inTab.length % 2 ? 'right' : 'down';
    const { pane } = await this.herdr('pane', 'split', inTab.at(-1).pane_id, '--direction', direction, '--cwd', cwd, '--no-focus');
    return pane.pane_id;
  }

  closePane(pane) {
    return this.herdr('pane', 'close', pane).catch(() => {});
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
  async waitForReport({ name, report, signal }) {
    let idleSince = null;
    let asked = false;
    while (!existsSync(report)) {
      signal?.throwIfAborted();
      const status = await this.agentStatus(name);
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
      const extensions = extensionArguments(await this.extensionsFor(cwd));
      await this.herdr('agent', 'start', name, '--kind', 'pi', '--pane', pane, '--timeout', String(START_TIMEOUT_MS), '--', '--approve', ...extensions);
    } catch (error) {
      await this.closePane(pane);
      throw error;
    }
    try {
      await this.prompt(name, brief);
    } catch (error) {
      throw Error(`Pi is running in pane ${pane} as ${name}, but the brief may not have arrived: ${error.message}. Look there before starting another session.`);
    }
    return { name, pane };
  }

  async run({ name, kind, cwd, model, effort, sessionFile, brief, report, signal }) {
    let pane = null;
    try {
      signal?.throwIfAborted();
      pane = await this.openPane(cwd);
      const args = kind === 'pi' ? piArguments({ model, effort, sessionFile, extensions: await this.extensionsFor(cwd) }) : [];
      await this.herdr('agent', 'start', name, '--kind', kind, '--pane', pane, '--timeout', String(START_TIMEOUT_MS), '--', ...args);
      await this.prompt(name, `Read ${brief} and follow it.`);
      await this.waitForReport({ name, report, signal });
      await this.closePane(pane);
      return { status: 'completed', text: readFileSync(report, 'utf8').trim(), cost: null };
    } catch (error) {
      if (signal?.aborted) {
        if (pane) await this.closePane(pane);
        return { status: 'interrupted', cost: null, error: 'Harness cancelled.' };
      }
      // The pane stays open so the user can read what went wrong.
      return { status: 'failed', cost: null, error: String(error.message ?? error).slice(0, 2000) };
    }
  }
}
