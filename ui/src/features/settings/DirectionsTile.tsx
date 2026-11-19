import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { DIRECTIONS_MAX_BYTES, type DirectionsFile } from '#shared/protocol/directions.ts'
import { Button } from '@/components/ui/button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { utf8Bytes } from './directions.ts'
import { Tile } from './SettingsScreen.tsx'

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
const count = (bytes: number) => bytes.toLocaleString('en-US')

/**
 * hobkin's directions, AGENTS.md in its home, which every agent it runs follows. The editor reads the file when it
 * opens and checks it again on save, and nothing else: no polling, and its text stays in the editor alone.
 */
export function DirectionsTile() {
  const hasHost = useHasHost()
  const [open, setOpen] = useState(false)
  // The editor answers whether a close must wait: the first close over unsaved changes only warns.
  const holdClose = useRef<() => boolean>(() => false)
  const field = useRef<HTMLTextAreaElement | null>(null)

  return (
    <Tile name="Directions" value="AGENTS.md" className="col-span-6 @max-[820px]:col-span-2">
      <div className="flex flex-1 items-center justify-between gap-4 @max-[820px]:flex-col @max-[820px]:items-start">
        <p className="max-w-[60ch] text-[13px] text-muted-foreground">
          How every hobkin agent works: the main chat, routines and work runs. hobkin reads it again for each message and each run, so a save counts from the next one.
        </p>
        <Button variant="outline" className="shrink-0" data-stop="" disabled={!hasHost} onClick={() => setOpen(true)}>
          Edit directions
        </Button>
      </div>
      {!hasHost ? <p className="text-[12px] text-muted-foreground">The host keeps the file, and it is not connected.</p> : null}
      <Dialog open={open} onOpenChange={(next) => (next || !holdClose.current()) && setOpen(next)}>
        {/* The popup's content mounts as it opens and goes once it has closed, so each opening reads the file afresh. */}
        <DialogContent initialFocus={field} className="flex max-h-[calc(100vh-4rem)] flex-col sm:max-w-[min(960px,calc(100%-4rem))]">
          <DirectionsEditor holdClose={holdClose} field={field} />
        </DialogContent>
      </Dialog>
    </Tile>
  )
}

function DirectionsEditor({ holdClose, field }: { holdClose: RefObject<() => boolean>; field: RefObject<HTMLTextAreaElement | null> }) {
  const [file, setFile] = useState<DirectionsFile | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'reading' | 'saving' | null>('reading')
  const [problem, setProblem] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [warned, setWarned] = useState(false)

  const bytes = useMemo(() => utf8Bytes(text), [text])
  const dirty = file !== null && text !== file.text
  const over = bytes > DIRECTIONS_MAX_BYTES

  useEffect(() => {
    holdClose.current = () => {
      if (!dirty || warned) return false
      setWarned(true)
      return true
    }
  })
  useEffect(() => () => void (holdClose.current = () => false), [holdClose])

  const load = async () => {
    setBusy('reading')
    setProblem(null)
    try {
      const read = await runCommand('directions.read')
      setFile(read)
      setText(read.text)
      setConflict(null)
      setSaved(false)
      setWarned(false)
    } catch (error) {
      setProblem(reason(error))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const save = async () => {
    if (!file || busy || !dirty || over) return
    setBusy('saving')
    setProblem(null)
    try {
      const answer = await runCommand('directions.save', { text, version: file.version })
      if (answer.saved) {
        // Words typed while it saved stay, and show as unsaved against the copy now on disk.
        setFile(answer.file)
        setConflict(null)
        setSaved(true)
        setWarned(false)
      } else setConflict(answer.message)
    } catch (error) {
      setProblem(reason(error))
    } finally {
      setBusy(null)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    void save()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" onKeyDown={onKeyDown}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          Directions
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-tone-1 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              Unsaved
            </span>
          ) : null}
        </DialogTitle>
        <DialogDescription className="font-mono text-[12px] [overflow-wrap:anywhere]">{file?.path ?? 'AGENTS.md'}</DialogDescription>
      </DialogHeader>
      {file && !file.exists ? (
        <p className="text-[12px] text-muted-foreground">There is no AGENTS.md yet. This is hobkin's default, which hobkin writes there the first time it reads it. A save writes yours instead.</p>
      ) : null}
      <textarea
        ref={field}
        aria-label="hobkin's directions"
        value={text}
        readOnly={!file}
        placeholder={busy === 'reading' ? 'Reading AGENTS.md…' : undefined}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(event) => {
          setText(event.currentTarget.value)
          if (saved) setSaved(false)
        }}
        className="h-[62vh] min-h-[280px] w-full resize-none rounded-xl border border-border-strong bg-tone-1 p-3 font-mono text-[12.5px] leading-[1.6] outline-offset-2 [tab-size:4] [font-variant-ligatures:none]"
      />
      {conflict ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-[13px]">
          <span className="min-w-0 flex-1 text-bad-fg">{conflict} Reload drops your edits here, so copy them first to keep them.</span>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void load()}>
            Reload
          </Button>
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-[13px] leading-snug text-bad-fg">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <p className={cn('text-[12px] tabular-nums', over ? 'text-bad-fg' : 'text-muted-foreground')}>
          {count(bytes)} of {count(DIRECTIONS_MAX_BYTES)} bytes{over ? `, ${count(bytes - DIRECTIONS_MAX_BYTES)} over what hobkin reads` : ''}
        </p>
        <p role="status" className="min-w-0 flex-1 text-[12px] text-muted-foreground">
          {warned && dirty ? 'Unsaved changes. Close again to drop them.' : saved && !dirty ? 'Saved. hobkin follows it from the next message and run.' : ''}
        </p>
        <Button
          variant="ghost"
          disabled={!dirty || busy !== null}
          onClick={() => {
            setText(file?.text ?? '')
            setWarned(false)
          }}
        >
          Revert
        </Button>
        <Button disabled={!dirty || over || busy !== null} onClick={() => void save()}>
          {busy === 'saving' ? 'Saving…' : 'Save'}
          <Kbd className="bg-primary-foreground/15 text-primary-foreground">⌘S</Kbd>
        </Button>
      </div>
    </div>
  )
}
