#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultRoot, initialize, jevEnabled, legacySources, setJev } from './config.mjs';
import { loadImportedHistory } from './history.mjs';
import { indexStatus } from './memory-index.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { readLocalView, savePresentationState } from './view.mjs';
import { deleteReports } from './reports.mjs';
import { inRoutineWords, whenItRuns } from './schedules.mjs';
import { stayAwake } from './stay-awake.mjs';

export function parseArguments(args) {
  const values = [...args];
  const options = { command: 'status', root: resolve(defaultRoot()), explicitRoot: false, plain: false, args: [] };
  if (values[0] && !values[0].startsWith('-')) options.command = values.shift();
  while (values.length) {
    const flag = values.shift();
    if (flag === '--home' && values[0] && !values[0].startsWith('-')) {
      options.root = resolve(values.shift());
      options.explicitRoot = true;
    } else if (['--selection', '--preview', '--confirm', '--title', '--cwd'].includes(flag) && values[0] && !values[0].startsWith('-')) {
      options[flag.slice(2)] = values.shift();
    } else if (options.command === 'work' && ['--state', '--brief'].includes(flag) && values.length) {
      options[flag.slice(2)] = values.shift();
    } else if (flag === '--plain') options.plain = true;
    else if (flag === '--keep' && options.command === 'session') options.keep = true;
    else if (['--help', '-h'].includes(flag) && options.command === 'work') options.args.unshift('help');
    else if (flag === '--help' || flag === '-h') options.command = 'help';
    else if (['reports', 'work', 'import', 'jev', 'learning', 'profile', 'decide'].includes(options.command) && !flag.startsWith('-')) options.args.push(flag);
    else throw Error(`Unknown or incomplete option: ${flag}`);
  }
  return options;
}

function quitQuestion(agents) {
  const them = agents === 1 ? 'it' : 'them';
  const working = agents === 1 ? '1 agent is' : `${agents} agents are`;
  return {
    question: `You are quitting, and ${working} still working. Stop ${them} or let ${them} finish? Whatever finishes, hobkin picks up the next time it opens.`,
    choices: [
      { value: 'finish', label: `Let ${them} finish` },
      { value: 'stop', label: `Stop ${them} now` },
    ],
  };
}

const looksNew = ({ schedules, messages, userName }) => !schedules.length && !messages.length && !userName;

async function connected(options, snapshot, dependencies) {
  const signals = dependencies.signals ?? process;
  const done = Promise.withResolvers();
  const cancellation = new AbortController();
  // Nothing is asked of a signal, and an agent left going loses nothing, so that is what it gets.
  let letFinish = false;
  const stop = () => {
    cancellation.abort();
    done.resolve();
  };
  const stopBySignal = () => {
    letFinish = true;
    stop();
  };
  let dashboard;
  let app;
  let askingToQuit = false;
  const quit = async () => {
    const agents = app?.agentsAtWork() ?? 0;
    if (askingToQuit) return;
    if (agents) {
      askingToQuit = true;
      const answer = await dashboard.askQuestion(quitQuestion(agents));
      askingToQuit = false;
      // Esc keeps hobkin open. With another question already up nothing could be asked, and leaving them going costs nothing.
      if (answer === null) return;
      letFinish = answer !== 'stop';
    }
    stop();
  };
  signals.on('SIGINT', stopBySignal);
  signals.on('SIGTERM', stopBySignal);
  stayAwake();
  try {
    // An injected application brings its own model.
    const signIn = dependencies.signIn ?? (dependencies.openApplication ? null : (await import('./signin.mjs')).signIn);
    if (signIn) await signIn({ launcher: snapshot.config.launcher });

    const start = dependencies.startDashboard ?? (await import('./ui.mjs')).startDashboard;
    dashboard = start(snapshot, {
      onQuit: quit,
      send: (text, report) => {
        if (!app) throw Error('Main conversation is still connecting.');
        return app.send(text, report);
      },
      clear: messageIds => savePresentationState(options.root, messageIds),
      reset: () => {
        if (!app) throw Error('Main conversation is still connecting.');
        return app.reset();
      },
      kill: runId => {
        if (!app) throw Error('hobkin is still connecting.');
        return app.kill(runId);
      },
      reportRead: read => app?.recordReportRead(read),
      workAction: (...request) => {
        if (!app) throw Error('hobkin is still connecting.');
        return app.workAction(...request);
      },
      toggleJev: () => {
        if (!app) throw Error('hobkin is still connecting.');
        return app.toggleJev();
      },
      toggleLearning: () => {
        if (!app) throw Error('hobkin is still connecting.');
        return app.toggleLearning();
      },
    }, { theme: { cwd: snapshot.config.main.cwd } });
    const open = dependencies.openApplication ?? (await import('./application.mjs')).HobkinApplication.open;
    const opening = open(options.root, {
      signal: cancellation.signal,
      memoryIndex: {},
      onChange: view => dashboard.update(view),
      askQuestion: (request, signal) => dashboard.askQuestion(request, signal),
      showDone: () => dashboard.showDone?.(),
    }).then(opened => {
      app = opened;
      if (cancellation.signal.aborted) return opened.close();
      if (looksNew(snapshot)) dashboard.startSetup?.();
    });
    // A quit never waits for startup. Exit hooks release the lock and stop MCP servers.
    await Promise.race([opening, done.promise]);
    await done.promise;
    return 0;
  } finally {
    signals.removeListener('SIGINT', stopBySignal);
    signals.removeListener('SIGTERM', stopBySignal);
    dashboard?.stop();
    await app?.close({ letFinish });
  }
}

export async function main(args = process.argv.slice(2), output = process.stdout, dependencies = {}) {
  const options = parseArguments(args);
  if (options.command === 'help') {
    output.write('Hobkin\nUsage: hobkin [command] [options]\n  init | routines | status | history  [--home directory] [--plain]\n  patterns-preview --selection file\n  patterns-submit --preview HASH --confirm HASH\n  upgrade-plan --selection file\n  upgrade-prepare --selection plan.json --confirm HASH\n  upgrade-apply --confirm MIGRATION_ID [--selection authorization.json]\n  upgrade-status\n  reports [delete ID...]  list the Reports inventory as JSON, or delete reports by ID\n  setup  check what Hobkin needs, change nothing, and say how to fix what is missing\n  skill  print a skill that teaches other agents to work with Hobkin\n  work [help | status | start | stop | pause | resume | add | trigger | cancel | ...]  drive work mode; work help lists it all\n  import [folder]  copy a pi-companion folder into this one, ~/.companion by default\n  jev [on | off]  show or set whether Jev picks from all 18 moods; on needs TYPESAFE_API_KEY\n  learning [on | off | clear <id> | clear all | answer <id> yes|no]  show what Hobkin learned, set it, remove lessons or answer a proposal\n  login  sign in to a model provider, the same way as /login in Pi\n  profile [name <text> | call <text> | email <text> | clear [name | call | email]]  show or set who the user is and what to call them\n  session [--title name] [--cwd directory] [--keep]  hand the brief on stdin to a full Pi session in a Herdr pane, which closes when it finishes unless kept\n');
    return 0;
  }
  if (options.command === 'setup') {
    const { printSetup } = await import('./setup.mjs');
    return printSetup(options.root, output, dependencies);
  }
  if (options.command === 'skill') {
    output.write(readFileSync(new URL('../prompts/hobkin-skill.md', import.meta.url), 'utf8'));
    return 0;
  }
  if (options.command === 'import') {
    const { importHome } = await import('./import.mjs');
    output.write(`${JSON.stringify(await importHome(options.root, options.args[0]), null, 2)}\n`);
    return 0;
  }
  if (options.command === 'login') {
    if (!output.isTTY) throw Error('hobkin login needs a terminal.');
    const signIn = dependencies.signIn ?? (await import('./signin.mjs')).signIn;
    await signIn({ always: true });
    return 0;
  }
  if (options.command === 'jev') {
    const [choice, ...extra] = options.args;
    if (extra.length || ![undefined, 'on', 'off'].includes(choice)) throw Error('Usage: hobkin jev [on | off]');
    const result = choice ? setJev(options.root, choice === 'on') : { enabled: jevEnabled(options.root) };
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'learning') {
    const { runLearningCommand } = await import('./learning/commands.mjs');
    const result = runLearningCommand(options.root, options.args);
    output.write(typeof result === 'string' ? result : `${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'profile') {
    const { runProfileCommand } = await import('./profile.mjs');
    output.write(`${JSON.stringify(runProfileCommand(options.root, options.args), null, 2)}\n`);
    return 0;
  }
  if (options.command === 'decide') {
    const { runDecideCommand } = await import('./decisions.mjs');
    output.write(`${JSON.stringify(await runDecideCommand(options.root, options.args, dependencies.input ?? process.stdin), null, 2)}\n`);
    return 0;
  }
  if (options.command === 'session') {
    const { followInBackground, readBrief, requireHerdr, startSession } = await import('./session.mjs');
    requireHerdr();
    const brief = await readBrief(dependencies.input ?? process.stdin);
    const started = await startSession({ root: options.root, title: options.title, cwd: options.cwd, brief, keep: options.keep, follow: followInBackground });
    output.write(`${JSON.stringify(started, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'work') {
    const { printWorkCommand } = await import('./work/commands.mjs');
    return printWorkCommand(options, output, dependencies.input ?? process.stdin);
  }
  if (options.command.startsWith('upgrade-')) {
    const { planUpgrade, prepareUpgrade, applyUpgrade, upgradeStatus, readUpgradeJson } = await import('./migration/commands.mjs');
    let result;
    if (options.plain && ['upgrade-prepare', 'upgrade-apply'].includes(options.command)) {
      throw Error('Plain mode cannot prepare or apply an upgrade.');
    }
    if (options.command === 'upgrade-status') {
      result = upgradeStatus(options.root);
    } else if (options.command === 'upgrade-apply') {
      result = await applyUpgrade(options.root, {
        confirmation: options.confirm,
        authorization: options.selection ? readUpgradeJson(resolve(options.selection)) : {},
      });
    } else if (['upgrade-plan', 'upgrade-prepare'].includes(options.command)) {
      if (!options.selection) throw Error('Select an explicit upgrade JSON file.');
      const input = readUpgradeJson(resolve(options.selection));
      result = options.command === 'upgrade-plan'
        ? planUpgrade(input)
        : await prepareUpgrade(options.root, input, options.confirm);
    } else {
      throw Error(`Unknown command: ${options.command}`);
    }
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'repair_review' ? 2 : 0;
  }
  if (options.command === 'patterns-preview' || options.command === 'patterns-submit') {
    const { previewPatterns, readSelection, submitPatterns } = await import('./patterns.mjs');
    if (options.command === 'patterns-preview') {
      if (!options.selection) throw Error('Select an explicit JSON selection file.');
      output.write(`${JSON.stringify(previewPatterns(options.root, readSelection(resolve(options.selection))), null, 2)}\n`);
      return 0;
    }
    if (options.plain) throw Error('Plain mode cannot submit provider work.');
    const signals = dependencies.signals ?? process;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signals.on('SIGINT', cancel);
    signals.on('SIGTERM', cancel);
    try {
      const receipt = await submitPatterns(options.root, {
        hash: options.preview,
        confirmation: options.confirm,
        signal: controller.signal,
      });
      output.write(`${JSON.stringify(receipt, null, 2)}\n`);
      return receipt.status === 'completed' ? 0 : 1;
    } finally {
      signals.removeListener('SIGINT', cancel);
      signals.removeListener('SIGTERM', cancel);
    }
  }
  if (options.command === 'reports') {
    const inventory = () => readLocalView(options.root).reports;
    if (!options.args.length) {
      output.write(`${inRoutineWords(JSON.stringify(inventory(), null, 2))}\n`);
      return 0;
    }
    const [action, ...ids] = options.args;
    if (action !== 'delete' || !ids.length) throw Error('Usage: hobkin reports [delete ID...]');

    const before = inventory();
    const known = new Set(before.map(report => report.id));
    const unknown = ids.filter(id => !known.has(id));
    if (unknown.length) throw Error(`Unknown report IDs; nothing deleted: ${unknown.join(', ')}`);

    deleteReports(options.root, ids);
    const result = {
      deleted: [...new Set(ids)],
      before: before.length,
      after: inventory().length,
    };
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'history') {
    output.write(`${JSON.stringify(loadImportedHistory(options.root), null, 2)}\n`);
    return 0;
  }
  // `schedules` is the command's old name, and agents can still have it in their memory.
  if (!['init', 'routines', 'schedules', 'status'].includes(options.command)) throw Error(`Unknown command: ${options.command}`);
  const tty = output.isTTY && (dependencies.input ?? process.stdin).isTTY;
  const connect = !options.plain && options.command === 'status' && tty;
  if (options.command === 'init') initialize(options.root, { legacySources: options.explicitRoot ? [] : legacySources() });
  else if (connect) initialize(options.root);
  const snapshot = readLocalView(options.root);
  const { config, schedules, counts, errors, usage } = snapshot;
  if (connect) {
    const code = await connected(options, snapshot, dependencies);
    // Extension handles can outlive close(); Pi's own quit exits the same way.
    dependencies.exit?.(code);
    return code;
  }
  output.write(`Hobkin · ${options.root}\nDaily ${counts.daily} · Weekly ${counts.weekly} · Monthly ${counts.monthly} · Once ${counts.once} · Migrated ${counts.compatibility ?? 0}\n`);
  output.write(`Main ${config.main.effort} · ${config.main.model ?? 'configured default'} · ${config.main.cwd}\n`);
  output.write(`Background ${config.background.harness} · ${config.background.effort} · ${config.background.model ?? 'configured default'}\n`);
  if (config.launcher) output.write(`Launcher ${config.launcher.command.join(' ')}${config.launcher.managedExtensions ? ' · managed extensions' : ''}\n`);
  output.write(`Initialized ${config.initializedAt} · Main not connected · $${usage.usd.toFixed(4)} estimated (${usage.coverage})\n`);
  output.write(`${indexStatus(resolveDataRoot(options.root))}\n`);
  if (snapshot.savedAt) output.write(`Saved view ${snapshot.savedAt}; not a liveness check\n`);
  for (const item of schedules) {
    const state = item.enabled ? 'enabled' : 'paused';
    const listing = `${state}  ${item.cadence}/${item.id}  ${item.title}  ${whenItRuns(item)}`;
    output.write(`${listing.trimEnd()}\n`);
  }
  for (const error of errors) {
    output.write(`Invalid ${error.path}: ${error.message}\n`);
  }
  return errors.length ? 1 : 0;
}

/** A new person's first failures are about setup, and `/setup` cannot help before Hobkin opens, so these name the command that can. */
export function failureLine({ message, code, path }) {
  const noWorkspace = code === 'ENOENT' && String(path).endsWith('config.json');
  const needsSetup = noWorkspace || message.includes('No models available');
  const failure = noWorkspace ? 'This folder has no Hobkin workspace yet.' : message;
  const nextStep = needsSetup ? 'Run hobkin setup to see what is missing and how to fix it.\n' : '';
  return `Hobkin: ${failure}\n${nextStep}`;
}

if (import.meta.main) {
  main(undefined, undefined, { exit: process.exit }).then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(failureLine(error));
    if (error.diagnostics) process.stderr.write(`${JSON.stringify(error.diagnostics, null, 2)}\n`);
    process.exitCode = 1;
  });
}
