import type { SkillEntry } from '#shared/pi-resources/wire.ts'

/** The skills of one place Pi finds them, in Pi's order: its own folder, the Agent Skills folder, its settings, then each package. */
export interface SkillGroup {
  key: string
  label: string
  line: string
  skills: SkillEntry[]
}

const PLACES: Record<SkillEntry['from'], { label: string; line: string }> = {
  folder: { label: 'Your skills', line: "In Pi's own skills folder." },
  agents: { label: 'Agent Skills folder', line: 'In ~/.agents/skills, which other coding agents read too.' },
  settings: { label: "Named in Pi's settings", line: "Each one a path in Pi's settings." },
  // A package's skills are grouped by their package. This is only for one that names none.
  package: { label: 'From a package', line: 'From a Pi package.' },
}

/** The places in the order Pi reads them. The packages come after them, each where its first skill comes. */
const ORDER: readonly string[] = ['folder', 'agents', 'settings']

/** The group a skill starts when it is the first one of its place or its package. */
function groupStartedBy(skill: SkillEntry, key: string): SkillGroup {
  if (skill.package) return { key, label: skill.package.name, line: `From the Pi package ${skill.package.source}.`, skills: [] }
  return { key, ...PLACES[skill.from], skills: [] }
}

export function groupsOf(skills: readonly SkillEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>()
  for (const skill of skills) {
    const key = skill.package ? `package:${skill.package.source}` : skill.from
    const group = groups.get(key) ?? groupStartedBy(skill, key)
    group.skills.push(skill)
    groups.set(key, group)
  }

  const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length)
  return [...groups.values()].sort((left, right) => rank(left.key) - rank(right.key))
}

/** The skills whose name or description holds every word typed, in any case. */
export function matching(skills: readonly SkillEntry[], query: string): SkillEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...skills]
  return skills.filter((skill) => {
    const text = `${skill.name} ${skill.description} ${skill.package?.name ?? ''}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}
