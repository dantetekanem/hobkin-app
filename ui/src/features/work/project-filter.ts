import type { FinishedGroup, QueueRow, WorkProject } from '#shared/protocol/work.ts'

/**
 * The Work page's project filter: which projects get a chip and what each section keeps for one. It is a view only,
 * over the state the page already has. Pure, so it is tested without a window.
 */

export interface FilterPage<Agent extends { project: string }> {
  finished: FinishedGroup[]
  queue: QueueRow[]
  agents: Agent[]
}

export interface Chip {
  slug: string
  name: string
  /** Finished changes waiting for the user. */
  count: number
}

/** The project an agent belongs to: hobkin names an agent's project by its name or its folder, which is its slug. */
function slugOfAgent(project: string, projects: readonly Pick<WorkProject, 'slug' | 'name'>[]): string | null {
  const wanted = project.toLowerCase()
  return projects.find(({ slug, name }) => slug.toLowerCase() === wanted || name.toLowerCase() === wanted)?.slug ?? null
}

/** One chip per project with something on the page, the most finished changes first and then by name. */
export function chipsOf<Agent extends { project: string }>(page: FilterPage<Agent>, projects: readonly Pick<WorkProject, 'slug' | 'name'>[]): Chip[] {
  const chips = new Map<string, Chip>()
  const touch = (slug: string, name: string): Chip => {
    let chip = chips.get(slug)
    if (!chip) chips.set(slug, (chip = { slug, name: projects.find((project) => project.slug === slug)?.name ?? name, count: 0 }))
    return chip
  }
  for (const { changes } of page.finished) for (const change of changes) touch(change.slug, change.project).count++
  for (const { slug, project } of page.queue) if (slug) touch(slug, project)
  for (const { project } of page.agents) {
    const slug = slugOfAgent(project, projects)
    if (slug) touch(slug, project)
  }
  return [...chips.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** The chosen project when it has a chip, and All (null) when nothing is chosen or the project is gone. */
export function resolveChoice(choice: string | null, chips: readonly Chip[]): string | null {
  return choice !== null && chips.some(({ slug }) => slug === choice) ? choice : null
}

/**
 * What each section keeps for one project. A stack's layers all carry their project's slug, so a stack is kept or left
 * whole. A group that loses nothing is the same object, and one left empty is dropped. All (or an unknown project)
 * gives the page itself.
 */
export function filterPage<Agent extends { project: string }>(page: FilterPage<Agent>, projects: readonly Pick<WorkProject, 'slug' | 'name'>[], choice: string | null): FilterPage<Agent> {
  if (resolveChoice(choice, chipsOf(page, projects)) === null) return page
  const finished = page.finished.flatMap((group) => {
    const changes = group.changes.filter(({ slug }) => slug === choice)
    return changes.length === group.changes.length ? [group] : changes.length ? [{ ...group, changes }] : []
  })
  return {
    finished,
    queue: page.queue.filter(({ slug }) => slug === choice),
    agents: page.agents.filter(({ project }) => slugOfAgent(project, projects) === choice),
  }
}
