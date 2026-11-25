/**
 * What the keys that send do in the message input, as Pi's terminal has them (`Composer.tsx` carries the answer out).
 * Enter sends, and during a turn steers it. Alt+Enter queues a follow-up the turn gets once it would end. Control+Enter
 * stops the turn and sends at once as a turn of its own. With no turn running both send as Enter does. Enter in an empty
 * input continues a turn the user stopped. Alt+Up brings what waits for the turn back into the input.
 *
 * Command+Enter is the frame's, Shift+Enter adds a line, and Shift+Control+Enter is the prompt editor's, so each is left
 * alone. Alt+Up with nothing waiting keeps its Mac meaning.
 */

export interface ComposerKeyPress {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export interface ComposerKeyContext {
  /** A turn of the main chat runs, and can be stopped. */
  turnRunning: boolean
  /** The draft can go: it has words or images, and hobkin holds every image. */
  canSend: boolean
  /** The input holds nothing: no words and no image. */
  empty: boolean
  /** The last turn is one the user stopped, and nothing has started since. */
  stopped: boolean
  /** Something the user sent waits for the running turn. */
  queued: boolean
}

/** `nothing`: the key is the input's, and does nothing now, so it adds no line either. */
export type ComposerKeyAction = { do: 'send' | 'follow-up' | 'interrupt' | 'continue' | 'dequeue' | 'nothing' }

export function composerKey(press: ComposerKeyPress, context: ComposerKeyContext): ComposerKeyAction | null {
  if (press.meta || press.shift) return null
  const only = (modifier: 'ctrl' | 'alt' | null) => Boolean(press.ctrl) === (modifier === 'ctrl') && Boolean(press.alt) === (modifier === 'alt')

  if (press.key === 'ArrowUp') return only('alt') && context.queued ? { do: 'dequeue' } : null
  if (press.key !== 'Enter') return null
  if (only(null)) {
    if (context.canSend) return { do: 'send' }
    return context.empty && context.stopped && !context.turnRunning ? { do: 'continue' } : { do: 'nothing' }
  }
  if (only('alt')) return { do: !context.canSend ? 'nothing' : context.turnRunning ? 'follow-up' : 'send' }
  if (only('ctrl')) return { do: !context.canSend ? 'nothing' : context.turnRunning ? 'interrupt' : 'send' }
  return null
}
