import { fileURLToPath } from 'node:url';
import { guardCodeToolAbort } from './code-tool-crash.mjs';
import { defaultRoot } from './config.mjs';
import { directionsSection, readDirections } from './directions.mjs';

/**
 * Loaded by every agent a hobkin run spawns with pi-extended-teams, and by the agents those spawn: teams loads what
 * `PI_EXTENDED_TEAMS_AGENT_EXTENSIONS` names into each agent it starts, and each inherits the variable from the run.
 * The run itself does not load it, since its directions come with its request.
 */
export const directionsExtension = fileURLToPath(import.meta.url);

/** What every hobkin run's Pi is started with. The same for every run, so a kept process's start never differs by it. */
export const AGENTS_ENVIRONMENT = Object.freeze({ PI_EXTENDED_TEAMS_AGENT_EXTENSIONS: directionsExtension });

/**
 * The main chat's directions section, read once as the agent starts, so an edit reaches the next agent and never
 * changes one mid-task. The home is the one a `hobkin` command the agent runs would use (`defaultRoot`): hobkin on any
 * home but the real one names it in `HOBKIN_HOME` for every process it starts. Each agent also gets the guard against
 * Pi's code tool crash (`code-tool-crash.mjs`).
 */
export default function agentDirections(pi, { root = defaultRoot() } = {}) {
  guardCodeToolAbort();
  let section;
  pi.on('before_agent_start', event => {
    section ??= directionsSection(readDirections(root));
    return { systemPrompt: `${event.systemPrompt}\n\n${section}` };
  });
}
