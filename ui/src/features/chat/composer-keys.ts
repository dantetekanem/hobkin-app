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
  const modifier = modifierOf(press)

  if (press.key === 'ArrowUp') return modifier === 'alt' && context.queued ? { do: 'dequeue' } : null
  if (press.key !== 'Enter') return null

  switch (modifier) {
    case 'none':
      return enter(context)
    case 'alt':
      return sendDuringTurn(context, 'follow-up')
    case 'ctrl':
      return sendDuringTurn(context, 'interrupt')
    case 'both':
      return null
  }
}

function modifierOf(press: ComposerKeyPress): 'none' | 'ctrl' | 'alt' | 'both' {
  if (press.ctrl && press.alt) return 'both'
  if (press.ctrl) return 'ctrl'
  if (press.alt) return 'alt'
  return 'none'
}

function enter(context: ComposerKeyContext): ComposerKeyAction {
  if (context.canSend) return { do: 'send' }
  const continues = context.empty && context.stopped && !context.turnRunning
  return { do: continues ? 'continue' : 'nothing' }
}

/** Alt+Enter and Control+Enter: what they do to a running turn, and with no turn running they send as Enter does. */
function sendDuringTurn(context: ComposerKeyContext, during: 'follow-up' | 'interrupt'): ComposerKeyAction {
  if (!context.canSend) return { do: 'nothing' }
  return { do: context.turnRunning ? during : 'send' }
}
