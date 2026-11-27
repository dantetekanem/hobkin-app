import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadConfig } from './config.mjs';
import { piCommand, piEnvironment } from './launcher.mjs';
import { resolveDataRoot } from './migration/admission.mjs';
import { loadSchedules } from './schedules.mjs';
import { inspectTools, TLA2TOOLS } from './proof/tools.mjs';

const PI_PACKAGE = '@earendil-works/pi-coding-agent';
// `gh` reaches GitHub, and no tool may hold up a report.
const TIMEOUT_MS = 15000;
const STATE_WIDTH = 'optional'.length;
const STEP_LABELS = { ok: 'Next', missing: 'Fix', optional: 'To add' };
const VERSION = /\d+\.\d+\.\d+\S*/;

const { engines, peerDependencies } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const PI_VERSION = peerDependencies[PI_PACKAGE];
const MINIMUM_NODE = engines.node.replace('>=', '');

const INSTALL_PI = `Run \`npm install -g --ignore-scripts ${PI_PACKAGE}@${PI_VERSION}\`.`;
const MATCH_PI = `${INSTALL_PI} \`pi update\` moves Pi past that version, so skip it. To run a patched Pi, point \`launcher\` in config.json at it: hobkin's runtime README explains how, under "Start Pi through a launcher".`;
const SIGN_IN = 'Sign in to a provider. While Pi has no model it can use, hobkin\'s window shows Connect a model, with every way in. /login in `pi` is the same sign-in.';
const GH_USE = 'Work mode uses it for GitHub PRs. A repository on another host works without it, through that host\'s own CLI, with less to read.';
const INSTALL_QMD = 'Run `npm install -g @tobilu/qmd`. Hobkin finds it the next time it opens, and qmd downloads a 330 MB model the first time it indexes.';
const TLC_ADDS = 'Work mode checks TLA+ models of state machines with it.';
const INSTALL_JAVA = 'Install Java 21 from https://adoptium.net, then run `hobkin proof setup`.';
const SETUP_TLC = `Run \`hobkin proof setup\`. It downloads tla2tools.jar ${TLA2TOOLS.version} into Hobkin's folder and checks it.`;

const promptPath = name => fileURLToPath(new URL(`../prompts/${name}.md`, import.meta.url));
/** Only the running package knows where it lives, so the report names this for the agent to read. */
export const setupGuide = promptPath('setup');

const run = promisify(execFile);
const defaultExec = async (command, args, options) => {
  const { stdout } = await run(command, args, { timeout: TIMEOUT_MS, ...options });
  return stdout;
};

const row = state => (name, detail, fix = null) => ({ name, state, detail, fix });
const ready = row('ok');
const missing = row('missing');
const optional = row('optional');

const count = (number, word) => `${number} ${word}${number === 1 ? '' : 's'}`;
const trouble = ({ absent }, call) => (absent ? 'Not installed.' : `\`${call}\` failed.`);

/** A tool that is missing or broken becomes a row to read, never an error. */
export const askWith = exec => async (command, args, options) => {
  try {
    return { text: String(await exec(command, args, options)) };
  } catch (error) {
    return { failed: true, absent: error.code === 'ENOENT' };
  }
};

/** The main chat runs on this copy, and `pi` on the PATH runs everything else, so each can drift from the pin alone. */
function installedPiSdk() {
  try {
    const manifest = new URL('../package.json', import.meta.resolve(PI_PACKAGE));
    return JSON.parse(readFileSync(manifest, 'utf8')).version;
  } catch {
    return null;
  }
}

function readHome(root) {
  const home = { config: null, schedules: [], errors: [] };

  try {
    const dataRoot = resolveDataRoot(root);
    Object.assign(home, loadSchedules(dataRoot));
    if (existsSync(join(dataRoot, 'config.json'))) home.config = loadConfig(dataRoot);
  } catch (error) {
    home.problem = error.message;
  }

  return home;
}

const homeRow = (root, problem) => missing(
  'Hobkin folder',
  problem,
  `Repair config.json in ${root}.`,
);

const askPi = (ask, launcher, args) => {
  const { command, args: piArgs } = piCommand(launcher, args);
  return ask(command, piArgs, { env: piEnvironment(launcher) });
};

const launcherFix = launcher => `Make \`${launcher.command.join(' ')}\` start Pi ${PI_VERSION}.`;

async function piRow(ask, launcher, sdkVersion) {
  const answer = await askPi(ask, launcher, ['--version']);

  if (answer.absent) {
    const { command } = piCommand(launcher, []);
    return missing(
      'Pi',
      `\`${command}\` is not on your PATH. Checks and work mode start it, so nothing scheduled can run.`,
      launcher ? launcherFix(launcher) : INSTALL_PI,
    );
  }

  const version = answer.text?.match(VERSION)?.[0];
  if (version !== PI_VERSION) {
    const found = version ? `Found ${version}` : 'It did not report a version';
    return missing('Pi', `${found}. Hobkin pins ${PI_VERSION}.`, launcher ? launcherFix(launcher) : MATCH_PI);
  }

  if (!launcher && sdkVersion !== PI_VERSION) {
    return missing(
      'Pi',
      `\`pi\` is ${PI_VERSION}, but the copy the main chat runs on is ${sdkVersion ?? 'missing'}.`,
      'Run `pnpm install` in the Hobkin checkout, then reopen Hobkin.',
    );
  }

  return ready('Pi', `${PI_VERSION}, the version Hobkin pins.`);
}

function nodeRow(version) {
  const newEnough = version.localeCompare(MINIMUM_NODE, 'en', { numeric: true }) >= 0;
  if (newEnough) return ready('Node', `${version}.`);

  return missing(
    'Node',
    `${version}. Hobkin needs ${MINIMUM_NODE} or newer.`,
    'Install a newer Node from https://nodejs.org or your version manager.',
  );
}

/** On a Mac, /usr/bin/git only stands in for the command line tools: run without them, it asks to install them. */
const APPLE_GIT = '/usr/bin/git';

const isProgram = file => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** The program a name runs from the PATH, as execFile finds it, or null. */
const onPath = name => {
  const folders = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  return folders.map(folder => join(folder, name)).find(isProgram) ?? null;
};

/**
 * git in facts, which the app's own setup words for itself: its version, or why it is missing. Apple's stand-in is
 * never run. The git in the developer folder `xcode-select -p` names is asked instead, so a Mac without the command
 * line tools is told so, and never asked to install them.
 */
export async function gitState(ask, { which = onPath, platform = process.platform } = {}) {
  const standIn = platform === 'darwin' && which('git') === APPLE_GIT;
  let git = 'git';
  if (standIn) {
    const folder = await ask('xcode-select', ['-p']);
    const developer = folder.failed ? '' : folder.text.trim();
    if (!developer) return { found: false, why: 'no-tools' };
    git = join(developer, 'usr', 'bin', 'git');
  }

  const answer = await ask(git, ['--version']);
  if (!answer.failed) return { found: true, version: answer.text.match(VERSION)?.[0] ?? null };
  // The folder it names can be gone, as when the tools were deleted.
  if (standIn && answer.absent) return { found: false, why: 'no-tools' };
  return { found: false, why: answer.absent ? 'absent' : 'failed' };
}

async function gitRow(ask, options) {
  const git = await gitState(ask, options);
  if (git.found) return ready('git', `${git.version ?? 'Installed'}.`);

  if (git.why === 'no-tools') {
    return missing(
      'git',
      'The Mac\'s git needs the command line tools, and they are not installed. Work mode needs it for every project.',
      'Run `xcode-select --install`.',
    );
  }

  return missing(
    'git',
    `${trouble({ absent: git.why === 'absent' }, 'git --version')} Work mode needs it for every project.`,
    'Install it from https://git-scm.com/downloads.',
  );
}

async function hobkinRow(ask) {
  const answer = await ask('hobkin', ['--help']);
  if (!answer.failed) return ready('hobkin', 'On your PATH, so agents can run it.');

  const why = answer.absent ? 'Not on your PATH.' : '`hobkin --help` failed.';
  return missing(
    'hobkin',
    `${why} Agents run \`hobkin\` for work mode, sessions and settings, and those commands fail without it.`,
    'Run `pnpm add -g .` in the Hobkin checkout.',
  );
}

/** gh in facts: installed, and signed in as `gh auth status` says. That call reaches GitHub. */
export async function ghState(ask) {
  const answer = await ask('gh', ['auth', 'status']);
  return { installed: !answer.absent, signedIn: !answer.failed };
}

async function ghRow(ask) {
  const { installed, signedIn } = await ghState(ask);

  if (!installed) {
    return missing('gh', `Not installed. ${GH_USE}`, 'Install it from https://cli.github.com, then run `gh auth login`.');
  }

  if (!signedIn) {
    return missing(
      'gh',
      `\`gh auth status\` says you are not signed in, or it could not reach GitHub. ${GH_USE}`,
      'Run `gh auth login`.',
    );
  }

  return ready('gh', `Signed in. ${GH_USE}`);
}

/** Pi prints a table, or a paragraph when it has no model, and the paragraph can hold a path with spaces. */
function listedModels(text = '') {
  const [header, ...lines] = text.split('\n');
  if (!/^provider\s+model\b/.test(header)) return [];

  const columns = lines.map(line => line.trim().split(/\s+/));
  return columns.filter(([, model]) => model).map(([provider, model]) => `${provider}/${model}`);
}

function modelRow(name, setting, saved, answer) {
  if (answer.absent) return missing(name, 'Cannot tell until Pi is installed.', 'Install Pi first, then run this again.');
  if (answer.failed) return missing(name, 'Pi did not list its models.', 'Run `pi --list-models` and read what it says.');

  const models = listedModels(answer.text);
  if (!models.length) return missing(name, 'Pi has no model it can use, so Hobkin cannot run one.', SIGN_IN);
  if (!saved) return ready(name, `Pi's default, from ${count(models.length, 'model')} Pi can use.`);

  // Pi matches a short name itself, so only a full provider/model reference can be judged here.
  if (saved.includes('/') && !models.includes(saved)) {
    return missing(
      name,
      `${saved} is saved, but Pi cannot use it.`,
      `${SIGN_IN} Or set \`${setting}\` in config.json to a model from \`pi --list-models\`.`,
    );
  }

  return ready(name, `${saved}.`);
}

function schedulesRow({ schedules, errors }) {
  const enabled = schedules.filter(schedule => schedule.enabled).length;
  const total = count(schedules.length, 'routine');
  const unread = errors.length ? ` ${count(errors.length, 'file')} could not be read.` : '';
  const seeUnread = errors.length ? 'Run `hobkin routines` to see what is wrong.' : null;

  if (enabled) {
    return ready('Routines', `${total}, ${enabled} enabled. They run while Hobkin is open.${unread}`, seeUnread);
  }

  if (schedules.length) {
    return missing(
      'Routines',
      `${total}, none enabled, so nothing runs.${unread}`,
      'Ask Hobkin in Chat to enable one, or set `enabled` to true in its file.',
    );
  }

  return missing(
    'Routines',
    `None yet, so nothing runs by itself.${unread}`,
    seeUnread ?? `Open Hobkin and ask it to set you up, or follow the routine guide at ${promptPath('routine-setup')}.`,
  );
}

async function qmdRow(ask) {
  const answer = await ask('qmd', ['--version']);
  if (!answer.failed) return ready('qmd', 'Installed. Agents can search what Hobkin keeps.');

  const why = trouble(answer, 'qmd --version');
  return optional('qmd', `${why} Agents read Hobkin's files directly instead of searching them.`, INSTALL_QMD);
}

/** TLC needs Java and the pinned jar, and TLAPS adds proofs. Each row says what it adds, since none of it is needed. */
async function tlcRow(proofTools, root) {
  let home = root;
  try {
    home = resolveDataRoot(root);
  } catch {
    // The home row already says what is wrong with it.
  }
  const { java, jar, tlapm } = await proofTools(home);
  if (!java.path) return optional('tlc', `${java.problem} ${TLC_ADDS}`, INSTALL_JAVA);
  if (!jar) return optional('tlc', `Java ${java.version} is here, but not TLC. ${TLC_ADDS}`, SETUP_TLC);

  const proofs = tlapm ? ' TLAPS is here too, so it proves them as well.' : '';
  return ready('tlc', `TLC ${TLA2TOOLS.version} on Java ${java.version}. ${TLC_ADDS}${proofs}`);
}

const grouped = (rows, group) => rows.map(item => ({ ...item, group }));

/** Reads only, so it is safe at any time, on a home that does not exist yet too. */
export async function setupChecks(root, {
  exec = defaultExec,
  nodeVersion = process.versions.node,
  piSdkVersion = installedPiSdk(),
  proofTools = inspectTools,
  which = onPath,
  platform = process.platform,
} = {}) {
  const ask = askWith(exec);
  const home = readHome(root);
  const { config } = home;
  const launcher = config?.launcher;
  const models = askPi(ask, launcher, ['--no-approve', '--list-models']);

  const needed = await Promise.all([
    ...(home.problem ? [homeRow(root, home.problem)] : []),
    piRow(ask, launcher, piSdkVersion),
    nodeRow(nodeVersion),
    gitRow(ask, { which, platform }),
    hobkinRow(ask),
    ghRow(ask),
    models.then(answer => modelRow('Chat model', 'main.model', config?.main.model, answer)),
    models.then(answer => modelRow('Checks model', 'background.model', config?.background.model, answer)),
    schedulesRow(home),
  ]);
  const extras = await Promise.all([
    qmdRow(ask),
    tlcRow(proofTools, root),
  ]);

  return [...grouped(needed, 'needed'), ...grouped(extras, 'optional')];
}

function rowLines({ name, state, detail, fix }) {
  const line = `  ${state.padEnd(STATE_WIDTH)}  ${name}: ${detail}`;
  if (!fix) return [line];

  const indent = ' '.repeat(STATE_WIDTH + 4);
  return [line, `${indent}${STEP_LABELS[state]}: ${fix}`];
}

function closing(rows) {
  const gaps = rows.filter(item => item.state === 'missing').length;
  if (!gaps) return 'Everything needed is ready.';

  const verb = gaps === 1 ? 'thing is' : 'things are';
  return `${gaps} needed ${verb} missing. Work from the top. Once Pi has a model, Hobkin can walk you through the rest: open it and ask it to set you up.`;
}

export function formatSetup(root, rows) {
  const section = (title, group) => [title, ...rows.filter(item => item.group === group).flatMap(rowLines), ''];

  return [
    `Hobkin setup · ${root}`,
    'This only reads. Nothing was installed or changed.',
    '',
    ...section('Needed', 'needed'),
    ...section('Optional', 'optional'),
    closing(rows),
    `Setup guide: ${setupGuide}`,
    '',
  ].join('\n');
}

/** A report, so anything missing still exits 0. */
export async function printSetup(root, output, options) {
  output.write(formatSetup(root, await setupChecks(root, options)));
  return 0;
}
