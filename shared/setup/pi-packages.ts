/**
 * The Pi packages hobkin's agents use, which the setup can install by name (025-onboarding). Plain data, so the list
 * is easy to change. `source` is what `pi install` takes, and it never comes from the window. Each is pinned to the
 * version the setup was tried with on the Pi hobkin pins, and the pins move up with each release. A copy a person
 * already has counts as installed at any version.
 */
export interface PiPackage {
  name: string
  source: string
  /** What it adds, in one short line. */
  adds: string
  /** Setup neither asks for it nor installs it. */
  optional?: boolean
  /** A setting the package needs to work the way hobkin uses it. */
  config?: PiPackageConfig
}

/**
 * A setting file in Pi's own folder, written once the package is installed and only when the file is not there, so
 * a person's own setting is never replaced. It never holds a key.
 */
export interface PiPackageConfig {
  /** Where the file goes, from Pi's own folder, such as `extensions/search.json`. */
  file: string
  value: Record<string, unknown>
}

export const PI_PACKAGES: readonly PiPackage[] = [
  // Work's harness waits for the agents it starts (hobkin's `src/cli/harnesses.mjs`).
  { name: 'pi-extended-teams', source: 'npm:pi-extended-teams@2.8.1', adds: 'Helper agents: an agent can start others and gets their reports back.' },
  // Change Review reads its search facts, and works with weaker ones without it (032-change-review).
  { name: 'pi-agentic-search', source: 'npm:pi-agentic-search@0.8.0', adds: 'Ranked code search for agents, and the search facts Change Review reads.' },
  // The task lists agents keep, which the window shows (`ui/src/features/agent-activity/tasks.ts`).
  { name: 'pi-solid-tasks', source: 'npm:pi-solid-tasks@0.8.18', adds: 'Task tracking for agents, with dependencies, owners, subtasks and progress.' },
  {
    name: 'pi-search-hub',
    optional: true,
    // The user's fork, at the commit on its branch that holds the fix for Pi 1.5 (fix/openai-codex-model-runtime).
    // The published package's OpenAI search imports what Pi 1.5 no longer has.
    source: 'git:github.com/dantetekanem/pi-search-hub@6a09d6c00638c4570a726458da4e50588ee033c0',
    adds: 'Web search and page reading for agents, searching through the OpenAI subscription.',
    // As the user has it, without the backends that need a key of their own. OpenAI search uses Pi's own sign-in.
    config: {
      file: 'extensions/search.json',
      value: {
        defaultBackend: 'openai-codex',
        combine: false,
        showStatus: false,
        backends: {
          duckduckgo: { enabled: true },
          'openai-codex': { enabled: true, model: 'gpt-6.1-sol' },
        },
      },
    },
  },
]
