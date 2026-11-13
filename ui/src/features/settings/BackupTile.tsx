import { useCallback, useEffect, useState } from 'react'
import { BACKUP_CADENCES, BACKUP_SAFETY_KEPT, type BackupCadence, type BackupEntry, type BackupState } from '#shared/backup/types.ts'
import { Rise } from '@/app/Reveal.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog.tsx'
import { Input } from '@/components/ui/input.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { useHost } from '@/lib/host/hooks.ts'
import { useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { confirmsRestore, formatBytes, parseLimit, RESTORE_WORD, restoreWaitsFor, scheduleLine } from './backup.ts'

const CADENCE_LABEL: Record<BackupCadence, string> = { hourly: 'Hourly', daily: 'Daily' }
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))
const beforeRestore = (name: string) => name.endsWith('-before-restore.zip')

/**
 * Local backup of hobkin's own records into zips kept beside its folder. The host does the work, on a schedule while it
 * runs. A backup taken while hobkin writes is best-effort. Restore puts the records back as they were and leaves working
 * copies as they are, so it asks for a typed word. It waits until nothing runs, and the host restarts right after it,
 * so hobkin opens the restored records instead of writing on into them.
 */
export function BackupTile() {
  const hasHost = useHasHost()
  const waits = useHost((host) => restoreWaitsFor(host.snapshot))
  const [state, setState] = useState<BackupState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [limitText, setLimitText] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [restoring, setRestoring] = useState<BackupEntry | null>(null)
  const [typed, setTyped] = useState('')
  const [restored, setRestored] = useState<{ name: string; safety: string | null } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    try {
      setState(await runCommand('backup.list'))
    } catch (error) {
      setProblem(reason(error))
    }
    setNow(Date.now())
  }, [])

  // What the host has now, and again every so often, since a backup can start by itself.
  useEffect(() => {
    if (!hasHost) return
    void refresh()
    const timer = setInterval(() => void refresh(), 15_000)
    return () => clearInterval(timer)
  }, [hasHost, refresh])

  const act = async (work: () => Promise<void>) => {
    setProblem(null)
    setPending(true)
    try {
      await work()
    } catch (error) {
      setProblem(reason(error))
    } finally {
      setPending(false)
      setNow(Date.now())
    }
  }
  const configure = (change: { enabled?: boolean; cadence?: BackupCadence; limit?: number }) => act(async () => setState(await runCommand('backup.config', change)))
  const commitLimit = () => {
    const limit = limitText === null ? null : parseLimit(limitText)
    if (limit === null) {
      if (limitText !== null) setProblem('The limit is a whole number from 1 to 100.')
      setLimitText(null)
      return
    }
    setLimitText(null)
    if (limit !== state?.config.limit) void configure({ limit })
  }
  const closeRestore = () => {
    setRestoring(null)
    setTyped('')
  }
  const restore = () => {
    const entry = restoring
    if (!entry || !confirmsRestore(typed)) return
    closeRestore()
    void act(async () => {
      const done = await runCommand('backup.restore', { name: entry.name, confirm: true })
      setRestored({ name: done.restored, safety: done.safety })
      // hobkin still has the old records open: the host restarts at once, so it opens the restored ones instead of writing on.
      await runCommand('host.restart')
    })
  }

  const busy = pending || state?.busy != null

  return (
    <Rise className="col-span-6 @max-[820px]:col-span-2">
      <section aria-label="Backup" className="flex h-full flex-col gap-3 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">Backup</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">A zip of hobkin's own records</p>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
            Holds settings, memory, notes, routines, reports, decisions, conversations and the work queue. Leaves out working copies and clones of projects, what runs leave beside their reports, run transcripts and the search index.
          </p>
          <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
            Saved on this Mac beside the hobkin folder while the host runs. A copy taken while hobkin writes is best effort, and the oldest are deleted past the limit.
          </p>
        </header>
        {!hasHost || !state ? (
          <p className="text-[13px] text-muted-foreground">{hasHost ? 'Reading backups…' : 'Backups are managed by the host, which is not connected.'}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl bg-surface px-4 py-3">
              <label className="flex items-center gap-3">
                <Switch checked={state.config.enabled} disabled={busy} onCheckedChange={(enabled) => void configure({ enabled })} data-stop="" />
                <span className="text-[14px] font-medium">Back up automatically</span>
              </label>
              <div role="radiogroup" aria-label="How often" className="flex w-fit rounded-full bg-tone-1 p-0.5">
                {BACKUP_CADENCES.map((cadence) => {
                  const selected = state.config.cadence === cadence
                  return (
                    <button
                      key={cadence}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={busy}
                      data-stop={selected ? '' : undefined}
                      onClick={() => !selected && void configure({ cadence })}
                      className={cn('rounded-full px-3 py-1 text-[13px] outline-offset-2', selected ? 'bg-background font-medium' : 'text-muted-foreground')}
                    >
                      {CADENCE_LABEL[cadence]}
                    </button>
                  )
                })}
              </div>
              <label className="flex items-center gap-2 text-[13px]">
                Keep
                <Input
                  type="number"
                  min={1}
                  max={100}
                  inputMode="numeric"
                  aria-label="How many backups to keep"
                  data-stop=""
                  disabled={busy}
                  className="w-16"
                  value={limitText ?? String(state.config.limit)}
                  onChange={(event) => setLimitText(event.target.value)}
                  onBlur={commitLimit}
                  onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                />
                backups
              </label>
              <Button variant="outline" className="ml-auto" data-stop="" disabled={busy} onClick={() => void act(async () => setState(await runCommand('backup.now')))}>
                {state.busy === 'backup' || pending ? 'Backing up…' : 'Back up now'}
              </Button>
            </div>
            <p className="text-[12px] text-muted-foreground">{scheduleLine(state, now)}</p>
            <p className="text-[12px] text-muted-foreground">Kept in {state.directory}</p>
            {state.lastError ? (
              <p role="alert" className="text-[13px] leading-snug text-bad-fg">
                The last backup failed. {state.lastError}
              </p>
            ) : null}
            {state.skipped ? (
              <p role="alert" className="text-[13px] leading-snug text-bad-fg">
                The backup of {when(state.backups.find(({ name }) => name === state.skipped?.name)?.at ?? now)} could not take {state.skipped.paths.length}{' '}
                {state.skipped.paths.length === 1 ? 'file' : 'files'}: {state.skipped.paths.slice(0, 3).join(', ')}
                {state.skipped.paths.length > 3 ? ' and more' : ''}. A restore leaves them as they are.
              </p>
            ) : null}
            {state.backups.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No backups yet.</p>
            ) : (
              <ul aria-label="Backups" className="flex flex-col gap-1.5">
                {state.backups.map((backup) => (
                  <li key={backup.name} className="flex items-center gap-4 rounded-2xl bg-surface px-4 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {when(backup.at)}
                      {beforeRestore(backup.name) ? <span className="ml-2 font-normal text-muted-foreground">Before a restore</span> : null}
                    </span>
                    <span className="text-[12px] text-muted-foreground">{formatBytes(backup.bytes)}</span>
                    <Button variant="ghost" size="sm" data-stop="" disabled={busy || waits !== null} aria-label={`Restore the backup from ${when(backup.at)}`} onClick={() => setRestoring(backup)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {waits && state.backups.length > 0 ? <p className="text-[12px] text-muted-foreground">{waits}</p> : null}
            {restored ? (
              <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-[13px]">
                <span className="min-w-0 flex-1">
                  Restored. The host restarts now, so hobkin opens the restored records. Working copies were not touched.
                  {restored.safety ? ' The records from before are saved as a backup marked Before a restore.' : ''}
                </span>
                <Button variant="outline" data-stop="" onClick={() => void runCommand('host.restart').catch((error) => setProblem(reason(error)))}>
                  Restart host now
                </Button>
              </div>
            ) : null}
          </>
        )}
        {problem ? (
          <p role="alert" className="text-[13px] leading-snug text-bad-fg">
            {problem}
          </p>
        ) : null}
      </section>
      <Dialog open={restoring !== null} onOpenChange={(open) => !open && closeRestore()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Go back to this backup?</DialogTitle>
            <DialogDescription>
              {restoring ? `hobkin's records go back to how they were on ${when(restoring.at)}. ` : ''}
              Conversations, reports, routines, notes, settings and the work queue since then are replaced. Working copies of projects stay as they are now. A copy of the records there now is saved first, marked Before a restore, so you can undo it: the last {BACKUP_SAFETY_KEPT} of those are kept whatever the limit. The host restarts right after, so hobkin opens the restored records.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-[13px]">
            Type “{RESTORE_WORD}” to confirm
            <Input value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={!confirmsRestore(typed) || waits !== null} onClick={restore}>
              Restore records
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Rise>
  )
}
