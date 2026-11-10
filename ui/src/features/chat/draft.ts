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

/**
 * The message being written. There is one draft, and the small input and the full prompt editor are two
 * places to write it, so moving between them never copies or loses anything.
 */
export interface DraftState {
  text: string
  attachments: readonly Attachment[]
  /** `editor`: the full prompt editor is open over the window. */
  place: 'input' | 'editor'
  /** The editor is asking whether to keep or discard the draft before it closes. */
  leaving: boolean
  /** What the user sent, oldest first, for Up in an empty message. */
  sent: readonly string[]
  /** Which sent message Up brought back, counted from the newest, or null when the text is the user's own. */
  recalled: number | null
}

export type DraftAction =
  | { type: 'typed'; text: string }
  | { type: 'attached'; attachment: Attachment }
  /** hobkin took the image and named it. */
  | { type: 'uploaded'; id: string; handle: string }
  | { type: 'detached'; id: string }
  /** Ctrl+Option+P: into the editor, or back to the small input with the same draft. */
  | { type: 'editor-toggled' }
  | { type: 'editor-escaped' }
  | { type: 'leave-kept' }
  | { type: 'leave-discarded' }
  | { type: 'leave-cancelled' }
  /** The draft went out. */
  | { type: 'sent' }
  /** A send that failed gives the draft back, unless something new was already written. */
  | { type: 'restored'; text: string; attachments: readonly Attachment[] }
  /** A stop returned what hobkin had not read. */
  | { type: 'stopped'; unsent: readonly string[] }
  | { type: 'recalled'; direction: 'older' | 'newer' }

export const emptyDraft: DraftState = { text: '', attachments: [], place: 'input', leaving: false, sent: [], recalled: null }

const MOST_REMEMBERED = 50

const hasDraft = ({ text, attachments }: DraftState) => text.trim().length > 0 || attachments.length > 0

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
      return { ...state, attachments: state.attachments.map((attachment) => (attachment.id === action.id ? { ...attachment, handle: action.handle } : attachment)) }
    case 'detached':
      return { ...state, attachments: state.attachments.filter(({ id }) => id !== action.id) }
    case 'editor-toggled':
      return { ...state, place: state.place === 'editor' ? 'input' : 'editor', leaving: false }
    case 'editor-escaped':
      // With nothing written there is nothing to lose, so it just closes.
      return hasDraft(state) ? { ...state, leaving: true } : { ...state, place: 'input', leaving: false }
    case 'leave-kept':
      return { ...state, place: 'input', leaving: false }
    case 'leave-discarded':
      return { ...state, text: '', attachments: [], place: 'input', leaving: false, recalled: null }
    case 'leave-cancelled':
      return { ...state, leaving: false }
    case 'sent': {
      const text = state.text.trim()
      const sent = text && state.sent.at(-1) !== text ? [...state.sent, text].slice(-MOST_REMEMBERED) : state.sent
      return { ...state, text: '', attachments: [], place: 'input', leaving: false, recalled: null, sent }
    }
    case 'restored':
      return hasDraft(state) ? state : { ...state, text: action.text, attachments: action.attachments }
    case 'stopped':
      return { ...state, text: draftAfterStop(action.unsent, state.text), recalled: null }
    case 'recalled':
      return recall(state, action.direction)
  }
}
