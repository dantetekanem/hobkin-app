import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const skillText = () => readFileSync(new URL('../prompts/hobkin-skill.md', import.meta.url), 'utf8');

/** Pi's own skills folder unless the user names another, with a leading `~` read as their home, the way a shell reads it. */
export function skillsFolder({ to, home = homedir() } = {}) {
  return resolve(to ? to.replace(/^~(?=$|\/)/, home) : join(home, '.pi', 'agent', 'skills'));
}

/** One file, `<folder>/hobkin/SKILL.md`, holding what `hobkin skill` prints. Nothing else changes. */
export function installSkill(options) {
  const file = join(skillsFolder(options), 'hobkin', 'SKILL.md');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, skillText());
  return [
    `Wrote ${file}.`,
    'Agents that load skills from that folder pick it up in their next session.',
    'For Claude Code, run: hobkin skill install --to ~/.claude/skills',
    'For any other agent, run hobkin skill install --to <its skills folder>, or have it read what hobkin skill prints.',
    'Run it again after updating hobkin, so the copy stays current.',
    '',
  ].join('\n');
}
