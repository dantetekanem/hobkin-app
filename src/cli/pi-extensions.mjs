import { sep } from 'node:path';

// Naming extensions turns off the ones Pi adds by itself, so its built-in ones are named too.
const PI_BUILT_INS = ['llama.cpp', 'codemode', 'tool-search', 'mcp'];
// Hobkin has its own face. This stays out of the chat and background runs, and stays installed in Pi. A pane is the user's own Pi, so it keeps it.
const LEFT_OUT = ['pi-emote'];
/**
 * The main chat compacts by hobkin's rule and keeps hobkin's memory. One package holds compaction off until the window is nearly full, which let
 * the chat reach 420K tokens and lose its own past, and one adds a second memory beside hobkin's. The scheduler gave the main agent timers of its
 * own beside hobkin's routines, and posted what they found as if the user had typed it. All three stay installed and in every other run.
 */
export const LEFT_OUT_OF_THE_MAIN_CHAT = ['pi-cache-compact-preserved-messages', 'pi-memory', 'pi-scheduler'];

const keptWithout = names => ({ enabled, path }) => enabled && !path.split(sep).some(part => names.includes(part));

/** What Pi would load in this folder, without the extensions Hobkin leaves out. Nothing is loaded or installed to find out. */
export async function extensionPaths(cwd, { agentDir, builtIns = PI_BUILT_INS, leaveOut = [] } = {}) {
  const { DefaultPackageManager, SettingsManager, getAgentDir } = await import('@earendil-works/pi-coding-agent');
  const directory = agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(cwd, directory);
  const manager = new DefaultPackageManager({ cwd, agentDir: directory, settingsManager, builtinExtensions: builtIns });
  const { extensions } = await manager.resolve(async () => 'skip');
  return extensions.filter(keptWithout([...LEFT_OUT, ...leaveOut])).map(({ path }) => path);
}

// Pi cannot leave out one extension, so it is told to discover none and given the list.
export const extensionArguments = paths => (paths ? ['--no-extensions', ...paths.flatMap(path => ['--extension', path])] : []);
