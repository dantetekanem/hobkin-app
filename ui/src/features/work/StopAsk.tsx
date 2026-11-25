import { useEffect, useRef } from 'react'
import { agentControls, useAgentControl } from '@/app/running-agents.ts'
import { useView } from '@/app/view-store.ts'
import { sameFields } from '@/lib/host/frame.ts'
import { useHostEqual } from '@/lib/host/index.ts'
import { executionKey, executionTargets } from './actions.ts'
import { useExecution } from './store.ts'

/**
 * What the last stop of a run did, in the host's words, for its page to say under its header: a stop from the message
 * box, from the agents list, or End. Null before any.
 */
export function useStopResult(runId: string | null): string | null {
  const asked = useAgentControl((state) => (state.result?.id === runId ? state.result.text : null))
  const received = useExecution((state) => {
    const ofRun = Object.values(state.results).find(({ receipt }) => receipt?.target.kind === 'run' && receipt.target.runId === runId)
    return ofRun?.text ?? null
  })
  if (runId === null) return null
  return received ?? asked
}

/**
 * A stop asked from the agents list (its x) asks here first, on the page of the agent it stops: `runId` is the page's
 * run, or the run of a durable hobkin's turn in flight. Cancel or Escape takes it back to where the keyboard was.
 * Stop for the turn is the message box's own (`useTalkControls`), and End the header's.
 */
export function StopAsk({ runId }: { runId: string }) {
  const { target } = useAgentControl()
  // Only this run's control: the host's other messages do not draw it again.
  const control = useHostEqual((state) => executionTargets(state).find((row) => row.kind === 'run' && row.runId === runId), sameFields)
  const execution = useExecution()
  const pending = (mode: 'stop' | 'force') => agentControls.pending(runId, mode) || (control !== undefined && execution.pending[executionKey(control, mode)] === true)
  const busy = pending(target?.mode ?? 'stop')
  const ending = target?.mode === 'force'
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const cancel = () => {
    if (busy) return
    dialog.current?.close()
    agentControls.cancel()
    opener.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!target || target.id !== runId) return
    const element = dialog.current
    const section = element?.closest<HTMLElement>('[data-canvas-screen]')
    if (section?.dataset.canvasScreen !== element?.closest<HTMLElement>('[data-active-canvas-screen]')?.dataset.activeCanvasScreen) return
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      const view = useView.getState()
      if (view.screen === 'agent' && element?.contains(document.activeElement)) opener.current?.focus({ preventScroll: true })
      if (useAgentControl.getState().target === target) agentControls.cancel()
    }
  }, [target, runId])
  return (
    <dialog
      ref={dialog}
      aria-labelledby="agent-stop-title"
      aria-describedby="agent-stop-description"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className="m-auto max-w-md rounded-2xl border border-border bg-background p-6 text-sm text-foreground backdrop:bg-black/40"
    >
      <h2 id="agent-stop-title" className="text-lg font-semibold">
        {ending ? 'End' : 'Stop'} this run?
      </h2>
      <p id="agent-stop-description" className="my-4">
        {target?.title} · {target?.project}. Cancellation and captured closure are reported separately. Detached cleanup remains unknown.
      </p>
      <div className="flex justify-end gap-4">
        <button type="button" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !(ending ? control?.canForce : control?.canStop) || target?.id !== runId}
          onClick={() => void agentControls.confirm()}
        >
          {ending ? 'End it' : 'Stop run'}
        </button>
      </div>
    </dialog>
  )
}
