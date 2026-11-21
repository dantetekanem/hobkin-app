import { fileURLToPath } from 'node:url';

/**
 * The Pi skills hobkin ships in `src/skills`, each by its SKILL.md. The main chat names them to its resource loader
 * (`pi-extensions.mjs`), or with `--skill` under a launcher (`rpc-session.mjs`). A work run gets them from this file, a Pi
 * extension that adds them through Pi's own `resources_discover` event.
 */
export const TLA_SKILL = fileURLToPath(new URL('../skills/tla-plus/SKILL.md', import.meta.url));
export const SHIPPED_SKILLS = Object.freeze([TLA_SKILL]);

export const skillsExtension = fileURLToPath(import.meta.url);

const WORK_PURPOSES = ['work-discover', 'work-look', 'work-do'];

/** Adds this extension to a work run's extensions. A launcher picks its own, so a run with no list is left alone. */
export function withShippedSkills(run) {
  return (request, options) => {
    const isWork = WORK_PURPOSES.includes(request.purpose);
    if (!isWork || !request.extensions) return run(request, options);

    return run({ ...request, extensions: [...request.extensions, skillsExtension] }, options);
  };
}

export default function shippedSkills(pi) {
  pi.on('resources_discover', () => ({ skillPaths: [...SHIPPED_SKILLS] }));
}
