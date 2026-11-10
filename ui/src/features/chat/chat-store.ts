import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { hostStore, runCommand } from '@/lib/host/client.ts'
import { isLive } from '@/lib/host/state.ts'
import type { SlashCommand } from '#shared/protocol/slash.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import { useReportReply } from '@/features/reports/reply.ts'
import { attachmentRefusal, fileAsBase64 } from './attachments.ts'
import { draftReducer, emptyDraft, type Attachment, type DraftAction, type DraftState } from './draft.ts'
import { emptyOutbox, settleOutbox, type Outbox } from './outbox.ts'
import { closedSlash, slashCommandIn, slashKey, slashTyped, type SlashKey, type SlashState } from './slash.ts'

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
  send: () => void
  stop: () => void
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
}

let sends = 0
let uploads = 0
let notes = 0
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
const settled = (outbox: Outbox) => settleOutbox(outbox, hostStore.getState().messages, hostStore.getState().snapshot.busy === true)
const limitsNow = () => {
  const { link, owner } = hostStore.getState()
  return link === 'open' && owner?.state === 'live' ? owner.limits : null
}
const forget = (attachments: readonly Attachment[]) => attachments.forEach(({ preview }) => URL.revokeObjectURL(preview))

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

      send: () => {
        const { text, attachments } = get().draft
        if (!canSendDraft({ text, attachments })) return

        // A command written out with what follows it, such as "/feedback the list flickers", runs as that command.
        const command = attachments.length ? null : slashCommandIn(text.trim(), get().commands)
        if (command) {
          get().change({ type: 'sent' })
          return get().runCommand(command.name, command.args)
        }

        const words = text.trim()
        const images = attachments.map(({ handle }) => handle as string)
        // The report the message is about goes with it, once, as in the terminal app.
        const report = useReportReply.getState().report
        if (report) useReportReply.getState().clear()
        const entry = { id: ++sends, text: words, images: images.length, at: Date.now(), accepted: false, ...(report ? { about: report.title } : {}) }
        set(({ draft, outbox }) => ({ draft: draftReducer(draft, { type: 'sent' }), outbox: { ...outbox, entries: [...outbox.entries, entry] }, problem: null, said: null }))
        runCommand('conversation.send', { ...(words ? { text: words } : {}), ...(images.length ? { images } : {}), ...(report ? { report: report.id } : {}) }).then(
          () => {
            forget(attachments)
            // hobkin took it. It stays on screen, without the queued mark, until the stored conversation shows it.
            set(({ outbox }) => ({ outbox: settled({ ...outbox, entries: outbox.entries.map((sent) => (sent.id === entry.id ? { ...sent, accepted: true } : sent)) }) }))
          },
          (error) => {
            // A message that did not go takes its report back, unless another one was chosen meanwhile.
            if (report && !useReportReply.getState().report) useReportReply.getState().attach(report)
            set(({ draft, outbox }) => ({
              outbox: { ...outbox, entries: outbox.entries.filter((sent) => sent.id !== entry.id) },
              draft: draftReducer(draft, { type: 'restored', text, attachments }),
              problem: `Not sent: ${reason(error)}`,
            }))
          },
        )
      },

      stop: () => {
        runCommand('conversation.stop').then(
          ({ unsent }) => {
            if (!unsent.length) return
            // What hobkin never read goes back into the input, so it leaves the conversation.
            set(({ draft, outbox }) => ({
              draft: draftReducer(draft, { type: 'stopped', unsent }),
              outbox: { ...outbox, entries: outbox.entries.filter((sent) => !unsent.includes(sent.text)) },
            }))
          },
          (error) => set({ problem: `Not stopped: ${reason(error)}` }),
        )
      },

      attach: (files) => {
        for (const file of files) {
          const refusal = attachmentRefusal(file, get().draft.attachments.length, limitsNow())
          if (refusal) {
            set({ problem: refusal })
            continue
          }
          // It shows at once, from the file itself. hobkin gets its bytes in the background.
          const attachment: Attachment = { id: `local:${++uploads}`, name: file.name || 'image', mimeType: file.type, preview: URL.createObjectURL(file) }
          get().change({ type: 'attached', attachment })
          fileAsBase64(file)
            .then((data) => runCommand('conversation.attach', { name: attachment.name, data }))
            .then(
              ({ id: handle }) => {
                // Removed while it was on its way: hobkin lets go of it too.
                if (!get().draft.attachments.some(({ id }) => id === attachment.id)) return void runCommand('conversation.detach', { id: handle }).catch(() => {})
                set(({ draft }) => ({ draft: draftReducer(draft, { type: 'uploaded', id: attachment.id, handle }) }))
              },
              (error) => {
                forget([attachment])
                set(({ draft }) => ({ draft: draftReducer(draft, { type: 'detached', id: attachment.id }), problem: reason(error) }))
              },
            )
        }
      },

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

      reachCommand: (index) => set(({ slash }) => (slash.selected === index ? {} : { slash: { ...slash, selected: index } })),

      runCommand: (name, args) => {
        set({ problem: null, said: null })
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
      // Only the words survive a reload. Attachments are files hobkin holds for this session.
      partialize: ({ draft }) => ({ draft: { text: draft.text, sent: draft.sent } }),
      merge: (saved, current) => ({ ...current, draft: { ...emptyDraft, ...(saved as { draft?: Partial<DraftState> } | undefined)?.draft } }),
    },
  ),
)

// The outbox follows the stored conversation, whoever changes it. The commands are asked for each time hobkin opens.
let wasLive = false
hostStore.subscribe((state) => {
  const { outbox, loadCommands } = useChat.getState()
  const next = settleOutbox(outbox, state.messages, state.snapshot.busy === true)
  if (next !== outbox) useChat.setState({ outbox: next })

  const live = isLive(state)
  if (live && !wasLive) loadCommands()
  wasLive = live
})
