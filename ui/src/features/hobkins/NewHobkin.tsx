import { Dialog } from '@base-ui/react/dialog'
import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { hobkinAgentId } from '#shared/protocol/hobkins.ts'
import type { ModelChoice } from '#shared/tiers/tiers.ts'
import { focusInput, requestCanvasFocus } from '@/app/focus.ts'
import { holdStill, useStill } from '@/app/still.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select.tsx'
import { useReadClaudeCode } from '@/features/settings/claude-code-store.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { useTiers } from '@/features/tiers/store.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { runCommand, useHost } from '@/lib/host/index.ts'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { introSeen, markIntroSeen } from './intro.ts'
import {
  CLAUDE_EFFORT_CHOICES,
  CLAUDE_MODEL_CHOICES,
  chosenFolder,
  claudeStart,
  engineOf,
  engineOffers,
  folderOffers,
  shownChoice,
  startArgs,
  type EngineChoice,
  type EngineOffer,
} from './rules.ts'
import { useNewHobkin } from './store.ts'

/** A hue for the durable hobkin the explanation shows. Any other than hobkin's own yellow. */
const WORKER_HUE = 200

/**
 * The New hobkin sheet, opened by Command+N from any screen (`034-durable-hobkins`). The first time it explains how a
 * durable hobkin differs from the main one, and one button goes on to the form. Afterwards it opens on the form: the folder
 * and what it runs on, the last ones chosen at first, with the keyboard on Start, so Command+N and Enter start one. Start
 * runs `hobkin.start` and opens the new hobkin's page with the keyboard in its talk box, where its first message goes. From
 * the full prompt editor (Shift+Control+Enter) the sheet carries the prompt, and Start sends it as that first message. It
 * is a dialog, so it owns the keys while it is open, and Tab walks its fields as in any dialog.
 */
export function NewHobkin() {
  const open = useNewHobkin((state) => state.open)
  const closeSheet = useNewHobkin((state) => state.closeSheet)
  const first = useRef<HTMLElement | null>(null)
  /**
   * The hobkin this sheet started, kept until the sheet opens again. Once the sheet has gone the keyboard goes to its talk
   * box instead of back where it was. Base UI asks where focus returns only after the close has completed, so this is never
   * cleared on the way out: the main input would take the keyboard back, and that closes any agent's page.
   */
  const started = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (open) started.current = null
  }, [open])

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet()
      }}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return
        const id = started.current
        if (!id) {
          if (document.activeElement === document.body) focusInput()
          return
        }
        // The sheet leaves the page after this, with the keyboard inside it. On the next frame it has gone: the hobkin's
        // page is there again, if anything closed it, and its talk box takes the keyboard.
        requestAnimationFrame(() => {
          if (started.current !== id) return
          useView.getState().openAgentCanvas(hobkinAgentId(id))
          requestCanvasFocus('[data-agent-input]')
        })
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-md transition-opacity duration-[320ms] ease-[ease] data-[ending-style]:opacity-0 data-[ending-style]:duration-[200ms] data-[starting-style]:opacity-0" />
        <Dialog.Popup
          initialFocus={first}
          finalFocus={() => started.current === null}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[min(640px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] bg-background shadow-float outline-none',
            // It rises into place with weight, and leaves quicker than it came, as the tiers lightbox does.
            'transition-[translate,scale,opacity] duration-[440ms] ease-[var(--ease-drawer)]',
            'data-[starting-style]:-translate-y-[42%] data-[starting-style]:scale-[0.9] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[200ms]',
          )}
        >
          <Sheet
            first={first}
            onStarted={(id) => {
              started.current = id
              closeSheet()
              useView.getState().openAgentCanvas(hobkinAgentId(id))
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The explanation the first time, and the form after it. The sheet starts over each time it opens. */
function Sheet({ first, onStarted }: { first: RefObject<HTMLElement | null>; onStarted: (id: string) => void }) {
  const still = useStill()
  const [explaining, setExplaining] = useState(() => !introSeen())
  const view = explaining ? 'intro' : 'form'
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={view}
        className="flex min-h-0 flex-col"
        initial={holdStill({ opacity: 0, transform: 'translateY(18px) scale(0.98)' }, still)}
        animate={holdStill({ opacity: 1, transform: 'translateY(0px) scale(1)', transition: { transform: spring.rise, opacity: tween.enter } }, still)}
        exit={holdStill({ opacity: 0, transform: 'translateY(-10px) scale(0.99)', transition: tween.exit }, still)}
      >
        {explaining ? (
          <Intro
            first={first}
            onOn={() => {
              markIntroSeen()
              setExplaining(false)
            }}
          />
        ) : (
          <Form first={first} onExplain={() => setExplaining(true)} onStarted={onStarted} />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

/** How a durable hobkin differs from the main one, in plain words. */
function Intro({ first, onOn }: { first: RefObject<HTMLElement | null>; onOn: () => void }) {
  return (
    <div className="flex flex-col gap-6 p-8">
      <div>
        <Dialog.Title className="font-heading text-[24px] leading-tight font-semibold tracking-[-0.022em]">A hobkin of your own</Dialog.Title>
        <Dialog.Description className="mt-1.5 text-[14px] text-muted-foreground">Command+N starts one. Here is how it differs from the main hobkin.</Dialog.Description>
      </div>
      <ul className="flex flex-col gap-4">
        <Point face={<Hob mood="idle" size={40} stage="var(--background)" />} title="The main hobkin">
          Your companion. It remembers, plans and hands work to agents.
        </Point>
        <Point face={<AgentHood hue={WORKER_HUE} size={34} mood="working" />} title="A durable hobkin">
          A worker you talk to directly, in one folder. It keeps its conversation until you end it, and it is still there after a
          restart.
        </Point>
        <Point face={<AgentHood hue={WORKER_HUE} size={34} mood="idle" working={false} />} title="When it waits">
          The main hobkin tells you in the chat when one has stopped and is waiting for you.
        </Point>
      </ul>
      <div className="flex justify-end">
        <Button
          ref={(element: HTMLButtonElement | null) => {
            first.current = element
          }}
          size="lg"
          className="px-4"
          onClick={onOn}
        >
          Start one
        </Button>
      </div>
    </div>
  )
}

function Point({ face, title, children }: { face: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-4">
      <span className="grid size-11 shrink-0 place-items-center">{face}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-heading text-[15px] font-semibold tracking-[-0.01em]">{title}</span>
        <span className="block text-[14px] leading-relaxed text-muted-foreground">{children}</span>
      </span>
    </li>
  )
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function Form({ first, onExplain, onStarted }: { first: RefObject<HTMLElement | null>; onExplain: () => void; onStarted: (id: string) => void }) {
  const config = useTiers((state) => state.config)
  const follows = useTiers((state) => state.follows)
  const checks = useTiers((state) => state.checks)
  const models = useModelChoices()
  const claude = useReadClaudeCode()
  const projects = useHost((state) => (state.snapshot.work as { projects?: unknown[] } | undefined)?.projects)
  const connected = useHost((state) => hasHost(state) && state.link === 'open')
  const last = useNewHobkin((state) => state.last)
  const remember = useNewHobkin((state) => state.remember)
  const prompt = useNewHobkin((state) => state.prompt)

  const offers = useMemo(
    () =>
      engineOffers({
        tiers: { config, follows, checks },
        models,
        claudeInstalled: claude?.status.installed === true,
      }),
    [config, follows, checks, models, claude],
  )
  const folders = useMemo(() => folderOffers(projects), [projects])
  // What the user wants, the last choices at first. The folders, Claude Code and Pi's models are learned after the
  // sheet opens, so what is wanted is kept as it is, and what shows is worked out from it each time.
  const [wantedFolder, setCwd] = useState(last.cwd)
  const [wanted, setChosen] = useState<EngineChoice | null>(last.engine)
  const cwd = chosenFolder(folders, wantedFolder)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choice = shownChoice(wanted, offers, claudeStart(last.claude, claude?.settings))
  const engine = engineOf(choice, models)
  const args = startArgs({ cwd, engine, text: prompt?.text })
  const canStart = connected && !busy && args !== null
  const customModels = offers.find((offer) => offer.kind === 'pi')?.models ?? []

  const start = async () => {
    if (!canStart || !args) return
    setBusy(true)
    setProblem(null)
    try {
      const started = await runCommand('hobkin.start', args)
      remember({ id: started.id }, cwd, choice)
      onStarted(started.id)
    } catch (error) {
      // The host's own sentence, in place: a folder that is not there, an engine that cannot run, the most it keeps.
      setProblem(message(error))
      setBusy(false)
    }
  }

  const status = problem ?? (connected ? null : 'hobkin is not connected, so nothing can start.')

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault()
        void start()
      }}
      onKeyDown={(event) => {
        // Enter starts it from anywhere in the form, the choices of what it runs on included. A control with an Enter of its
        // own keeps it: a button does what it says, a select opens or chooses, and Start submits the form itself.
        if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return
        if (event.nativeEvent.isComposing) return
        if (event.target instanceof Element && event.target.closest('button:not([role="radio"]), [role="combobox"], [role="listbox"], [role="option"]')) return
        event.preventDefault()
        void start()
      }}
    >
      <header className="flex items-start gap-4 px-7 pt-7">
        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-heading text-[24px] leading-tight font-semibold tracking-[-0.022em]">New hobkin</Dialog.Title>
          <Dialog.Description className="mt-1 text-[14px] text-muted-foreground">A worker you talk to directly. It keeps its conversation until you end it.</Dialog.Description>
        </div>
        <button
          type="button"
          onClick={onExplain}
          className="mt-1 shrink-0 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2 hover:text-foreground"
        >
          How it differs
        </button>
      </header>

      <div className="scroll-quiet flex min-h-0 flex-col gap-5 overflow-y-auto px-7 py-5">
        {prompt ? (
          <Field label="First message">
            {/* One line, whatever the prompt's length, so the sheet keeps its size. */}
            <p className="flex min-w-0 items-baseline gap-3 text-[14px]">
              <span className="min-w-0 flex-1 truncate">{prompt.text.trim()}</span>
              {prompt.images ? <span className="shrink-0 text-[12px] text-muted-foreground">{prompt.images === 1 ? 'Its image stays in the draft' : 'Its images stay in the draft'}</span> : null}
            </p>
          </Field>
        ) : null}
        <Field label="Folder">
          <Select items={folders.map(({ cwd: value, label }) => ({ value, label }))} value={cwd} onValueChange={(value) => value && setCwd(String(value))}>
            <SelectTrigger aria-label="Folder" className={cn('w-full', FIELD_SELECT)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {folders.map((folder) => (
                <SelectItem key={folder.cwd} value={folder.cwd} label={folder.label}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{folder.label}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{folder.detail}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Runs on">
          <EngineGroup offers={offers} choice={choice} onChoose={setChosen} />
          <AnimatePresence initial={false}>
            {choice.kind === 'pi' ? <Custom key="custom" models={customModels} choice={choice} onChoose={setChosen} /> : null}
            {choice.kind === 'claude' ? <ClaudeOptions key="claude" choice={choice} onChoose={setChosen} /> : null}
          </AnimatePresence>
        </Field>
      </div>

      <footer className="flex items-center gap-3 border-t border-border px-7 py-4">
        <p role={problem ? 'alert' : undefined} className={cn('min-w-0 flex-1 text-[12px] leading-snug', problem || !connected ? 'text-bad-fg' : 'text-muted-foreground')}>
          {status ?? (
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> starts it
            </span>
          )}
        </p>
        <Dialog.Close render={<Button type="button" variant="ghost" />}>Cancel</Dialog.Close>
        <Button
          ref={(element: HTMLButtonElement | null) => {
            first.current = element
          }}
          type="submit"
          disabled={!canStart}
        >
          {busy ? 'Starting' : 'Start'}
        </Button>
      </footer>
    </form>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="eyebrow flex items-baseline gap-2">{label}</span>
      {children}
    </div>
  )
}

/** What a choice is called inside the group, so the selected row can be found again. */
const keyOf = (choice: EngineChoice | EngineOffer) => (choice.kind === 'tier' ? `tier:${choice.tier}` : choice.kind)

/** Which way an arrow key moves along a radio group: one on, one back, or not at all. */
function stepOf(key: string): number {
  if (key === 'ArrowDown' || key === 'ArrowRight') return 1
  if (key === 'ArrowUp' || key === 'ArrowLeft') return -1
  return 0
}

/** Arrow keys move along a radio group's buttons and choose, as Pi's own pickers do. */
function moveIn(event: KeyboardEvent<HTMLElement>, count: number, at: number, choose: (index: number) => void) {
  const delta = stepOf(event.key)
  if (!delta || event.metaKey || event.ctrlKey || event.altKey) return
  event.preventDefault()
  const group = event.currentTarget
  const next = Math.min(count - 1, Math.max(0, at + delta))
  if (next === at) return
  choose(next)
  requestAnimationFrame(() => group.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus())
}

const CLAUDE_LINE = 'Spends the Claude subscription, and never asks before it acts.'

/** The line under an offer's name: a tier's model and thinking, what Claude Code costs, or what Custom reaches. */
function offerDetail(offer: EngineOffer): string {
  if (offer.kind === 'tier') return offer.effort ? `${offer.model} · ${offer.effort}` : offer.model
  if (offer.kind === 'claude') return CLAUDE_LINE
  return 'Any model Pi can reach, with its own thinking'
}

/** A select that sits beside a text field reads as one: the same height, edge and ground. */
const FIELD_SELECT = 'rounded-full border-[1.5px] bg-background px-3.5 text-[14px] data-[size=default]:h-9 dark:bg-background dark:hover:bg-background'

/** One group for what it runs on: the four tiers with their models, Claude Code while it is installed, and Custom. */
function EngineGroup({ offers, choice, onChoose }: { offers: readonly EngineOffer[]; choice: EngineChoice; onChoose: (choice: EngineChoice) => void }) {
  const still = useStill()
  const at = Math.max(0, offers.findIndex((offer) => keyOf(offer) === keyOf(choice)))

  const pick = (offer: EngineOffer) => {
    if (offer.kind === 'tier') onChoose({ kind: 'tier', tier: offer.tier })
    // Claude Code keeps the model and effort already chosen, or starts on what the last Claude hobkin used.
    else if (offer.kind === 'claude') onChoose(choice.kind === 'claude' ? choice : { kind: 'claude' })
    // Custom keeps the model and thinking already chosen, or starts on Pi's first model.
    else if (choice.kind === 'pi') onChoose(choice)
    else onChoose({ kind: 'pi', model: offer.models[0]?.id ?? null, effort: null })
  }

  return (
    <div role="radiogroup" aria-label="Runs on" className="grid gap-1 sm:grid-cols-2" onKeyDown={(event) => moveIn(event, offers.length, at, (index) => pick(offers[index]!))}>
      {offers.map((offer, index) => {
        const selected = index === at
        return (
          <button
            key={keyOf(offer)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => pick(offer)}
            className={cn(
              'relative flex min-w-0 flex-col rounded-2xl px-3.5 py-2.5 text-left transition-colors duration-[160ms] ease-[ease]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:bg-tone-1 hover:text-foreground',
              offer.kind !== 'tier' && 'sm:col-span-2',
            )}
          >
            {selected ? <motion.span layoutId="new-hobkin-engine" className="absolute inset-0 rounded-2xl bg-surface-2" transition={still ? { duration: 0 } : spring.follow} /> : null}
            <span className="relative font-heading text-[14px] font-semibold tracking-[-0.01em]">{offer.label}</span>
            <span className="relative truncate text-[12px] text-muted-foreground">{offerDetail(offer)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Claude Code: any of its models, and any of its efforts. Each select says what it sets, as both may read as a default. */
function ClaudeOptions({ choice, onChoose }: { choice: Extract<EngineChoice, { kind: 'claude' }>; onChoose: (choice: EngineChoice) => void }) {
  const still = useStill()
  const options = [
    { name: 'Model', key: 'model', choices: CLAUDE_MODEL_CHOICES, value: choice.model },
    { name: 'Effort', key: 'effort', choices: CLAUDE_EFFORT_CHOICES, value: choice.effort },
  ] as const

  return (
    <motion.div
      className="mt-2 flex flex-wrap items-center gap-3"
      initial={holdStill({ opacity: 0, transform: 'translateY(-6px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(-4px)', transition: tween.exit }, still)}
    >
      {options.map(({ name, key, choices, value }) => (
        <Select key={key} items={choices} value={value ?? 'default'} onValueChange={(next) => next && onChoose({ ...choice, [key]: next })}>
          <SelectTrigger aria-label={name} className={cn('min-w-48 flex-1', FIELD_SELECT)}>
            <span className="shrink-0 text-muted-foreground">{name}</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((option) => (
              <SelectItem key={option.value} value={option.value} label={option.label}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </motion.div>
  )
}

/** How the model list names a model: its name, then who serves it. */
const modelLabel = ({ name, provider }: ModelChoice) => `${name} · ${provider}`

/** Custom: any model Pi can reach now, and one of that model's own thinking levels. */
function Custom({ models, choice, onChoose }: { models: readonly ModelChoice[]; choice: Extract<EngineChoice, { kind: 'pi' }>; onChoose: (choice: EngineChoice) => void }) {
  const still = useStill()
  const model = models.find(({ id }) => id === choice.model)
  const efforts = model?.efforts ?? []
  // The level it will run at: the one chosen, or that model's nearest.
  const engine = engineOf(choice, models)
  const level = engine?.kind === 'pi' ? engine.effort : null
  const levelAt = level ? Math.max(0, efforts.indexOf(level)) : 0

  return (
    <motion.div
      className="mt-2 flex flex-wrap items-center gap-3"
      initial={holdStill({ opacity: 0, transform: 'translateY(-6px)' }, still)}
      animate={holdStill({ opacity: 1, transform: 'translateY(0px)', transition: tween.enter }, still)}
      exit={holdStill({ opacity: 0, transform: 'translateY(-4px)', transition: tween.exit }, still)}
    >
      <Select
        items={models.map((option) => ({ value: option.id, label: modelLabel(option) }))}
        value={choice.model}
        onValueChange={(value) => value && onChoose({ kind: 'pi', model: String(value), effort: choice.effort })}
      >
        <SelectTrigger aria-label="Model" className={cn('min-w-56 flex-1', FIELD_SELECT)}>
          <SelectValue placeholder="Choose a model" />
        </SelectTrigger>
        <SelectContent>
          {models.map((option) => (
            <SelectItem key={option.id} value={option.id} label={modelLabel(option)}>
              {option.name} <span className="text-muted-foreground">{option.provider}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {efforts.length ? (
        <div
          role="radiogroup"
          aria-label="Thinking"
          className="flex flex-wrap gap-1"
          onKeyDown={(event) => moveIn(event, efforts.length, levelAt, (index) => onChoose({ ...choice, effort: efforts[index]! }))}
        >
          {efforts.map((option) => {
            const selected = option === level
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChoose({ ...choice, effort: option })}
                className={cn(
                  'h-8 rounded-full px-3 text-[12.5px] font-medium transition-colors duration-[160ms] ease-[ease]',
                  selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                )}
              >
                {option}
              </button>
            )
          })}
        </div>
      ) : model ? (
        <span className="text-[12px] text-muted-foreground">This model does not think.</span>
      ) : null}
    </motion.div>
  )
}
