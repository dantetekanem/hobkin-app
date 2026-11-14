import { create } from 'zustand'
import type { SkillFile, SkillsState } from '#shared/pi-resources/wire.ts'
import { runCommand, useHasHost } from '@/lib/host/index.ts'
import { SAMPLE_SKILLS, sampleFile } from './sample-data.ts'

/**
 * The Skills page's state (039-skills-and-extensions): what the host last read from Pi, and the sample for a window
 * with no host. The host answers each command with Pi's list as it stands, so the page keeps the latest answer.
 */
interface SkillsStore {
  /** What the host last read from Pi. Null until it answers. */
  live: SkillsState | null
  /** The sample. Turning one of its skills off changes only this. */
  sample: SkillsState
  /** The skills being turned off or on now, by path. */
  turning: readonly string[]
}

export const useSkills = create<SkillsStore>()(() => ({ live: null, sample: SAMPLE_SKILLS, turning: [] }))

/** What the page can do. Each rejects with the reason it did not happen, in words the page shows. */
export interface SkillActions {
  refresh(): Promise<void>
  turn(path: string, on: boolean): Promise<void>
  read(path: string): Promise<SkillFile>
}

async function turning(path: string, work: () => Promise<void>): Promise<void> {
  useSkills.setState(({ turning: now }) => ({ turning: [...now, path] }))
  try {
    await work()
  } finally {
    useSkills.setState(({ turning: now }) => ({ turning: now.filter((one) => one !== path) }))
  }
}

/** With a host, each action is a command the host carries out through Pi's own code, and the page draws its answer. */
const hostActions: SkillActions = {
  refresh: async () => {
    useSkills.setState({ live: await runCommand('skills.refresh') })
  },
  turn: (path, on) =>
    turning(path, async () => {
      useSkills.setState({ live: await (on ? runCommand('skills.turn-on', { path }) : runCommand('skills.turn-off', { path })) })
    }),
  read: (path) => runCommand('skills.read', { path }),
}

const sampleActions: SkillActions = {
  refresh: async () => {},
  turn: async (path, on) => {
    useSkills.setState(({ sample }) => ({ sample: { ...sample, skills: sample.skills.map((skill) => (skill.path === path ? { ...skill, on } : skill)) } }))
  },
  read: async (path) => {
    const skill = useSkills.getState().sample.skills.find((candidate) => candidate.path === path)
    if (!skill) throw Error('That skill is not in the sample.')
    return sampleFile(skill)
  },
}

export const skillActions = (live: boolean): SkillActions => (live ? hostActions : sampleActions)

/** What the page draws: with a host, only what it read from Pi, and null until it answers. Without one, the sample. */
export function useShownSkills(): { live: boolean; state: SkillsState | null } {
  const live = useHasHost()
  const fromHost = useSkills((store) => store.live)
  const sample = useSkills((store) => store.sample)
  return { live, state: live ? fromHost : sample }
}
