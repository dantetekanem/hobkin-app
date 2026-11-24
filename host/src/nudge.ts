import { isScreen } from '#shared/commands/registry.ts'
import type { Nudge, NudgeAction } from '#shared/protocol/nudge.ts'

/**
 * The latest instruction hobkin gave the window (`view.open`, `view.spotlight`, `view.back`, `conversation.draft`):
 * the host only holds it and tells the window, which does the move. Each instruction gets a new id, so the window
 * carries out each one once (`shared/protocol/nudge.ts`). Nothing here navigates or writes a draft itself.
 */
export class Nudges {
  state: Nudge | null = null
  private id = 0
  private readonly onChange: () => void

  constructor({ onChange }: { onChange: () => void }) {
    this.onChange = onChange
  }

  open(screen: string): Nudge {
    if (!isScreen(screen)) throw Error(`The window has no screen named "${screen}".`)
    return this.push({ kind: 'open', screen })
  }

  spotlight(): Nudge {
    return this.push({ kind: 'spotlight' })
  }

  back(): Nudge {
    return this.push({ kind: 'back' })
  }

  /** Put words in the composer. It never sends them: the user reads, edits and sends. */
  draft(text: string): Nudge {
    return this.push({ kind: 'draft', text })
  }

  private push(action: NudgeAction): Nudge {
    this.id += 1
    this.state = { id: this.id, action }
    this.onChange()
    return this.state
  }
}
