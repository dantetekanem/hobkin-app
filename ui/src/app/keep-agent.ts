import { keepsPreview } from '../features/work/agent-entry.ts'
import { useView } from './view-store.ts'

/**
 * A click anywhere on an agent's page, a durable hobkin's too, keeps an agent previewed from the agents list open for
 * good. The Mac's web view does not focus a link or button on a click, so the list would lose the keyboard to nothing
 * and end the preview, and a file opened from the page would leave the user on the screen before it.
 */
export function keepAgentPreview(): void {
  const view = useView.getState()
  if (view.openAgent !== null && keepsPreview(view, view.openAgent)) view.openAgentCanvas(view.openAgent)
}
