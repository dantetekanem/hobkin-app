import { Dialog } from '@base-ui/react/dialog'
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { cn } from '@/lib/utils.ts'
import type { FolderLook, NewProjectDone, ProjectKind, WorkState } from '#shared/protocol/work.ts'
import {
  addProject,
  addsFromKey,
  blocker,
  folderLine,
  kindLine,
  kindOf,
  pickKind,
  READY_LINE,
  rowAfterAdd,
  sampleAdd,
  sampleLook,
  yoloLine,
  yoloOn,
  type AddCalls,
  type Looked,
  type NewProjectForm,
  type OpenedFrom,
} from './new-project.ts'
import { Segmented } from './parts.tsx'
import { useWorkUi } from './store.ts'

/** How long typing must stop before hobkin is asked what is at the folder. */
const LOOK_AFTER_MS = 250

const KINDS: readonly { value: ProjectKind; label: string }[] = [
  { value: 'code', label: 'Code' },
  { value: 'goal', label: 'Goal' },
]

/**
 * The New project popup (_specs/059-new-project, "The popup"), opened over Work or YOLO mode by the button in the
 * Projects heading or by N. The user names a folder, typed or picked in the Mac's own chooser, and says what they want
 * from the project. It looks as the Workload sheet does and keeps one size from open to close: every line that changes
 * says its words in one clamped line of fixed height. Command+Enter adds from anywhere in it, Escape closes it.
 */
interface NewProjectSheetProps {
  open: boolean
  from: OpenedFrom
  work: WorkState | null
  live: boolean
  onClose: () => void
  /** The New project button, which has the keyboard again once the popup closes without an add. */
  returnTo: RefObject<HTMLButtonElement | null>
}

export function NewProjectSheet({ open, from, work, live, onClose, returnTo }: NewProjectSheetProps) {
  const still = useStill()
  const popup = useRef<HTMLDivElement | null>(null)
  // After an add the keyboard goes to the new project's row, not back to the button.
  const added = useRef(false)
  const fade = still
    ? 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
    : 'transition-[translate,scale,opacity] duration-[360ms] ease-[var(--ease-drawer)] data-[starting-style]:translate-y-[-46%] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-[180ms]'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) added.current = false
        else onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm transition-opacity duration-[240ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          ref={popup}
          initialFocus={() => popup.current?.querySelector<HTMLElement>('[data-new-folder]') ?? null}
          finalFocus={() => (added.current ? false : returnTo.current)}
          className={cn(
            'scroll-quiet fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[min(680px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[28px] bg-background shadow-float outline-none',
            fade,
          )}
        >
          {open ? <NewProjectForm from={from} work={work} live={live} onClose={onClose} onAdded={() => (added.current = true)} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const FIELD = 'border-[1.5px] border-input bg-background px-4 text-[13.5px] outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-60'
/** A line that changes: one line of fixed height, clamped, so what is around it never moves. */
const LINE = 'h-[18px] truncate text-[12.5px] leading-[18px]'

function NewProjectForm({ from, work, live, onClose, onAdded }: { from: OpenedFrom; work: WorkState | null; live: boolean; onClose: () => void; onAdded: () => void }) {
  const [folder, setFolder] = useState('')
  const [picked, setPicked] = useState<ProjectKind | null>(null)
  const [wants, setWants] = useState('')
  const [yoloChoice, setYoloChoice] = useState<boolean | null>(null)
  const [looked, setLooked] = useState<Looked | null>(null)
  const [adding, setAdding] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // Set when the project was added and only YOLO mode would not turn on: the popup stays to say so.
  const [done, setDone] = useState<NewProjectDone | null>(null)
  const typed = useRef('')
  const projects = useRef(work?.projects ?? [])
  projects.current = work?.projects ?? []

  const form: NewProjectForm = { folder, picked, wants, yoloChoice, from, looked }
  const kind = kindOf(form)
  const stops = blocker(form)

  // Each look is asked 250 ms after typing stops. An answer for older text is dropped.
  useEffect(() => {
    typed.current = folder.trim()
    setRefusal(null)
    if (!typed.current || looked?.asked === typed.current) return
    const asked = typed.current
    const timer = setTimeout(() => {
      const look: Promise<FolderLook> = live ? runCommand('work.project.look', { folder: asked }) : Promise.resolve(sampleLook(asked, projects.current))
      look
        .then((answer) => {
          if (typed.current === asked) setLooked({ asked, look: answer })
        })
        .catch((error) => {
          if (typed.current === asked) setRefusal(error instanceof Error ? error.message : String(error))
        })
    }, LOOK_AFTER_MS)
    return () => clearTimeout(timer)
    // The look is asked again only when the text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, live])

  const choose = async () => {
    try {
      const answer = live ? await runCommand('work.folder.pick') : { folder: '~/Projects/newapp' }
      if (answer.folder) setFolder(answer.folder)
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error))
    }
  }

  const calls: AddCalls = live
    ? { add: (args) => runCommand('work.project.new', args), yolo: (args) => runCommand('work.yolo.project', args) }
    : {
        add: async (args) => {
          const outcome = sampleAdd(useWorkUi.getState().sample, args)
          if ('refused' in outcome) throw new Error(outcome.refused)
          useWorkUi.setState({ sample: outcome.state })
          return outcome.done
        },
        yolo: async () => undefined,
      }

  const add = async () => {
    if (adding || done || stops) return
    setAdding(true)
    setRefusal(null)
    const outcome = await addProject(form, calls)
    setAdding(false)
    if (outcome.result === 'refused') return setRefusal(outcome.line)
    onAdded()
    if (outcome.result === 'added-yolo-refused') {
      setDone(outcome.done)
      setRefusal(outcome.line)
      focusWhenThere(rowAfterAdd(from, outcome.done.slug), false)
      return
    }
    onClose()
    focusWhenThere(rowAfterAdd(from, outcome.done.slug), true)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!addsFromKey(event)) return
    event.preventDefault()
    event.stopPropagation()
    void add()
  }

  const foot = refusal ?? (done ? `${done.name} is in Work.` : (stops ?? READY_LINE))
  return (
    // The one place Command+Enter is read, so it adds from any field and any button in the popup.
    <div className="flex flex-col px-7 pt-6 pb-6" onKeyDown={onKeyDown}>
      <header className="flex items-start gap-4 pb-3">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.02em]">New project</Dialog.Title>
          <Dialog.Description className="mt-1 h-[22px] truncate text-[13.5px] leading-[22px] text-muted-foreground">Name a folder and say what you want from it.</Dialog.Description>
        </div>
        <Dialog.Close render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
          Close <Kbd>esc</Kbd>
        </Dialog.Close>
      </header>

      <Section label="Folder" htmlFor="new-project-folder">
        <div className="flex items-center gap-2">
          <input
            id="new-project-folder"
            data-new-folder=""
            value={folder}
            disabled={Boolean(done)}
            onChange={(event) => setFolder(event.target.value)}
            placeholder="~/Projects/app"
            spellCheck={false}
            autoComplete="off"
            className={cn(FIELD, 'h-9 min-w-0 flex-1 rounded-full font-mono text-[13px]')}
          />
          <Button variant="outline" disabled={Boolean(done)} onClick={() => void choose()}>
            Open…
          </Button>
        </div>
        <p className={cn(LINE, 'mt-1.5 px-1 text-muted-foreground')} title={folderLine(form)} aria-live="polite">
          {folderLine(form)}
        </p>
      </Section>

      <Section label="Kind">
        <Segmented label="Kind" name="new-project-kind" value={kind} options={KINDS} disabled={Boolean(done)} onChoose={(choice) => setPicked(pickKind(form, choice))} />
        <p className={cn(LINE, 'mt-1.5 px-1 text-muted-foreground')} title={kindLine(form)}>
          {kindLine(form)}
        </p>
      </Section>

      <Section label="What do you want from it?" htmlFor="new-project-wants">
        <textarea
          id="new-project-wants"
          value={wants}
          disabled={Boolean(done)}
          onChange={(event) => setWants(event.target.value)}
          placeholder={kind === 'goal' ? 'Needed. What this should reach, in your own words.' : 'Optional. What hobkin should keep in mind and work toward.'}
          className={cn(FIELD, 'scroll-quiet block h-[120px] w-full resize-none overflow-y-auto rounded-[20px] py-3 leading-relaxed [field-sizing:fixed]')}
        />
      </Section>

      <div className="flex items-center gap-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-heading text-[14px] leading-snug font-medium">YOLO mode here</p>
          <p className={cn(LINE, 'mt-0.5 text-muted-foreground')} title={yoloLine(form)}>
            {yoloLine(form)}
          </p>
        </div>
        <Switch aria-label="YOLO mode here" checked={yoloOn(form)} disabled={kind === 'goal' || Boolean(done)} onCheckedChange={setYoloChoice} />
      </div>

      <footer className="mt-1 flex items-center gap-4 border-t border-border pt-4">
        <p role={refusal ? 'alert' : undefined} title={foot} className={cn(LINE, 'min-w-0 flex-1 text-[13px]', refusal ? 'text-bad-fg' : stops ? 'text-muted-foreground' : 'text-foreground')}>
          {foot}
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Dialog.Close render={<Button variant="ghost" />}>{done ? 'Close' : 'Cancel'}</Dialog.Close>
          <Button disabled={Boolean(stops) || adding || Boolean(done)} onClick={() => void add()}>
            {adding ? 'Adding…' : 'Add project'}
            {adding ? null : <Kbd>⌘↵</Kbd>}
          </Button>
        </div>
      </footer>
    </div>
  )
}

/** One field of the popup: its name, quieter than what it holds, and the field with its line. */
function Section({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  const name = 'mb-1.5 block px-1 text-[13px] leading-snug font-medium text-muted-foreground'
  return (
    <div className="border-t border-border/60 py-3 first-of-type:border-t-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={name}>
          {label}
        </label>
      ) : (
        <p className={name}>{label}</p>
      )}
      {children}
    </div>
  )
}

/**
 * Puts the keyboard on the element once the screen draws it: hobkin publishes the new project a moment after the add.
 * Gives up after three seconds, leaving the keyboard where the close put it.
 */
function focusWhenThere(selector: string, scroll: boolean): void {
  let tries = 0
  const timer = setInterval(() => {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) {
      clearInterval(timer)
      element.focus({ preventScroll: true })
      if (scroll) element.scrollIntoView({ block: 'center' })
    } else if (++tries > 60) clearInterval(timer)
  }, 50)
}
