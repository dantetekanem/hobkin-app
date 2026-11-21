import { isAbsolute, sep } from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
import { resolveResourcePolicy } from './resource-policy.mjs';
import { fileURLToPath } from 'node:url';
import { ownedRoleTools } from './owned-agent-extension.mjs';
import { SHIPPED_SKILLS } from './skills-extension.mjs';

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

/** Trusted inventory metadata only; selections without a provider are unavailable, never discovered implicitly. */
export function mainSdkResources(selection, candidates = []) {
  const policy = resolveResourcePolicy(selection, 'main', candidates);
  if (policy.selected.mcp.length || policy.selected.tools.length) throw Error('Selected MCP/tool binding is unavailable in the main SDK.');
  const paths = kind => policy.selected[kind].map(id => {
    const path = candidates.find(candidate => candidate.id === id)?.path;
    if (typeof path !== 'string' || !isAbsolute(path) || !lstatSync(path).isFile()) {
      throw Error('Selected resource requires an installed absolute regular-file path.');
    }
    return path;
  });
  const builtinPaths = ['builtin:codemode', 'builtin:tool-search'];
  const instructions = paths('instructions').map(path => ({ path, content: readFileSync(path, 'utf8') }));
  const skills = paths('skills'), templates = paths('templates'), extensions = paths('extensions');
  // hobkin's own skills load whatever is chosen. Only the chosen ones must load for the chat to start.
  const loadedSkills = [...SHIPPED_SKILLS, ...skills];
  const selectedOnly = (items, allowed, key) => {
    if (items.some(item => !allowed.includes(item[key]))) throw Error('Unexpected inherited resource re-enabled.');
    return items;
  };
  return {
    builtinTools: policy.builtinTools,
    assertLoaded(loader) {
      const loaded = loader.getExtensions();
      const skillResult = loader.getSkills(), promptResult = loader.getPrompts();
      if (loaded.errors.length || [...skillResult.diagnostics, ...promptResult.diagnostics].some(item => item.type === 'error')) {
        throw Error('Selected SDK resources failed to load; inspect resourceLoader diagnostics.');
      }
      for (const [expected, actual, key] of [
        [[...builtinPaths, ...extensions], loaded.extensions, 'path'], [skills, skillResult.skills, 'filePath'], [templates, promptResult.prompts, 'filePath'],
      ]) {
        if (expected.some(path => !actual.some(item => item[key] === path))) throw Error('Selected SDK resource is unavailable after loading.');
      }
    },
    loader: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true, noThemes: true,
      additionalExtensionPaths: [...builtinPaths, ...extensions],
      additionalSkillPaths: loadedSkills, additionalPromptTemplatePaths: templates,
      agentsFilesOverride: () => ({ agentsFiles: instructions }),
      systemPrompt: '', systemPromptOverride: () => undefined,
      skillsOverride: base => ({ ...base, skills: selectedOnly(base.skills, loadedSkills, 'filePath') }),
      promptsOverride: base => ({ ...base, prompts: selectedOnly(base.prompts, templates, 'filePath') }),
      themesOverride: base => ({ ...base, themes: [] }),
    },
  };
}

/** Owned children never discover extensions; managed wrappers cannot promise this contract yet. */
export function ownedExtensionArguments(role, launcher) {
  if (role === 'theme' && launcher !== undefined) {
    throw Error('Theme requires installed Pi without a configured launcher');
  }
  if (launcher?.managedExtensions) throw Error('Managed launcher cannot isolate owned children');
  return [
    ...(role === 'theme'
      ? ['--no-builtin-tools', '--no-context-files']
      : []),
    ...extensionArguments([fileURLToPath(new URL('./owned-agent-extension.mjs', import.meta.url))]),
    '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes',
    '--tools', ownedRoleTools(role).join(','), '--exclude-tools', 'mcp__*',
  ];
}

// Pi cannot leave out one extension, so it is told to discover none and given the list.
export const extensionArguments = paths => (paths ? ['--no-extensions', ...paths.flatMap(path => ['--extension', path])] : []);
