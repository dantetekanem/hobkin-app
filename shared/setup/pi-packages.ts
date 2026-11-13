/**
 * The Pi packages hobkin's agents use, which the setup can install by name (025-onboarding). Plain data, so the list
 * is easy to change. `source` is what `pi install` takes, and it never comes from the window.
 */
export interface PiPackage {
  name: string
  source: string
  /** What it adds, in one short line. */
  adds: string
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
  // hobkin's own optional row in `hobkin setup` (its `src/cli/setup.mjs`).
  { name: 'pi-coder', source: 'npm:pi-coder', adds: "A diff viewer: d on a local PR opens the branch's diff." },
  // Work's harness waits for the agents it starts (hobkin's `src/cli/harnesses.mjs`).
  { name: 'pi-extended-teams', source: 'npm:pi-extended-teams', adds: 'Helper agents: an agent can start others and gets their reports back.' },
  // Change Review reads its search facts, and works with weaker ones without it (032-change-review).
  { name: 'pi-agentic-search', source: 'npm:pi-agentic-search', adds: 'Ranked code search for agents, and the search facts Change Review reads.' },
  { name: 'pi-ask-user', source: 'npm:pi-ask-user', adds: 'An ask_user tool, so an agent can stop and ask the user a question.' },
  { name: 'pi-solid-tasks', source: 'npm:pi-solid-tasks', adds: 'Task tracking for agents, with dependencies, owners, subtasks and progress.' },
  {
    name: 'pi-search-hub',
    // The user's fork, on the branch that holds its fix for Pi 1.5. The published package's OpenAI search imports
    // what Pi 1.5 no longer has.
    source: 'git:github.com/dantetekanem/pi-search-hub@fix/openai-codex-model-runtime',
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
