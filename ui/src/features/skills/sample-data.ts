import type { SkillEntry, SkillFile, SkillsState } from '#shared/pi-resources/wire.ts'

/**
 * Skills for a window with no host, labelled as sample data on screen. Nothing here is read from Pi, and turning one
 * off changes only this list.
 */

const skill = (name: string, description: string, extra: Partial<SkillEntry> = {}): SkillEntry => {
  const path = `~/.pi/agent/skills/${name}/SKILL.md`
  return { path, file: path, name, description, on: true, from: 'folder', package: null, shadowedBy: null, commandOnly: false, problem: null, ...extra }
}

const RESEARCH = { source: 'https://github.com/example/pi-research', name: 'github.com/example/pi-research' }

export const SAMPLE_SKILLS: SkillsState = {
  settings: '~/.pi/agent/settings.json',
  skills: [
    skill('pdf-tools', 'Extract text and tables from PDF files. Use when reading, converting, or inspecting PDFs.'),
    skill('code-review', 'Review a change for correctness bugs before it is merged. Use when asked to review a diff, a branch or a pull request.'),
    skill('release-notes', 'Write release notes from the pull requests merged since the last tag. Use when a version is cut.', {
      file: '~/Projects/skills/release-notes/SKILL.md',
    }),
    skill('deploy-checklist', 'Walk through the deploy checklist one step at a time, and stop at the first step that fails.', { commandOnly: true }),
    skill('house-style', 'Keep product copy in the house style: short sentences, plain words, no hype.', { on: false }),
    skill('drafts', '', { problem: 'description is required' }),
    skill('find-skills', 'Find a published skill for a task, and say how to add it.', {
      from: 'agents',
      path: '~/.agents/skills/find-skills/SKILL.md',
      file: '~/.agents/skills/find-skills/SKILL.md',
    }),
    skill('research-plan', 'Plan a research run: the question, how an answer is measured, and the budget.', {
      from: 'package',
      package: RESEARCH,
      path: '~/.pi/agent/git/github.com/example/pi-research/skills/research-plan/SKILL.md',
      file: '~/.pi/agent/git/github.com/example/pi-research/skills/research-plan/SKILL.md',
    }),
    skill('code-review', 'Review code the way this package likes it.', {
      from: 'package',
      package: RESEARCH,
      path: '~/.pi/agent/git/github.com/example/pi-research/skills/code-review/SKILL.md',
      file: '~/.pi/agent/git/github.com/example/pi-research/skills/code-review/SKILL.md',
      shadowedBy: '~/.pi/agent/skills/code-review/SKILL.md',
    }),
  ],
  problems: [],
  readAt: null,
  error: null,
}

/** A sample skill in full, for View more. */
export function sampleFile(skill: SkillEntry): SkillFile {
  const body = skill.problem
    ? `# ${skill.name}\n\nNotes for later.`
    : `# ${skill.name}\n\nRead the request, then follow these steps.\n\n1. Find what the task needs.\n2. Do the smallest thing that answers it.\n3. Say what was done, and what is left.\n\n## Before you finish\n\n- Check the result against the request.\n- Name anything you could not check.`
  return { path: skill.path, name: skill.name, description: skill.description, body, cut: false }
}
