import { draftAfterStop } from './outbox.ts'

/** An image attached to the message being written. hobkin holds the image itself until the message goes. */
export interface Attachment {
  /** Names it in this window, from the moment it is chosen. */
  id: string
  name: string
  mimeType: string
  /** An address the browser can draw a thumbnail from. */
  preview: string
  /** hobkin's name for the image, once it has taken it. Until then the image is still on its way. */
  handle?: string
}

/** A draft set aside in the prompt editor, to come back to. Its images last as long as hobkin's session. */
export interface KeptDraft {
  id: string
  text: string
  /** When it was set aside, in milliseconds. */
  at: number
  attachments: readonly Attachment[]
}

/**
 * The message being written. There is one draft, and the small input and the full prompt editor are two
 * places to write it, so moving between them never copies or loses anything. Drafts set aside wait in `kept`.
 */
export interface DraftState {
  text: string
  attachments: readonly Attachment[]
  /** Drafts set aside, newest first. */
  kept: readonly KeptDraft[]
  /** The kept draft the one being written was opened from, so keeping it again puts it back under its own name. */
  from: string | null
  /** `editor`: the full prompt editor is open over the window. */
  place: 'input' | 'editor'
  /** The editor is asking whether to keep or discard the draft before it closes. */
  leaving: boolean
  /** What the user sent, oldest first, for Up in an empty message. */
  sent: readonly string[]
  /** Which sent message Up brought back, counted from the newest, or null when the text is the user's own. */
  recalled: number | null
  /** The ids of what hobkin kept of the user's words that were put back in the input, so each comes back once. */
  returned?: readonly string[]
}

export type DraftAction =
  | { type: 'typed'; text: string }
  | { type: 'attached'; attachment: Attachment }
  /** hobkin took the image and named it. */
  | { type: 'uploaded'; id: string; handle: string }
  | { type: 'detached'; id: string }
  /** Ctrl+Option+P: into the editor, or back to the small input with the same draft. */
  | { type: 'editor-toggled' }
  /** Escape in the editor: it asks first, and asked twice it keeps. `at` and `id` are for a draft it keeps. */
  | { type: 'editor-escaped'; at: number; id: string }
  | { type: 'leave-kept'; at: number; id: string }
  | { type: 'leave-discarded' }
  | { type: 'leave-cancelled' }
  /** A kept draft becomes the one being written. The one being written is kept first, as `keepAs` when it is new. */
  | { type: 'draft-opened'; id: string; at: number; keepAs: string }
  /** The draft went out. */
  | { type: 'sent' }
  /** A durable hobkin started with `text` as its first message. Its images could not go with it. */
  | { type: 'handed-off'; text: string }
  /** A send that failed gives the draft back, unless something new was already written. */
  | { type: 'restored'; text: string; attachments: readonly Attachment[] }
  /** A stop returned what hobkin had not read. */
  | { type: 'stopped'; unsent: readonly string[] }
  /** What hobkin kept of the words it never read before it closed or crashed. */
  | { type: 'returned'; words: readonly { id: string; text: string }[] }
  | { type: 'recalled'; direction: 'older' | 'newer' }

export const emptyDraft: DraftState = { text: '', attachments: [], kept: [], from: null, place: 'input', leaving: false, sent: [], recalled: null }

const MOST_REMEMBERED = 50
const MOST_KEPT = 50
const MOST_RETURNED = 100

const hasDraft = ({ text, attachments }: Pick<DraftState, 'text' | 'attachments'>) => text.trim().length > 0 || attachments.length > 0
const withUploadHandle = (attachments: readonly Attachment[], id: string, handle: string) =>
  attachments.map((attachment) => (attachment.id === id ? { ...attachment, handle } : attachment))
const withoutAttachment = (attachments: readonly Attachment[], id: string) =>
  attachments.filter((attachment) => attachment.id !== id)

/** The kept drafts with the one being written set aside on top, under its own name when it was opened from the list. */
function setAside(state: DraftState, at: number, id: string): readonly KeptDraft[] {
  if (!hasDraft(state)) return state.kept
  const entry: KeptDraft = { id: state.from ?? id, text: state.text, at, attachments: state.attachments }
  return [entry, ...state.kept.filter((kept) => kept.id !== entry.id)].slice(0, MOST_KEPT)
}

/** Kept, and the input is free for the next thing. */
const keep = (state: DraftState, at: number, id: string): DraftState => ({
  ...state,
  kept: setAside(state, at, id),
  text: '',
  attachments: [],
  from: null,
  place: 'input',
  leaving: false,
  recalled: null,
})

/** What of the draft survives a reload: the words, what was sent, the kept drafts without their images, and what came back once. */
export function storedDraft({ text, sent, kept, from, returned }: DraftState): Pick<DraftState, 'text' | 'sent' | 'kept' | 'from' | 'returned'> {
  return { text, sent, kept: kept.map((entry) => ({ ...entry, attachments: [] })), from, ...(returned?.length ? { returned } : {}) }
}

/** The words not put back yet go ahead of what is being typed, as after a stop. */
function returnWords(state: DraftState, words: readonly { id: string; text: string }[]): DraftState {
  const fresh = words.filter((word) => typeof word?.id === 'string' && typeof word.text === 'string' && !state.returned?.includes(word.id))
  if (!fresh.length) return state
  const returned = [...(state.returned ?? []), ...fresh.map(({ id }) => id)].slice(-MOST_RETURNED)
  return { ...state, text: draftAfterStop(fresh.map(({ text }) => text), state.text), recalled: null, returned }
}

/** What a modified Enter does in the full prompt editor: Shift+Control starts a durable hobkin with it, and any other Control or Command sends it to hobkin. */
export function editorEnter({ ctrl, meta, shift }: { ctrl: boolean; meta: boolean; shift: boolean }): 'send' | 'durable' | null {
  if (ctrl && shift && !meta) return 'durable'
  return ctrl || meta ? 'send' : null
}

/** What the editor hands the New hobkin sheet: the words as written, and how many images stay behind. Images alone cannot start one. */
export function hobkinPrompt({ text, attachments }: Pick<DraftState, 'text' | 'attachments'>): { text: string; images: number } | null {
  return text.trim() ? { text, images: attachments.length } : null
}

const midnight = (at: number) => {
  const day = new Date(at)
  return new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
}

/** When a draft was set aside, as the list says it: now, minutes, hours, yesterday, a weekday, then a date. */
export function draftAge(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  const days = Math.round((midnight(now) - midnight(at)) / 86400000)
  if (days <= 0) return `${Math.floor(minutes / 60)} h`
  if (days === 1) return 'yesterday'
  const when = new Date(at)
  if (days < 7) return when.toLocaleDateString('en-US', { weekday: 'short' })
  return when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function recall(state: DraftState, direction: 'older' | 'newer'): DraftState {
  // Text the user wrote is never replaced. Only an empty input, or a recalled message left as it came back, moves.
  const untouched = state.recalled !== null && state.text === state.sent.at(-1 - state.recalled)
  if (state.text !== '' && !untouched) return state

  const from = untouched ? state.recalled! : -1
  const to = direction === 'older' ? Math.min(state.sent.length - 1, from + 1) : from - 1
  if (to < 0) return { ...state, text: '', recalled: null }
  return { ...state, text: state.sent.at(-1 - to) ?? '', recalled: to }
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'typed':
      return { ...state, text: action.text, recalled: null }
    case 'attached':
      return { ...state, attachments: [...state.attachments, action.attachment] }
    case 'uploaded':
      return {
        ...state,
        attachments: withUploadHandle(state.attachments, action.id, action.handle),
        kept: state.kept.map((entry) => ({
          ...entry,
          attachments: withUploadHandle(entry.attachments, action.id, action.handle),
        })),
      }
    case 'detached':
      return {
        ...state,
        attachments: withoutAttachment(state.attachments, action.id),
        kept: state.kept.map((entry) => ({
          ...entry,
          attachments: withoutAttachment(entry.attachments, action.id),
        })),
      }
    case 'editor-toggled':
      return { ...state, place: state.place === 'editor' ? 'input' : 'editor', leaving: false }
    case 'editor-escaped':
      // Asked twice, it keeps: an unfinished prompt never stands in the way. With nothing written it just closes.
      if (state.leaving) return keep(state, action.at, action.id)
      return hasDraft(state) ? { ...state, leaving: true } : { ...state, place: 'input', leaving: false, from: null }
    case 'leave-kept':
      return keep(state, action.at, action.id)
    case 'leave-discarded':
      return { ...state, text: '', attachments: [], from: null, place: 'input', leaving: false, recalled: null }
    case 'leave-cancelled':
      return { ...state, leaving: false }
    case 'draft-opened': {
      const opened = state.kept.find(({ id }) => id === action.id)
      if (!opened) return state
      const kept = setAside(state, action.at, action.keepAs).filter(({ id }) => id !== opened.id)
      return { ...state, kept, text: opened.text, attachments: opened.attachments, from: opened.id, leaving: false, recalled: null }
    }
    case 'sent': {
      const text = state.text.trim()
      const sent = text && state.sent.at(-1) !== text ? [...state.sent, text].slice(-MOST_REMEMBERED) : state.sent
      return { ...state, text: '', attachments: [], from: null, place: 'input', leaving: false, recalled: null, sent }
    }
    case 'handed-off':
      // The editor closes, as the hobkin's page opens. Words that came in while the sheet was open stay with the rest.
      if (state.text !== action.text) return { ...state, place: 'input', leaving: false }
      return { ...draftReducer(state, { type: 'sent' }), attachments: state.attachments }
    case 'restored':
      return hasDraft(state) ? state : { ...state, text: action.text, attachments: action.attachments }
    case 'stopped':
      return { ...state, text: draftAfterStop(action.unsent, state.text), recalled: null }
    case 'returned':
      return returnWords(state, action.words)
    case 'recalled':
      return recall(state, action.direction)
  }
}
