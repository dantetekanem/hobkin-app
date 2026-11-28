#!/usr/bin/env node
import { resolve } from 'node:path';
import { defaultRoot, initialize, legacySources, loadConfig } from './config.mjs';
import { loadImportedHistory } from './history.mjs';
import { indexStatus } from './memory-index.mjs';
import { runFeedbackCommand } from './feedback/outbox.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { readLocalView } from './view.mjs';
import { deleteReports } from './reports.mjs';
import { reportReadStates } from './telemetry.mjs';
import { inRoutineWords, whenItRuns } from './schedules.mjs';
import { HOBKIN_VERSION } from './version.mjs';

const DAY_MS = 86400000;
const DEFAULT_TELEMETRY_DAYS = 30;
const DEFAULT_WINS_DAYS = 7;
const COMMANDS_WITH_WORDS = ['reports', 'work', 'learning', 'profile', 'decide', 'action', 'decisions', 'remind', 'remember', 'skill', 'routines', 'schedules', 'schedule', 'feedback', 'telemetry', 'canvas'];
// A durable hobkin's turn is inside hobkin, so it passes words on with `hobkin tell`, never with these.
const NOT_IN_A_TURN = ['remember', 'remind', 'decide', 'action', 'session'];

export function parseArguments(args) {
  const values = [...args];
  const options = { command: 'status', root: resolve(defaultRoot()), explicitRoot: false, plain: false, args: [] };
  if (values[0] && !values[0].startsWith('-')) options.command = values.shift();
  // `tell` takes `--home` and help before its recipient. After the recipient every word is the message as typed, flags and all.
  while (options.command === 'tell' && values.length) {
    const flag = values.shift();
    if (options.args.length) options.args.push(flag);
    else if (flag === '--home' && values[0] && !values[0].startsWith('-')) {
      options.root = resolve(values.shift());
      options.explicitRoot = true;
    } else if (flag === '--help' || flag === '-h') options.command = 'help';
    else if (flag.startsWith('-')) throw Error(`Unknown or incomplete option: ${flag}`);
    else options.args.push(flag);
  }
  // `proof` reads its own flags, such as `check <spec> --cfg file`, and `memory` its own, such as `search <words> --kind
  // date`, so only `--home` is taken here.
  while ((options.command === 'proof' || options.command === 'memory') && values.length) {
    const flag = values.shift();
    if (flag === '--home' && values[0] && !values[0].startsWith('-')) {
      options.root = resolve(values.shift());
      options.explicitRoot = true;
    } else options.args.push(flag);
  }
  while (values.length) {
    const flag = values.shift();
    if (flag === '--home' && values[0] && !values[0].startsWith('-')) {
      options.root = resolve(values.shift());
      options.explicitRoot = true;
    } else if (['--title', '--cwd'].includes(flag) && values[0] && !values[0].startsWith('-')) {
      options[flag.slice(2)] = values.shift();
    } else if (options.command === 'work' && ['--state', '--brief'].includes(flag) && values.length) {
      options[flag.slice(2)] = values.shift();
    } else if (['telemetry', 'wins'].includes(options.command) && flag === '--days' && values.length) {
      options.days = values.shift();
    } else if (['remind', 'remember', 'decide'].includes(options.command) && flag === '--from' && values[0] && !values[0].startsWith('-')) {
      options.from = values.shift();
    } else if (options.command === 'remind' && flag === '--on' && values.length) {
      options.on = values.shift();
    } else if (options.command === 'decisions' && flag === '--typed' && values.length) {
      options.typed = values.shift();
    } else if (options.command === 'canvas' && flag === '--hobkin' && values[0] && !values[0].startsWith('-')) {
      options.hobkin = values.shift();
    } else if (options.command === 'skill' && flag === '--to' && values[0] && !values[0].startsWith('-')) {
      options.to = values.shift();
    } else if (flag === '--plain') {
      // Every status prints the saved state, so --plain changes nothing. Agents that still pass it get the same.
      options.plain = true;
    }
    else if (flag === '--keep' && options.command === 'session') options.keep = true;
    else if (flag === '--wake' && options.command === 'session') options.wake = true;
    else if (flag === '--approved' && options.command === 'session') options.approved = true;
    else if (flag === '--tier' && options.command === 'session' && values[0] && !values[0].startsWith('-')) options.tier = values.shift();
    else if (['--help', '-h'].includes(flag) && options.command === 'work') options.args.unshift('help');
    else if (['--auto', '--decline', '--goal'].includes(flag) && options.command === 'work') options.args.push(flag);
    else if (flag === '--help' || flag === '-h') options.command = 'help';
    else if (flag === '--version' || flag === '-v') options.command = 'version';
    else if (COMMANDS_WITH_WORDS.includes(options.command) && (!flag.startsWith('-') || (options.command === 'canvas' && flag === '-'))) options.args.push(flag);
    else throw Error(`Unknown or incomplete option: ${flag}`);
  }
  return options;
}

/** What another process hands over goes only to a real workspace, so a wrong folder fails instead of starting one that no hobkin reads. */
function workspaceRoot(requested) {
  loadConfig(requested);
  return resolveDataRoot(requested);
}

export async function main(args = process.argv.slice(2), output = process.stdout, dependencies = {}) {
  const options = parseArguments(args);
  if (NOT_IN_A_TURN.includes(options.command) && (dependencies.env ?? process.env).HOBKIN_TURN) {
    throw Error(`Inside a durable hobkin's turn, hobkin ${options.command} is not for you. To pass words to the main hobkin, run hobkin tell main.`);
  }
  if (options.command === 'version') {
    output.write(`hobkin ${HOBKIN_VERSION}\n`);
    return 0;
  }
  if (options.command === 'help') {
    output.write(`hobkin ${HOBKIN_VERSION}\n`);
    output.write('Usage: hobkin [command] [options]\n  version  print the version hobkin runs\n  init | routines | status | history  [--home directory]\n  routines templates  list the routine templates setup offers, hobkin\'s and yours from routines/templates, as JSON\n  reports [delete ID... | catch-up]  list the Reports inventory as JSON, each with whether it was read, delete reports by ID, or ask the running hobkin for one short catch-up report over the unread ones\n  telemetry [--days n]  print what happened in hobkin as JSON, from this machine only, 30 days by default\n  telemetry <view> [--days n]  print one view of those events as JSON, such as questions, interruptions or presence; telemetry help lists them all\n  telemetry upload [on | off | status]  turn the upload of usage events to hobkin\'s server on or off, on by default once this machine is enrolled, or say what goes and where\n  feedback [list | on | off | delete <id>]  list the feedback reports and their state, turn sending on or off, or delete a report here and on the server\n  wins [--days n]  print what got done each day as JSON: work merged, decisions made and the days in a row, 7 days by default\n  setup  check what Hobkin needs, change nothing, and say how to fix what is missing\n  skill [install [--to folder]]  print a skill that teaches other agents to work with hobkin, or install it where agents load skills, ~/.pi/agent/skills by default\n  remind <text> --on YYYY-MM-DD [--from name]  save a reminder that hobkin brings up on that day\n  remember <text> [--from name]  hand hobkin\'s main agent a fact or preference to keep\n  decide [routine <id> | work <project> <item> | --from name]  file the question on stdin as JSON in Decisions\n  pending  print what is waiting on the user, across every routine and work mode, as JSON\n  work [help | status | start | stop | pause | resume | add | trigger | cancel | ...]  drive work mode; work help lists it all\n  proof check <spec.tla> [--cfg file] [--project slug] [--item id] [--head sha] [--workers n] [--minutes n]  parse a TLA+ spec with SANY, check its model with TLC and prove it with TLAPS when it has a proof, and record the run in proofs/\n  proof stop <id> | proof setup  stop a proof run, or download the pinned TLC into tools/tla\n  learning [on | off | clear <id> | clear all | answer <id> yes|later|no]  show what Hobkin learned, set it, remove lessons or answer a proposal\n  profile [name <text> | call <text> | email <text> | clear [name | call | email]]  show or set who the user is and what to call them\n  canvas show <url> | draw <file|-> | read | save [path] | close  [--title text] [--hobkin id]  show a page or a drawing on a canvas, the main one or a durable hobkin, by writing the files the running app follows\n  tell [main | <id>] [<words> | -]  inside a durable hobkin\'s turn only: message the main hobkin or another durable hobkin, or with nothing after it, list who you can reach\n  schedule [list | make | cancel <id> | pause <id> | resume <id> | run <id>]  inside a run hobkin started on Claude Code only: keep schedules for yourself, as the hobkin_schedule tool does, with make reading the schedule as JSON on stdin\n  memory [list [kind] | get <name> | search <words> [--kind kind] | add | change | forget <name> | restore <name> | suggest]  read what hobkin remembers about the user, as the hobkin_recall tool does, never a private memory outside a durable hobkin\'s turn; inside one, save too, with add and change reading the memory as JSON on stdin; suggest hands one to the main hobkin from a run\n  session --tier fast|mid|high|max [--title name] [--cwd directory] [--keep | --wake] [--approved]  hand the brief on stdin to a full Pi session that the running hobkin starts as a job in its agents list, on the model of the tier its work needs, with --keep starts it as a durable hobkin that stays and waits for the user, and with --wake gives the main agent a turn when it ends\n');
    return 0;
  }
  if (options.command === 'setup') {
    const { printSetup } = await import('./setup.mjs');
    return printSetup(options.root, output, dependencies);
  }
  if (options.command === 'skill') {
    const { installSkill, skillText } = await import('./skill.mjs');
    const action = options.args.join(' ');
    if (action === 'install') output.write(installSkill({ to: options.to }));
    else if (!action && !options.to) output.write(skillText());
    else throw Error('Usage: hobkin skill [install [--to <skills folder>]]');
    return 0;
  }
  if (options.command === 'remind' || options.command === 'remember') {
    const { remember, remind } = await import('./inbox.mjs');
    const handOver = options.command === 'remind' ? remind : remember;
    const root = workspaceRoot(options.root);
    // A run hobkin started says so in its environment, and its `remember` is a suggestion (057-shared-memory).
    const saved = handOver(root, { words: options.args, on: options.on, from: options.from }, undefined, { env: dependencies.env ?? process.env });
    output.write(`${JSON.stringify(saved, null, 2)}\n`);
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
    const root = workspaceRoot(options.root);
    const input = dependencies.input ?? process.stdin;
    const filed = await runDecideCommand(root, options.args, input, Date.now(), options.from);
    output.write(`${JSON.stringify(filed, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'canvas') {
    const { runCanvasCommand } = await import('./canvas.mjs');
    const result = await runCanvasCommand(workspaceRoot(options.root), options.args, { hobkin: options.hobkin, title: options.title, input: dependencies.input, env: dependencies.env });
    output.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (options.command === 'tell') {
    const { runTellCommand } = await import('./hobkin-tell.mjs');
    // The home of the running hobkin, which a durable hobkin's turn is given as HOBKIN_HOME.
    const result = await runTellCommand(resolveDataRoot(options.root), options.args, { env: dependencies.env, input: dependencies.input });
    output.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (options.command === 'memory') {
    const { runMemoryCommand } = await import('./memory-command.mjs');
    // Inside a durable hobkin's turn it asks the running hobkin of HOBKIN_HOME; anywhere else it reads the home itself.
    const result = await runMemoryCommand(resolveDataRoot(options.root), options.args, { env: dependencies.env, input: dependencies.input });
    output.write(`${result.text}\n`);
    return 0;
  }
  if (options.command === 'schedule') {
    const { runScheduleCommand } = await import('./agent-schedule-command.mjs');
    // The home of the running hobkin, which a run on Claude Code is given as HOBKIN_HOME with its token.
    const result = await runScheduleCommand(resolveDataRoot(options.root), options.args, { env: dependencies.env, input: dependencies.input });
    output.write(`${JSON.stringify(result)}\n`);
    return 0;
  }
  if (options.command === 'action') {
    const { runActionCommand } = await import('./decisions.mjs');
    const root = workspaceRoot(options.root);
    const input = dependencies.input ?? process.stdin;
    const result = await runActionCommand(root, options.args, input);
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'decisions') {
    const root = workspaceRoot(options.root);
    // `rules` lists what the user settled for good, and `always <id> [value]` answers a card and keeps that answer as a rule (075).
    if (options.args[0] === 'rules') {
      const { runRulesCommand } = await import('./standing-rules.mjs');
      output.write(`${JSON.stringify(runRulesCommand(root, options.args.slice(1)), null, 2)}\n`);
      return 0;
    }
    const { markAlways } = await import('./decisions.mjs');
    const args = options.args[0] === 'always' ? markAlways(root, options.args.slice(1)) : options.args;
    const { runDecisionsCommand } = await import('./answer.mjs');
    const result = await runDecisionsCommand(root, args, { typed: options.typed });
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'action') {
    const { runActionCommand } = await import('./decisions.mjs');
    output.write(`${JSON.stringify(await runActionCommand(options.root, options.args, dependencies.input ?? process.stdin), null, 2)}\n`);
    return 0;
  }
  if (options.command === 'pending') {
    const { readPending } = await import('./pending-read.mjs');
    const { total, groups } = readPending(options.root);
    output.write(`${JSON.stringify({ total, groups }, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'session') {
    const { readBrief, startSession } = await import('./session.mjs');
    const { TIER_NEEDED } = await import('./tiers.mjs');
    // The tier decides the model that does the work, so it is never left to a default: whoever hands the job over says what it needs.
    if (!options.tier) throw Error(TIER_NEEDED);
    const brief = await readBrief(dependencies.input ?? process.stdin);
    const started = await startSession({ root: resolveDataRoot(options.root), title: options.title, cwd: options.cwd, brief, keep: options.keep, wake: options.wake, approved: options.approved, tier: options.tier });
    output.write(`${JSON.stringify(started, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'proof') {
    const { runProofCommand } = await import('./proof/commands.mjs');
    return runProofCommand(resolveDataRoot(options.root), options.args, output, { signals: dependencies.signals });
  }
  if (options.command === 'work') {
    const { printWorkCommand } = await import('./work/commands.mjs');
    return printWorkCommand(options, output, dependencies.input ?? process.stdin);
  }
  if (options.command === 'reports') {
    const inventory = () => readLocalView(options.root).reports;
    if (!options.args.length) {
      // Whether each was read comes from the reads themselves, not from the copy the running hobkin last saved (069-report-catch-up).
      const states = reportReadStates(resolveDataRoot(options.root));
      const reports = inventory().map(({ readState, ...report }) => ({ ...report, read: states.get(report.id) ?? 'unread' }));
      output.write(`${inRoutineWords(JSON.stringify(reports, null, 2))}\n`);
      return 0;
    }
    const [action, ...ids] = options.args;
    if (action === 'catch-up' && !ids.length) {
      const { requestCatchUp } = await import('./catch-up.mjs');
      output.write(`${JSON.stringify(requestCatchUp(options.root), null, 2)}\n`);
      return 0;
    }
    if (action !== 'delete' || !ids.length) throw Error('Usage: hobkin reports [delete ID... | catch-up]');

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
  if (options.command === 'wins') {
    const days = Number(options.days ?? DEFAULT_WINS_DAYS);
    if (!Number.isInteger(days) || days < 1) throw Error('Usage: hobkin wins [--days n]');

    const { winsReport } = await import('./work/wins.mjs');
    output.write(`${JSON.stringify(winsReport(resolveDataRoot(options.root), { days }), null, 2)}\n`);
    return 0;
  }
  if (options.command === 'feedback') {
    const result = await runFeedbackCommand(workspaceRoot(options.root), options.args, { fetch: dependencies.fetch });
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'telemetry' && options.args[0] === 'upload') {
    const { runUploadCommand, UPLOAD_USAGE } = await import('./telemetry/sender.mjs');
    if (options.days !== undefined) throw Error(UPLOAD_USAGE);

    const result = runUploadCommand(workspaceRoot(options.root), options.args.slice(1));
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (options.command === 'telemetry' && options.args.length) {
    const { telemetryHelp, telemetryView, VIEW_USAGE } = await import('./telemetry/views.mjs');
    const [view, ...extra] = options.args;
    const days = Number(options.days ?? DEFAULT_TELEMETRY_DAYS);
    if (extra.length || !Number.isInteger(days) || days < 1) throw Error(VIEW_USAGE);

    if (view === 'help') output.write(telemetryHelp(DEFAULT_TELEMETRY_DAYS));
    else output.write(`${JSON.stringify(telemetryView(resolveDataRoot(options.root), view, { days }), null, 2)}\n`);
    return 0;
  }
  if (options.command === 'telemetry') {
    const days = Number(options.days ?? DEFAULT_TELEMETRY_DAYS);
    if (!Number.isInteger(days) || days < 1) throw Error('Usage: hobkin telemetry [--days n]');

    const { eventRollup, readEvents } = await import('./events.mjs');
    const { landedRecords, scoreboard } = await import('./work/scoreboard.mjs');
    const dataRoot = resolveDataRoot(options.root);
    const since = Date.now() - days * DAY_MS;
    const events = readEvents(dataRoot, { since });
    const landed = landedRecords(dataRoot).filter(({ at }) => Date.parse(at) >= since);
    output.write(`${inRoutineWords(JSON.stringify({ ...eventRollup(events), scoreboard: scoreboard(events, landed) }, null, 2))}\n`);
    return 0;
  }
  if (options.command === 'history') {
    output.write(`${JSON.stringify(loadImportedHistory(options.root), null, 2)}\n`);
    return 0;
  }
  // `schedules` is the command's old name, and agents can still have it in their memory.
  if (['routines', 'schedules'].includes(options.command) && options.args.length) {
    if (options.args.join(' ') !== 'templates') throw Error('Usage: hobkin routines [templates]');
    const { listTemplates } = await import('./routine-templates.mjs');
    output.write(`${JSON.stringify(listTemplates(resolveDataRoot(options.root)), null, 2)}\n`);
    return 0;
  }
  if (!['init', 'routines', 'schedules', 'status'].includes(options.command)) throw Error(`Unknown command: ${options.command}`);
  if (options.command === 'init') initialize(options.root, { legacySources: options.explicitRoot ? [] : legacySources() });
  const snapshot = readLocalView(options.root);
  const { config, schedules, counts, errors, usage } = snapshot;
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
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(failureLine(error));
    if (error.diagnostics) process.stderr.write(`${JSON.stringify(error.diagnostics, null, 2)}\n`);
    process.exitCode = 1;
  });
}
