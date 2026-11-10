import { Dialog } from '@base-ui/react/dialog'
import { ArrowLeft, Check, ChevronRight, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { focusInput } from '@/app/keys.ts'
import {
  EFFORTS,
  TIER_IDS,
  TIER_INFO,
  filterModels,
  resolveTier,
  setTierModel,
  type Effort,
  type ModelChoice,
  type TiersConfig,
} from '#shared/tiers/tiers.ts'
import { Rise } from '@/app/Reveal.tsx'
import { useRunningAgents } from '@/app/running-agents.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, stagger } from '@/lib/motion.ts'
import { selectMainModel, useHasHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { useModelChoices } from './models.ts'
import { useTiers, type TierTarget } from './store.ts'

const TARGETS: TierTarget[] = ['lead', ...TIER_IDS]

/**
 * The lightbox where the user picks a model and a thinking level for hobkin and for each of the four tiers.
 * Changes are a draft until Apply. Spec: 017-model-tiers.
 */
export function TiersLightbox() {
  const open = useTiers((state) => state.open)
  const closeTiers = useTiers((state) => state.closeTiers)
  const [picking, setPicking] = useState<TierTarget | null>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (wasOpen.current && !open) {
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) focusInput()
      })
    }
    wasOpen.current = open
  }, [open])

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) return
        // Escape and a click outside close the model list first, then the lightbox.
        if (picking) setPicking(null)
        else closeTiers()
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-md transition-opacity duration-[320ms] ease-[ease] data-[ending-style]:opacity-0 data-[ending-style]:duration-[200ms] data-[starting-style]:opacity-0" />
        <Dialog.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[min(1080px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] bg-background shadow-float outline-none',
            // It rises into place with weight, and leaves quicker than it came.
            'transition-[translate,scale,opacity] duration-[440ms] ease-[var(--ease-drawer)]',
            'data-[starting-style]:-translate-y-[42%] data-[starting-style]:scale-[0.9] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[200ms]',
          )}
        >
          {open ? <TiersForm picking={picking} setPicking={setPicking} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function TiersForm({ picking, setPicking }: { picking: TierTarget | null; setPicking: (target: TierTarget | null) => void }) {
  const saved = useTiers((state) => state.config)
  // The models Pi can use now, once the host has answered.
  const models = useModelChoices()
  const focus = useTiers((state) => state.focus)
  const applyTiers = useTiers((state) => state.applyTiers)
  const [draft, setDraft] = useState<TiersConfig>(saved)
  const [moved, setMoved] = useState<Partial<Record<TierTarget, Effort>>>({})
  const changed = JSON.stringify(draft) !== JSON.stringify(saved)
  const hasHost = useHasHost()
  const [applying, setApplying] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // The lead is hobkin's own main model: the host saves it in hobkin's config and the open conversation goes on
  // with it at once. When the host refuses, its reason shows here and nothing is applied.
  const apply = async () => {
    if (applying) return
    setProblem(null)
    const leadChanged = draft.lead.model !== saved.lead.model || draft.lead.effort !== saved.lead.effort
    if (leadChanged && hasHost) {
      setApplying(true)
      try {
        await selectMainModel(draft.lead.model, draft.lead.effort)
      } catch (error) {
        setProblem(error instanceof Error ? error.message : String(error))
        return
      } finally {
        setApplying(false)
      }
    }
    applyTiers(draft)
  }

  // Command+Enter applies from anywhere in the window: after a model is picked the list closes and the keyboard
  // rests on the window itself, outside this form.
  const applyLatest = useRef(apply)
  applyLatest.current = apply
  useEffect(() => {
    if (!changed || picking) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !event.metaKey || event.defaultPrevented) return
      event.preventDefault()
      void applyLatest.current()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [changed, picking])

  const settingOf = (target: TierTarget) => (target === 'lead' ? { ...draft.lead, followsLead: false } : resolveTier(draft, target))
  const modelOf = (target: TierTarget) => models.find((model) => model.id === settingOf(target).model)

  const chooseModel = (target: TierTarget, model: ModelChoice) => {
    const result = setTierModel(draft, target, model)
    setDraft(result.config)
    setMoved((notes) => ({ ...notes, [target]: result.effortMovedFrom ?? undefined }))
    setPicking(null)
  }

  const chooseEffort = (target: TierTarget, effort: Effort) => {
    const setting = { model: settingOf(target).model, effort }
    setDraft(target === 'lead' ? { ...draft, lead: setting } : { ...draft, tiers: { ...draft.tiers, [target]: setting } })
    setMoved((notes) => ({ ...notes, [target]: undefined }))
  }

  const followLead = (target: TierTarget, follow: boolean) => {
    if (target === 'lead') return
    setDraft({ ...draft, tiers: { ...draft.tiers, [target]: follow ? null : { model: draft.lead.model, effort: draft.lead.effort } } })
    setMoved((notes) => ({ ...notes, [target]: undefined }))
  }

  return (
    <div className="flex min-h-0 flex-col">
      <header className="px-8 pt-7 pb-5">
        <Dialog.Title className="text-[24px] leading-tight font-semibold tracking-tight">Models for delegated work</Dialog.Title>
        <Dialog.Description className="mt-1.5 max-w-[60ch] text-[14px] text-muted-foreground">
          hobkin names a tier when it starts an agent, never a model. Each tier is a model and how hard it thinks.
        </Dialog.Description>
      </header>

      <div className="relative min-h-0 flex-1">
        <motion.div
          className="scroll-quiet grid max-h-full grid-cols-2 gap-3 overflow-y-auto px-8 pb-2 lg:grid-cols-5"
          initial="enter"
          animate="center"
          variants={{ enter: {}, center: { transition: { staggerChildren: stagger, delayChildren: 0.14 } } }}
          // While the model list covers the cards they take no focus.
          inert={picking !== null}
        >
          {TARGETS.map((target, index) => (
            <Rise key={target}>
              <TierCard
                target={target}
                depth={index}
                setting={settingOf(target)}
                model={modelOf(target)}
                movedFrom={moved[target]}
                autoFocus={target === (focus ?? 'lead')}
                onPickModel={() => setPicking(target)}
                onEffort={(effort) => chooseEffort(target, effort)}
                onFollowLead={(follow) => followLead(target, follow)}
              />
            </Rise>
          ))}
        </motion.div>

        <AnimatePresence>
          {picking ? (
            <ModelList
              key={picking}
              target={picking}
              models={models}
              current={settingOf(picking).model}
              onChoose={(model) => chooseModel(picking, model)}
              onBack={() => setPicking(null)}
            />
          ) : null}
        </AnimatePresence>
      </div>

      <footer className="flex items-center gap-3 px-8 pt-4 pb-6">
        {problem ? (
          <p role="alert" className="mr-auto max-w-[60ch] text-[12px] text-bad-fg">
            {problem}
          </p>
        ) : (
          <p className="mr-auto text-[12px] text-muted-foreground">hobkin's own model changes at once. Agents started after this use the tiers; running ones keep theirs.</p>
        )}
        <Dialog.Close render={<Button variant="ghost" />}>Cancel</Dialog.Close>
        <Button disabled={!changed || applying} onClick={() => void apply()}>
          {applying ? 'Applying' : 'Apply'}
          <Kbd className="bg-foreground/10 text-primary-foreground">⌘↵</Kbd>
        </Button>
      </footer>
    </div>
  )
}

interface TierCardProps {
  target: TierTarget
  /** 0 for hobkin, then 1 to 4 for the tiers. Drawn as the bars that fill up. */
  depth: number
  setting: { model: string; effort: Effort; followsLead: boolean }
  model: ModelChoice | undefined
  movedFrom: Effort | undefined
  autoFocus: boolean
  onPickModel: () => void
  onEffort: (effort: Effort) => void
  onFollowLead: (follow: boolean) => void
}

function TierCard({ target, depth, setting, model, movedFrom, autoFocus, onPickModel, onEffort, onFollowLead }: TierCardProps) {
  const lead = target === 'lead'
  const info = lead ? { label: 'hobkin', meantFor: 'The lead. It talks with you and delegates the rest.' } : TIER_INFO[target]
  const running = useRunningAgents()
  const inUse = lead ? 0 : running.filter((agent) => agent.tier === target).length
  const efforts = EFFORTS.filter((effort) => model?.efforts.includes(effort))
  const modelButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (autoFocus) modelButton.current?.focus()
  }, [autoFocus])

  return (
    <section
      aria-label={info.label}
      className={cn('flex h-full flex-col gap-3 rounded-3xl bg-surface p-4', setting.followsLead && 'bg-tone-1')}
    >
      <div className="flex h-9 items-end justify-between">
        <h3 className="text-[19px] leading-none font-semibold tracking-tight">{info.label}</h3>
        {lead ? <Hob mood="idle" size={36} stage="var(--hb-surface)" still /> : <DepthBars filled={depth} />}
      </div>
      <p className="min-h-[3.6em] text-[12px] leading-snug text-muted-foreground">{info.meantFor}</p>

      <button
        ref={modelButton}
        type="button"
        onClick={onPickModel}
        className={cn(
          'flex w-full items-center gap-2 rounded-2xl bg-background px-3 py-2.5 text-left outline-offset-0',
          'transition-[background-color,transform] duration-[160ms] ease-[ease] hover:bg-surface-2 active:scale-[0.98]',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="eyebrow block">{setting.followsLead ? 'Follows hobkin' : (model?.provider ?? 'Model')}</span>
          <span className={cn('block truncate text-[14px] font-medium', setting.followsLead && 'text-muted-foreground')}>
            {model?.name ?? setting.model}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <div role="radiogroup" aria-label={`Thinking for ${info.label}`} className="flex flex-wrap gap-1">
        {efforts.map((effort) => {
          const selected = effort === setting.effort
          return (
            <button
              key={effort}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onEffort(effort)}
              className={cn(
                'h-6 rounded-full px-2 text-[11px] font-medium outline-offset-0',
                'transition-[background-color,color,transform] duration-[160ms] ease-[ease] active:scale-[0.96]',
                selected
                  ? setting.followsLead
                    ? 'bg-surface-2 text-foreground'
                    : 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              {effort}
            </button>
          )
        })}
      </div>

      {movedFrom ? (
        <p className="text-[11px] leading-snug text-warn-fg">
          Thinking moved from {movedFrom} to {setting.effort}. This model has no {movedFrom}.
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
        <span className="whitespace-nowrap">{lead ? 'Unset tiers follow it' : inUse === 0 ? 'Not in use' : `${inUse} running`}</span>
        {lead ? null : (
          <button
            type="button"
            onClick={() => onFollowLead(!setting.followsLead)}
            className="rounded-full px-2 py-0.5 font-medium whitespace-nowrap text-foreground outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2"
          >
            {setting.followsLead ? 'Set its own' : 'Follow hobkin'}
          </button>
        )}
      </div>
    </section>
  )
}

/** Four bars that fill from the left: one for fast, four for max. */
function DepthBars({ filled }: { filled: number }) {
  return (
    <span aria-hidden="true" className="flex items-end gap-[3px]">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn('w-[5px] rounded-full', bar <= filled ? 'bg-foreground' : 'bg-border')}
          style={{ height: 8 + bar * 6 }}
        />
      ))}
    </span>
  )
}

interface ModelListProps {
  target: TierTarget
  models: ModelChoice[]
  current: string
  onChoose: (model: ModelChoice) => void
  onBack: () => void
}

/** The model list for one card. It slides up over the cards, inside the lightbox. */
function ModelList({ target, models, current, onChoose, onBack }: ModelListProps) {
  const [search, setSearch] = useState('')
  const found = useMemo(() => filterModels(models, search), [models, search])
  const [active, setActive] = useState(() => Math.max(0, models.findIndex((model) => model.id === current)))
  const at = Math.min(active, Math.max(0, found.length - 1))
  const label = target === 'lead' ? 'hobkin' : TIER_INFO[target].label
  const providers = [...new Set(found.map((model) => model.provider))]
  const list = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [at])

  return (
    <motion.div
      className="absolute inset-0 z-10 flex flex-col bg-background"
      initial={{ transform: 'translateY(100%)' }}
      animate={{ transform: 'translateY(0%)', transition: spring.sheet }}
      exit={{ transform: 'translateY(100%)', transition: { ...spring.sheet, duration: 0.3 } }}
    >
      <div className="flex items-center gap-3 px-8 pb-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to the tiers"
          className="grid size-8 shrink-0 place-items-center rounded-full outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </button>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border-[1.5px] border-input bg-surface px-4 transition-colors duration-[160ms] ease-[ease] focus-within:border-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') setActive(Math.min(found.length - 1, at + 1))
              else if (event.key === 'ArrowUp') setActive(Math.max(0, at - 1))
              else if (event.key === 'Enter' && found[at]) onChoose(found[at])
              else return
              event.preventDefault()
            }}
            placeholder={`Model for ${label}`}
            aria-label={`Search models for ${label}`}
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>

      <div ref={list} role="listbox" aria-label={`Models for ${label}`} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-8 pb-4">
        {found.length === 0 ? <p className="px-3 py-6 text-[14px] text-muted-foreground">No model matches that.</p> : null}
        {providers.map((provider) => (
          <div key={provider}>
            <div className="eyebrow px-3 pt-3 pb-1">{provider}</div>
            {found
              .filter((model) => model.provider === provider)
              .map((model) => {
                const index = found.indexOf(model)
                return (
                  <div
                    key={model.id}
                    role="option"
                    aria-selected={model.id === current}
                    data-active={index === at}
                    onClick={() => onChoose(model)}
                    onPointerMove={() => setActive(index)}
                    className={cn(
                      'flex cursor-default items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors duration-[120ms] ease-[ease]',
                      index === at && 'bg-surface-2',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{model.name}</span>
                      <span className="block truncate text-[12px] text-muted-foreground">
                        {model.efforts.length ? `Thinks at ${model.efforts.join(', ')}` : 'Answers without thinking'}
                      </span>
                    </span>
                    {model.id === current ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                  </div>
                )
              })}
          </div>
        ))}
      </div>
    </motion.div>
  )
}
