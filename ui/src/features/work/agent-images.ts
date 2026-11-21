import { create } from 'zustand'
import type { Attachment } from '@/features/chat/draft.ts'
import { attachImages, forgetPreviews, releaseImages } from '@/features/chat/image-uploads.ts'

const NONE: readonly Attachment[] = []

interface AgentImages {
  /** The images attached to the message being written to each agent, by the agent: its run id, or `hobkin:<id>`. */
  trays: Record<string, readonly Attachment[]>
  /** Why the last image for an agent was not attached, by the agent. */
  problems: Record<string, string>

  /** Attaches images to the agent's message, as the main input does, with hobkin's limits on each message. */
  attach: (agent: string, files: readonly File[]) => void
  detach: (agent: string, id: string) => void
  /** The images go with the message being sent: the tray empties. Their previews stay with the message. */
  take: (agent: string) => readonly Attachment[]
  /** A message that did not go gives its images back, unless others were attached since. hobkin lets go of those. */
  restore: (agent: string, attachments: readonly Attachment[]) => void
  clearProblem: (agent: string) => void
}

/** The images attached for an agent's message. A message can go once hobkin holds every one of them. */
export const imagesReady = (attachments: readonly Attachment[]) => attachments.every(({ handle }) => handle !== undefined)

/**
 * The images attached to each agent's message while it is written: an agent's canvas and a durable hobkin's page.
 * They live as long as the window, so moving between agents keeps each one's. hobkin holds the images themselves.
 */
export const useAgentImages = create<AgentImages>()((set, get) => {
  const trayOf = (agent: string) => get().trays[agent] ?? NONE
  const setTray = (agent: string, change: (tray: readonly Attachment[]) => readonly Attachment[]) =>
    set(({ trays }) => ({ trays: { ...trays, [agent]: change(trays[agent] ?? NONE) } }))
  const setProblem = (agent: string, why: string) => set(({ problems }) => ({ problems: { ...problems, [agent]: why } }))

  return {
    trays: {},
    problems: {},
    attach: (agent, files) => {
      get().clearProblem(agent)
      attachImages(files, {
        agent,
        count: () => trayOf(agent).length,
        holds: (id) => trayOf(agent).some((attachment) => attachment.id === id),
        add: (attachment) => setTray(agent, (tray) => [...tray, attachment]),
        uploaded: (id, handle) => setTray(agent, (tray) => tray.map((attachment) => (attachment.id === id ? { ...attachment, handle } : attachment))),
        lost: (id, why) => {
          setTray(agent, (tray) => tray.filter((attachment) => attachment.id !== id))
          setProblem(agent, why)
        },
        refused: (why) => setProblem(agent, why),
      })
    },
    detach: (agent, id) => {
      const attachment = trayOf(agent).find((attached) => attached.id === id)
      if (!attachment) return
      setTray(agent, (tray) => tray.filter((attached) => attached.id !== id))
      forgetPreviews([attachment])
      releaseImages([attachment])
    },
    take: (agent) => {
      const taken = trayOf(agent)
      if (taken.length) setTray(agent, () => NONE)
      return taken
    },
    restore: (agent, attachments) => {
      if (!attachments.length) return
      if (trayOf(agent).length) {
        forgetPreviews(attachments)
        releaseImages(attachments)
        return
      }
      setTray(agent, () => attachments)
    },
    clearProblem: (agent) => {
      if (!(agent in get().problems)) return
      set(({ problems }) => {
        const { [agent]: _gone, ...rest } = problems
        return { problems: rest }
      })
    },
  }
})

// A hot update of this file keeps what each tray holds, since hobkin holds those images for it.
const kept = import.meta.hot?.data as Partial<Pick<AgentImages, 'trays' | 'problems'>> | undefined
if (kept?.trays) useAgentImages.setState({ trays: kept.trays, problems: kept.problems ?? {} })
import.meta.hot?.dispose((data) => {
  const { trays, problems } = useAgentImages.getState()
  Object.assign(data, { trays, problems })
})
