import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { navigationGuide } from '@/app/key-list.ts'
import { useView } from '@/app/view-store.ts'
import { hostStore, runCommand } from '@/lib/host/client.ts'
import { screenStore } from '@/lib/host/screen.ts'
import { isLive, sentAtArg } from '@/lib/host/state.ts'
import type { SlashCommand } from '#shared/protocol/slash.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { executionKey, executionTargets, type ExecutionControl } from '../work/actions.ts'
import { runExecution, useExecution } from '../work/store.ts'
import { useReportReply, withRoutineReference } from '@/features/reports/reply.ts'
import { draftReducer, emptyDraft, storedDraft, type DraftAction, type DraftState } from './draft.ts'
import { attachImages, forgetPreviews as forget } from './image-uploads.ts'
import { emptyOutbox, settleOutbox, settleStored, type Outbox } from './outbox.ts'
import { transientLine } from './transient-line.ts'
import { closedSlash, slashCommandIn, slashKey, slashTyped, type SlashKey, type SlashState } from './slash.ts'
import { firstWord } from './use-first-word.ts'

interface ChatState {
  draft: DraftState
  /** What the user sent that the stored conversation does not show yet. */
  outbox: Outbox
  /** Why the last send, stop, attachment or command did not go through. */
  problem: string | null
  /** What the last command said, in one line. */
  said: string | null
  /** Text shown in the conversation for the user only, such as the help. hobkin's agent never sees it, and it goes with the window. */
  local: readonly ChatMessage[]
  /** The slash commands the input can run, with how often each was run. */
  commands: readonly SlashCommand[]
  /** Where the list of commands stands while a message starts with a slash. */
  slash: SlashState

  change: (action: DraftAction) => void
  /** Sends the draft with its images, or runs it when it is a command. Nothing happens while it is empty or an image is still on its way to hobkin. */
  send: {
    (): Promise<boolean>
    /** Sends plain text without borrowing the current draft or report reply. True only after host acceptance. */
    (text: string): Promise<boolean>
  }
  stop: (mode?: 'stop' | 'force', target?: ExecutionControl) => void
  /** Attaches images to the draft: pasted, dropped or picked. Each one hobkin would refuse is turned away with the reason. */
  attach: (files: readonly File[]) => void
  detach: (id: string) => void
  /** Asks the host which commands there are. The counts in the answer order the list. */
  loadCommands: () => void
  /** A key pressed while the list of commands is open. False when the key is not the list's. */
  slashKey: (key: SlashKey) => boolean
  /** Moves the list's selection, as the pointer does. */
  reachCommand: (index: number) => void
  runCommand: (name: string, args: string) => void
  /** Pauses or resumes the time the problem line has left, while it is being read. */
  readProblem: (reading: boolean) => void
}

let sends = 0
let notes = 0
const recovered = new Set<string>()
// A problem is not kept: it goes by itself, and never reaches the conversation or its history.
const problemLine = transientLine(() => useChat.setState({ problem: null }))
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
// The outbox settles against the conversation the screen shows, so a sent row and its stored copy swap in one draw.
// Whether a turn ended without a message is read only from a state the screen takes after hobkin took it.
const settled = (outbox: Outbox) => {
  const shown = screenStore.getState()
  return settleOutbox(outbox, shown.messages, shown.snapshot.busy === true)
}
const retainsAttachment = (draft: DraftState, id: string) =>
  draft.attachments.some((attachment) => attachment.id === id) ||
  draft.kept.some((entry) => entry.attachments.some((attachment) => attachment.id === id))

/** Whether the draft can go: it has words or an image, and hobkin holds every image. */
export const canSendDraft = ({ text, attachments }: Pick<DraftState, 'text' | 'attachments'>): boolean =>
  (text.trim().length > 0 || attachments.length > 0) && attachments.every(({ handle }) => handle !== undefined)

/** The message being written and what was sent but is not in the conversation yet. Sending, stopping, attaching and commands go through the host. */
export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      draft: emptyDraft,
      outbox: emptyOutbox,
      problem: null,
      said: null,
      local: [],
      commands: [],
      slash: closedSlash,

      change: (action) =>
        set(({ draft, slash }) => {
          const next = draftReducer(draft, action)
          // New text opens the list again if Escape had closed it, with the keyboard back on the best match.
          return { draft: next, problem: null, said: null, slash: next.text === draft.text ? slash : slashTyped(slash, next.text) }
        }),

      send: async (message?: string) => {
        // Settings can send a plain request without consuming the user's draft, images or report reply.
        const plain = typeof message === 'string'
        const { text, attachments } = plain ? { text: message, attachments: [] } : get().draft
        if (!canSendDraft({ text, attachments })) return false

        // A command written out with what follows it, such as "/feedback the list flickers", runs as that command.
        const command = plain || attachments.length ? null : slashCommandIn(text.trim(), get().commands)
        if (command) {
          get().change({ type: 'sent' })
          get().runCommand(command.name, command.args)
          return false
        }

        const words = text.trim()
        const images = attachments.map(({ handle }) => handle as string)
        // The report the message is about goes with it, once, as in the terminal app.
        const report = plain ? null : useReportReply.getState().report
        if (report) useReportReply.getState().clear()
        // A routine goes as a line before the words, since hobkin's `about` only knows reports. The chat shows it as "About ...".
        const routine = report?.kind === 'routine' && report.file
        const sentText = routine && words ? withRoutineReference(report, words) : words
        // An action item goes whole, as the host has no item to look up: hobkin gets it the way it gets a report.
        const item = report?.kind === 'item' ? { id: report.id, title: report.title, body: report.body ?? '' } : null
        const about = item ? `Action item: ${item.title}` : report && !routine ? report.title : null
        const entry = { id: ++sends, text: sentText, images: images.length, at: Date.now(), accepted: false, ...(about ? { about } : {}) }
        set(({ draft, outbox }) => ({ draft: plain ? draft : draftReducer(draft, { type: 'sent' }), outbox: { ...outbox, entries: [...outbox.entries, entry] }, problem: null, said: null }))
        const attached = item ? { item } : report && !routine ? { report: report.id } : {}
        // When the user sent it goes along, to a host that takes it, and the reply's first words are timed from then.
        const measure = firstWord.sent(entry.at, hostStore.getState())
        return runCommand('conversation.send', { ...(sentText ? { text: sentText } : {}), ...(images.length ? { images } : {}), ...attached, ...sentAtArg(hostStore.getState(), entry.at) }).then(
          (said) => {
            firstWord.accepted(measure, said)
            forget(attachments)
            // hobkin took it. It stays on screen, without the queued mark, until the stored conversation shows it. The
            // screen may still show hobkin idle from before it took it, so only a stored copy takes the row away here.
            const taken = (outbox: Outbox) => ({ ...outbox, entries: outbox.entries.map((sent) => (sent.id === entry.id ? { ...sent, accepted: true } : sent)) })
            set(({ outbox }) => ({ outbox: settleStored(taken(outbox), screenStore.getState().messages) }))
            return true
          },
          (error) => {
            firstWord.refused(measure)
            // A message that did not go takes its report back, unless another one was chosen meanwhile.
            if (report && !useReportReply.getState().report) useReportReply.getState().attach(report)
            set(({ draft, outbox }) => ({
              outbox: { ...outbox, entries: outbox.entries.filter((sent) => sent.id !== entry.id) },
              draft: plain ? draft : draftReducer(draft, { type: 'restored', text, attachments }),
              problem: `Not sent: ${reason(error)}`,
            }))
            return false
          },
        )
      },

      stop: (mode = 'stop', captured) => {
        const target = captured ?? executionTargets(hostStore.getState()).find(target => target.kind === 'main' && target.canStop)
        if (!target || target.kind !== 'main') { set({ problem: 'Not stopped: No live conversation control.' }); return }

        const source = hostStore.getState().epoch
        const queued = new Set(get().outbox.entries.map(entry => entry.id))
        void runExecution(target, mode).then(receipt => {
          const now = hostStore.getState()
          if (
            !receipt ||
            now.link !== 'open' ||
            now.owner?.state !== 'live' ||
            now.epoch !== source ||
            now.home !== target.home ||
            now.snapshot.stopControls?.home !== target.home ||
            now.snapshot.stopControls.epoch !== target.epoch
          ) return

          const recovery = receipt.queueRecovery
          const key = executionKey(target)
          if (recovery.status !== 'confirmed' || recovery.alreadyReturned || recovered.has(key)) return

          recovered.add(key)
          const { unsent } = recovery
          if (!unsent.length) return

          set(({ draft, outbox }) => ({
            draft: draftReducer(draft, { type: 'stopped', unsent }),
            outbox: {
              ...outbox,
              entries: outbox.entries.filter(
                sent => !queued.has(sent.id) || !unsent.includes(sent.text),
              ),
            },
          }))
        }, error => {
          const now = hostStore.getState()
          if (now.link === 'open' && now.epoch === source && now.home === target.home && now.snapshot.stopControls?.epoch === target.epoch && useExecution.getState().results[executionKey(target)]?.text === reason(error)) set({ problem: `Not stopped: ${reason(error)}` })
        })
      },

      attach: (files) =>
        attachImages(files, {
          count: () => get().draft.attachments.length,
          holds: (id) => retainsAttachment(get().draft, id),
          add: (attachment) => get().change({ type: 'attached', attachment }),
          uploaded: (id, handle) => set(({ draft }) => ({ draft: draftReducer(draft, { type: 'uploaded', id, handle }) })),
          lost: (id, why) => set(({ draft }) => ({ draft: draftReducer(draft, { type: 'detached', id }), problem: why })),
          refused: (why) => set({ problem: why }),
        }),

      detach: (id) => {
        const attachment = get().draft.attachments.find((attached) => attached.id === id)
        if (!attachment) return
        forget([attachment])
        get().change({ type: 'detached', id })
        if (attachment.handle) void runCommand('conversation.detach', { id: attachment.handle }).catch(() => {})
      },

      loadCommands: () => {
        runCommand('slash.list').then(
          ({ commands }) => set({ commands }),
          // Without the list a slash is just the start of a message, which is what happens before hobkin is open.
          () => {},
        )
      },

      slashKey: (key) => {
        const { draft, commands, slash } = get()
        const result = slashKey({ text: draft.text, commands, state: slash }, key)
        if (!result) return false

        set(({ draft: now }) => ({
          slash: result.state,
          ...(result.text === undefined ? {} : { draft: draftReducer(now, { type: 'typed', text: result.text }), problem: null, said: null }),
        }))
        if (result.run) get().runCommand(result.run.name, result.run.args)
        return true
      },

      readProblem: (reading) => (reading ? problemLine.hold() : problemLine.release()),

      reachCommand: (index) => set(({ slash }) => (slash.selected === index ? {} : { slash: { ...slash, selected: index } })),

      runCommand: (name, args) => {
        set({ problem: null, said: null })
        // The walkthrough is built here from the list of keys: no host and no model.
        // Work is a screen of this app: it opens here, and the host only counts the run.
        if (name === '/work') useView.getState().openScreen('work')
        if (name === '/navigate') {
          set(({ local }) => ({ local: [...local, { id: `local:note:${++notes}`, role: 'assistant', content: navigationGuide(), at: Date.now() }] }))
          return
        }
        runCommand('slash.run', { name, ...(args ? { args } : {}) }).then(
          ({ said, shown }) => {
            set(({ local }) => ({
              said: said ?? null,
              local: shown ? [...local, { id: `local:note:${++notes}`, role: 'assistant', content: shown, at: Date.now() }] : local,
            }))
            // Its count went up, which can change the order of the list.
            get().loadCommands()
          },
          (error) => set({ problem: reason(error) }),
        )
      },
    }),
    {
      name: 'hobkin-client-chat',
      version: 1,
      // Only the words survive a reload, kept drafts' included. Attachments are files hobkin holds for this session.
      partialize: ({ draft }) => ({ draft: storedDraft(draft) }),
      merge: (saved, current) => ({ ...current, draft: { ...emptyDraft, ...(saved as { draft?: Partial<DraftState> } | undefined)?.draft } }),
    },
  ),
)

useChat.subscribe((state, before) => {
  if (state.problem === before.problem) return
  if (state.problem) problemLine.show()
  else problemLine.clear()
})

// The outbox follows the stored conversation as the screen shows it, whoever changes it: a sent message leaves the
// outbox in the same draw that shows its stored copy, so the copy takes its row without rising in again.
const stopSettling = screenStore.subscribe(() => {
  const { outbox } = useChat.getState()
  const next = settled(outbox)
  if (next !== outbox) useChat.setState({ outbox: next })
})
import.meta.hot?.dispose(stopSettling)

// What hobkin kept of the words its model never read before it closed or crashed goes into the input once hobkin is open, each once.
const stopReturning = hostStore.subscribe((state, before) => {
  const words = state.snapshot.unread
  if (!isLive(state) || !Array.isArray(words) || (words === before.snapshot.unread && isLive(before))) return
  const { draft } = useChat.getState()
  const next = draftReducer(draft, { type: 'returned', words })
  if (next !== draft) useChat.setState({ draft: next })
})
import.meta.hot?.dispose(stopReturning)

// The commands are asked for each time hobkin opens.
let wasLive = false
const stopCommands = hostStore.subscribe((state) => {
  const live = isLive(state)
  if (live && !wasLive) useChat.getState().loadCommands()
  wasLive = live
})
import.meta.hot?.dispose(stopCommands)
