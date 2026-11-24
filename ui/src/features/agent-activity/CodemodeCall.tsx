import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { CodeText } from './CodeText.tsx'
import { callTime, codemodeOf, type SavedCodemode } from './codemode.ts'
import { useUnfold } from './unfold.ts'

/**
 * What the list of calls can and cannot tell. The calls are the tools the script ran through codemode. A script that
 * did its work with codemode's own functions has none, and then there is nothing to say: no line, and never "no tool calls".
 */
function CallsNote({ operations }: { operations: readonly unknown[] | undefined }) {
  if (operations === undefined) return <p className="text-[11px] text-muted-foreground">The runtime did not say which tools this script ran.</p>
  if (operations.length === 0) return null
  return <p className="text-[11px] text-muted-foreground">Arguments and errors are previews and may be cut short. What each call returned is not kept.</p>
}

/** Script result is aggregate output, not a result for any one operation. */
export function CodemodeCall({ entry, ended = false, correlation }: { entry: ActivityEntry; ended?: boolean; correlation?: SavedCodemode['correlation'] }) {
  const { open, toggle, box } = useUnfold<HTMLDivElement>()
  const model = codemodeOf(entry, ended)
  return <div ref={box} className="flex min-w-0 flex-col gap-3 rounded-2xl bg-card px-4 py-3 shadow-[inset_0_0_0_1px_var(--hb-border)]">
    <button type="button" data-step-toggle aria-expanded={open} onClick={toggle} className="flex min-w-0 items-center justify-between gap-3 text-left text-[13px]">
      <span className="font-mono font-medium">codemode</span><span className={model.state === 'failed' || model.state === 'stopped' ? 'text-bad-fg' : 'text-muted-foreground'}>Script · {model.state === 'done' ? 'completed' : model.state}</span>
      <span className="text-xs text-muted-foreground">{open ? 'Hide source / raw' : 'Source / raw'}</span>
    </button>
    {correlation && correlation !== 'matched' ? <p className="text-xs text-muted-foreground">Stored correlation: {correlation}. No result has been assigned to a source call.</p> : null}
    <ol className="flex min-w-0 flex-col gap-2" aria-label="Codemode operations in start order">
      {model.operations?.map(call => <li key={call.key} className="min-w-0 text-xs">
        <div className="flex flex-wrap items-baseline gap-2"><code className="font-medium">{call.name}</code><span className={call.status === 'error' ? 'text-bad-fg' : 'text-muted-foreground'}>{call.status === 'ok' ? 'ok · execution only' : call.status === 'unknown' ? 'unknown · script ended' : call.status}</span>{call.durationMs === undefined ? null : <span>{callTime(call.durationMs)}</span>}{call.cost === undefined ? null : <span>reported cost {call.cost}</span>}</div>
        <p className="font-mono whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground">{call.args || 'No argument preview supplied.'}</p>
        {call.error ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-bad-fg">{call.error}</p> : null}
      </li>)}
    </ol>
    <CallsNote operations={model.operations} />
    <div className="flex min-w-0 flex-col gap-1"><span className="eyebrow">Script result · aggregate</span>
      {model.output ? <CodeText text={model.output} language={null} label="Received aggregate script output" most={4} /> : <p className="text-xs text-muted-foreground">{model.state === 'running' ? 'No script output yet.' : 'No script output received.'}</p>}
    </div>
    {open ? <>
      <span className="eyebrow">Script source</span><CodeText text={model.source} language="javascript" label="Codemode script source" />
      <span className="eyebrow">Received raw fields</span><CodeText text={JSON.stringify(entry, null, 2)} language="json" label="Received codemode activity fields" />
      {model.metadata?.fullOutputPath ? <p className="break-all text-xs text-muted-foreground">Upstream full output path (not opened): {model.metadata.fullOutputPath}</p> : null}
    </> : null}
  </div>
}
