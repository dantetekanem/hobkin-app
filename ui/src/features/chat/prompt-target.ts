import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { composerKey } from './composer-keys.ts'
import { editorEnter, type Attachment, type KeptDraft } from './draft.ts'

/**
 * Where the full prompt editor writes and posts (`PromptEditor.tsx`). Opened from an agent's talk box it writes that box's
 * message and sends it to that agent as the box does; opened anywhere else it writes the main chat's draft. It says which
 * at its top and on its send button. The user, 2026-11-25: "prompt screen if from an agent input, should show that will
 * post on that one".
 */

/** Who gets what the editor sends: their name and face, at its top and on its send button. */
export interface PromptTo {
  name: string
  face: ReactNode
}

/** Enter with the modifiers held. */
export interface EnterPress {
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** What a modified Enter does in the editor. `nothing`: the key is the editor's, and nothing can go now. */
export type PromptEnter = 'send' | 'follow-up' | 'interrupt' | 'durable' | 'nothing'

/** How a message sent during a turn waits for it: after it, or now in its place. Without one it steers the turn. */
export type SendQueue = 'follow-up' | 'interrupt'

/** The main chat's drafts set aside, and the question the editor asks before it closes on unsent words. */
export interface PromptDrafts {
  kept: readonly KeptDraft[]
  leaving: boolean
  /** Escape: it asks first, and asked twice it keeps the draft. */
  escape: () => void
  answer: (choice: 'keep' | 'delete') => void
  /** Back to the words from the question. */
  stay: () => void
  /** A kept draft becomes the one being written. */
  open: (id: string) => void
}

/** What the editor writes and where it sends it. The words are the place's own, so nothing is copied in or out. */
export interface PromptTarget {
  to: PromptTo
  text: string
  setText: (text: string) => void
  attachments: readonly Attachment[]
  attach: (files: File[]) => void
  detach: (id: string) => void
  canSend: boolean
  /** What Enter with these modifiers does here, or null when it adds a line. */
  enter: (press: EnterPress) => PromptEnter | null
  send: (queue?: SendQueue) => void
  /** Control+Option+P: back to where the words were written, as they are. */
  back: () => void
  /** A durable hobkin started with `text` as its first message. */
  handedOff: (text: string) => void
  /** The main chat's drafts. An agent's message has none: it lives in its box. */
  drafts: PromptDrafts | null
}

/** An agent's talk box as the editor writes in it: the box's own words, images and way of sending. */
export interface AgentBox {
  to: PromptTo
  text: string
  setText: Dispatch<SetStateAction<string>>
  attachments: readonly Attachment[]
  attach: (files: File[]) => void
  detach: (id: string) => void
  canSend: boolean
  /** A turn of the agent runs now. */
  turnRunning: boolean
  /** Sends the box's message, as its own Enter keys do. */
  send: (queue?: SendQueue) => void
}

interface AgentPrompt {
  /** The agent whose talk box the editor is open on, by the window's id for it (a run's id, or `hobkin:<id>`). */
  agent: string | null
}

// Kept on the page, so a hot update of this file keeps an editor that is open instead of starting a second store.
const held = globalThis as { __hobkinAgentPrompt?: UseBoundStore<StoreApi<AgentPrompt>> }

export const useAgentPrompt = (held.__hobkinAgentPrompt ??= create<AgentPrompt>(() => ({ agent: null })))

/** Closes the editor when it is open on `agent`'s box: that box sent, went away, or the user went back to it. */
export function closeAgentPrompt(agent: string): void {
  if (useAgentPrompt.getState().agent === agent) useAgentPrompt.setState({ agent: null })
}

/** The agent whose talk box `element` is, by the id the box carries (`data-agent-input`). A box that takes nothing more is none. */
export function talkBoxOf(element: Element | null): string | null {
  if (!element) return null
  if ('readOnly' in element && element.readOnly === true) return null
  return element.getAttribute('data-agent-input') || null
}

export type PromptPress = { do: 'toggle-chat' } | { do: 'close-agent' } | { do: 'open-agent'; agent: string }

/**
 * What Control+Option+P does: an editor that is open closes, its words left where they were written. Else it opens on the
 * message of the agent whose talk box has the keyboard, or on the main chat's draft.
 */
export function promptPress({ chatOpen, agentOpen, typingTo }: { chatOpen: boolean; agentOpen: string | null; typingTo: string | null }): PromptPress {
  if (agentOpen !== null) return { do: 'close-agent' }
  if (chatOpen || typingTo === null) return { do: 'toggle-chat' }
  return { do: 'open-agent', agent: typingTo }
}

/**
 * A modified Enter in the editor opened on an agent's box: the box's own keys (`composerKey`), with Command+Enter for the
 * box's Enter, since Enter adds a line here. Command+Enter steers the turn in flight, Option+Enter waits for it, Control+Enter
 * stops it and sends now, and with no turn running each sends. Shift+Control+Enter starts a durable hobkin, as in the main chat's.
 */
export function agentEditorEnter(press: EnterPress, { turnRunning, canSend }: { turnRunning: boolean; canSend: boolean }): PromptEnter | null {
  if (editorEnter(press) === 'durable') return 'durable'
  if (!press.meta && !press.ctrl && !press.alt) return null

  const pressInBox = press.meta ? { key: 'Enter' } : { key: 'Enter', ctrl: press.ctrl, alt: press.alt, shift: press.shift }
  // Continuing a stopped turn and taking back what waits stay the box's own keys, so the editor asks for neither.
  const action = composerKey(pressInBox, {
    turnRunning,
    canSend,
    empty: false,
    stopped: false,
    queued: false,
  })
  switch (action?.do) {
    case undefined:
      return null
    case 'send':
    case 'follow-up':
    case 'interrupt':
      return action.do
    default:
      return 'nothing'
  }
}

/** The editor on an agent's talk box. It writes the box's own words, sends through the box, and `close` takes it away. */
export function agentTarget(box: AgentBox, close: () => void): PromptTarget {
  return {
    to: box.to,
    text: box.text,
    setText: box.setText,
    attachments: box.attachments,
    attach: box.attach,
    detach: box.detach,
    canSend: box.canSend,
    enter: (press) => agentEditorEnter(press, box),
    send: (queue) => {
      close()
      box.send(queue)
    },
    back: close,
    handedOff: (text) => {
      // Gone with the new hobkin, unless other words came into the box meanwhile. Its images stay: hobkin.start takes none.
      box.setText((now) => (now === text ? '' : now))
      close()
    },
    drafts: null,
  }
}
