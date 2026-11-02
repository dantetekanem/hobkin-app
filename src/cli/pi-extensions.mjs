import { sep } from 'node:path';

// Naming extensions turns off the ones Pi adds by itself, so its built-in ones are named too.
const PI_BUILT_INS = ['llama.cpp', 'codemode', 'tool-search', 'mcp'];
// Hobkin has its own face. This stays out of the chat and background runs, and stays installed in Pi. A pane is the user's own Pi, so it keeps it.
const LEFT_OUT = 'pi-emote';

const kept = ({ enabled, path }) => enabled && !path.split(sep).includes(LEFT_OUT);

/** What Pi would load in this folder, without the extensions Hobkin leaves out. Nothing is loaded or installed to find out. */
export async function extensionPaths(cwd, { agentDir, builtIns = PI_BUILT_INS } = {}) {
  const { DefaultPackageManager, SettingsManager, getAgentDir } = await import('@earendil-works/pi-coding-agent');
  const directory = agentDir ?? getAgentDir();
  const settingsManager = SettingsManager.create(cwd, directory);
  const manager = new DefaultPackageManager({ cwd, agentDir: directory, settingsManager, builtinExtensions: builtIns });
  const { extensions } = await manager.resolve(async () => 'skip');
  return extensions.filter(kept).map(({ path }) => path);
}

// Pi cannot leave out one extension, so it is told to discover none and given the list.
export const extensionArguments = paths => (paths ? ['--no-extensions', ...paths.flatMap(path => ['--extension', path])] : []);
