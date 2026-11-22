import { Dialog } from '@base-ui/react/dialog'
import { ArrowLeft, Check, ChevronRight, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { focusInput } from '@/app/keys.ts'
import {
  EFFORTS,
  REVIEW_ROLES,
  REVIEW_ROLE_INFO,
  TIER_IDS,
  TIER_INFO,
  filterModels,
  type Effort,
  type ModelChoice,
  type ReviewRole,
  type ReviewTiers,
  type TierId,
  type TiersConfig,
} from '#shared/tiers/tiers.ts'
import {
  CLAUDE_CODE,
  changeClaudeTiers,
  chooseLevel,
  chooseModel as chooseInDraft,
  claudeChoices,
  claudeGroup,
  claudeTiersChange,
  claudeTiersOf,
  followAgain,
  shownClaude,
  type ClaudeTiers,
  type ClaudeTiersChange,
} from '#shared/tiers/claude-code.ts'
import { Rise } from '@/app/Reveal.tsx'
import { useRunningAgents } from '@/app/running-agents.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { Button } from '@/components/ui/button.tsx'
import { applyClaudeTiers, useReadClaudeCode } from '@/features/settings/claude-code-store.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { spring, stagger } from '@/lib/motion.ts'
import { applyTiers as applyHostTiers, readTiers } from '@/lib/host/client.ts'
import { isLive, selectMainModel, useHasHost, useHost } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { followsWords, modelName, ownSetting, shownTier, tiersChange, type Follows, type ShownTier } from './host-tiers.ts'
import { scrollToShow } from './list-scroll.ts'
import { useModelChoices } from './models.ts'
import { useTiers, type TierTarget } from './store.ts'

const TARGETS: TierTarget[] = ['lead', ...TIER_IDS]

/**
 * The lightbox where the user picks a model and a thinking level for hobkin and for each of the four tiers, and the
 * tier each of a change review's two roles uses. Changes are a draft until Apply. Spec: 017-model-tiers.
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

  useHostTiers()

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
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[min(1080px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-clip rounded-[28px] bg-background shadow-float outline-none',
            // Clipped, never scrolled: overflow hidden still scrolls from script and on focus, which moved the whole lightbox.
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

/**
 * Reads hobkin's tiers each time the connection opens, and again once hobkin is running in it, so the window and the
 * Models tile show hobkin's and not the ones this window kept. The lightbox lives as long as the window, so this does too.
 */
function useHostTiers() {
  const hasHost = useHasHost()
  const link = useHost((state) => state.link)
  const live = useHost(isLive)
  const source = useHost((state) => `${state.home}\n${state.epoch}`)

  useEffect(() => {
    if (!hasHost || link !== 'open') return
    let current = true
    readTiers().then(
      (host) => {
        if (current) useTiers.getState().receiveHostTiers(host)
      },
      // A host from before tiers.read leaves the window as it was. Apply then says what fixes it.
      () => {},
    )
    return () => {
      current = false
    }
  }, [hasHost, link, live, source])
}

function TiersForm({ picking, setPicking }: { picking: TierTarget | null; setPicking: (target: TierTarget | null) => void }) {
  const saved = useTiers((state) => state.config)
  const savedReview = useTiers((state) => state.review)
  const follows = useTiers((state) => state.follows)
  const checks = useTiers((state) => state.checks)
  // The models Pi can use now, once the host has answered.
  const models = useModelChoices()
  // Every model a card can name: Pi's, and Claude Code's for a tier on it (033-claude-code-agents).
  const choices = useMemo(() => [...models, ...claudeChoices()], [models])
  // Which tiers run on Claude Code, as the host keeps them. A host from before reports none and is offered none.
  const claudeCode = useReadClaudeCode()
  const savedClaude = useMemo(() => claudeTiersOf(claudeCode?.settings) ?? {}, [claudeCode])
  const focus = useTiers((state) => state.focus)
  const applyTiers = useTiers((state) => state.applyTiers)
  const [draft, setDraft] = useState<TiersConfig>(saved)
  const [review, setReview] = useState<ReviewTiers>(savedReview)
  // The user's changes over what the host keeps, so an answer that comes after a change never takes back a tier the user left alone.
  const [claudeEdits, setClaudeEdits] = useState<ClaudeTiersChange>({})
  const claude = useMemo(() => changeClaudeTiers(savedClaude, claudeEdits), [savedClaude, claudeEdits])
  const setClaude = (next: ClaudeTiers) => setClaudeEdits((edits) => ({ ...edits, ...claudeTiersChange(claude, next) }))
  const [touched, setTouched] = useState(false)
  const [moved, setMoved] = useState<Partial<Record<TierTarget, Effort>>>({})
  const claudeChange = claudeTiersChange(savedClaude, claude)
  const changed = JSON.stringify(draft) !== JSON.stringify(saved) || REVIEW_ROLES.some((role) => review[role] !== savedReview[role]) || claudeChange !== null
  const hasHost = useHasHost()
  const [applying, setApplying] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // hobkin's tiers can arrive while the window is open, as when it opens just as the connection does. Until the user
  // changes something it shows them, so Apply never sends back values hobkin no longer holds.
  useEffect(() => {
    if (touched) return
    setDraft(saved)
    setReview(savedReview)
  }, [saved, savedReview, touched])

  // The lead is hobkin's own main model: the host saves it in hobkin's config and the open conversation goes on with
  // it at once. The tiers and review roles that changed go to hobkin in one write, and the tiers put on Claude Code or
  // taken off it go to the host's Claude Code settings. When the host refuses any, its reason shows here and the window
  // stays open on the draft.
  const apply = async () => {
    if (applying) return
    setProblem(null)
    if (!hasHost) return applyTiers(draft, review)
    const leadChanged = draft.lead.model !== saved.lead.model || draft.lead.effort !== saved.lead.effort
    const change = tiersChange({ config: saved, review: savedReview }, { config: draft, review })
    const store = useTiers.getState()
    setApplying(true)
    try {
      if (leadChanged) {
        await selectMainModel(draft.lead.model, draft.lead.effort)
        // The lead is hobkin's now, even if the tiers are refused next, so a second Apply does not send it again.
        store.receiveTiers({ config: { ...saved, lead: draft.lead }, review: savedReview, follows, checks })
      }
      if (change) store.receiveHostTiers(await applyHostTiers(change))
      if (claudeChange) await applyClaudeTiers(claudeChange)
      store.closeTiers()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setApplying(false)
    }
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

  const view = { config: draft, follows, checks }
  const settingOf = (target: TierTarget): ShownTier =>
    target === 'lead' ? { ...draft.lead, follows: null } : (shownClaude(claude, target) ?? shownTier(view, target))
  const modelOf = (target: TierTarget) => choices.find((model) => model.id === settingOf(target).model)
  // The list's Claude Code group for the card it is open on: its models, a line that says why there are none, or nothing.
  const group = picking ? claudeGroup(picking, claudeCode) : null

  const edit = (next: TiersConfig, target: TierTarget, movedFrom: Effort | null = null) => {
    setDraft(next)
    setTouched(true)
    setMoved((notes) => ({ ...notes, [target]: movedFrom ?? undefined }))
  }

  const chooseModel = (target: TierTarget, model: ModelChoice) => {
    // A tier starts from what it runs with now, so its thinking level carries over to the new model. A Claude model
    // keeps the tier's Pi model, and a Pi model takes the tier off Claude Code.
    const result = chooseInDraft({ config: draft, claude }, target, model, settingOf(target))
    setClaude(result.draft.claude)
    edit(result.draft.config, target, result.effortMovedFrom)
    setPicking(null)
  }

  const chooseEffort = (target: TierTarget, effort: Effort) => {
    const next = chooseLevel({ config: draft, claude }, target, effort, settingOf(target))
    if (next.config === draft && next.claude === claude) return
    setClaude(next.claude)
    edit(next.config, target)
  }

  const follow = (target: TierTarget, again: boolean) => {
    if (target === 'lead') return
    if (!again) return edit({ ...draft, tiers: { ...draft.tiers, [target]: ownSetting(settingOf(target), draft.lead) } }, target)
    const next = followAgain({ config: draft, claude }, target)
    setClaude(next.claude)
    edit(next.config, target)
  }

  const chooseRole = (role: ReviewRole, tier: TierId) => {
    setReview({ ...review, [role]: tier })
    setTouched(true)
  }

  return (
    <div className="flex min-h-0 flex-col">
      <header className="px-8 pt-7 pb-5">
        <Dialog.Title className="text-[24px] leading-tight font-semibold tracking-tight">Models for delegated work</Dialog.Title>
        <Dialog.Description className="mt-1.5 max-w-[60ch] text-[14px] text-muted-foreground">
          hobkin names a tier when it starts an agent, never a model. Each tier is a model and how hard it thinks.
        </Dialog.Description>
      </header>

      {/* The room between the title and the footer. The cards shrink into it and scroll there, never over the footer:
          a height in percent of this box does not resolve in WebKit, so they are a flex item instead. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <motion.div
          className="scroll-quiet grid min-h-0 grid-cols-2 gap-3 overflow-y-auto px-8 pb-2 lg:grid-cols-5"
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
                whom={target === 'lead' ? null : follows[target]}
                model={modelOf(target)}
                name={modelName(settingOf(target), choices)}
                movedFrom={moved[target]}
                autoFocus={target === (focus ?? 'lead')}
                onPickModel={() => setPicking(target)}
                onEffort={(effort) => chooseEffort(target, effort)}
                onFollow={(again) => follow(target, again)}
              />
            </Rise>
          ))}

          {REVIEW_ROLES.map((role) => {
            const runs = shownTier(view, review[role])
            return (
              <Rise key={role} className="col-span-2 lg:col-span-5">
                <ReviewRow role={role} tier={review[role]} name={modelName(runs, models)} effort={runs.effort} onChoose={(tier) => chooseRole(role, tier)} />
              </Rise>
            )
          })}
        </motion.div>

        <AnimatePresence>
          {picking ? (
            <ModelList
              key={picking}
              target={picking}
              models={group?.offered ? choices : models}
              note={group && !group.offered ? group.note : null}
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
          <p className="mr-auto text-[12px] text-muted-foreground">
            hobkin's own model changes at once. Agents and reviews started after this use the tiers; running ones keep theirs.
          </p>
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

/** A small round choice, as the thinking levels and the review roles' tiers are. `quiet` marks a tier that follows. */
function pillClass(selected: boolean, quiet = false) {
  return cn(
    'h-6 rounded-full px-2 text-[11px] font-medium outline-offset-0',
    'transition-[background-color,color,transform] duration-[160ms] ease-[ease] active:scale-[0.96]',
    selected ? (quiet ? 'bg-surface-2 text-foreground' : 'bg-primary text-primary-foreground') : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
  )
}

interface TierCardProps {
  target: TierTarget
  /** 0 for hobkin, then 1 to 4 for the tiers. Drawn as the bars that fill up. */
  depth: number
  setting: ShownTier
  /** Whose model the tier follows while it has none of its own. None for the lead. */
  whom: Follows | null
  model: ModelChoice | undefined
  name: string
  movedFrom: Effort | undefined
  autoFocus: boolean
  onPickModel: () => void
  onEffort: (effort: Effort) => void
  onFollow: (again: boolean) => void
}

function TierCard({ target, depth, setting, whom, model, name, movedFrom, autoFocus, onPickModel, onEffort, onFollow }: TierCardProps) {
  const lead = target === 'lead'
  const info = lead ? { label: 'hobkin', meantFor: 'The lead. It talks with you and delegates the rest.' } : TIER_INFO[target]
  const following = setting.follows !== null
  const words = whom ? followsWords(whom) : null
  const running = useRunningAgents()
  // A durable hobkin counts only while a turn of its runs on this tier: not while it waits, and not on Claude Code or a custom model.
  const onThisTier = (agent: (typeof running)[number]) => agent.tier === target && (!agent.durable || (agent.durable.state === 'working' && agent.durable.engine.kind === 'tier'))
  const inUse = lead ? 0 : running.filter(onThisTier).length
  const efforts = EFFORTS.filter((effort) => model?.efforts.includes(effort))
  const modelButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (autoFocus) modelButton.current?.focus()
  }, [autoFocus])

  return (
    <section aria-label={info.label} className={cn('flex h-full flex-col gap-3 rounded-3xl bg-surface p-4', following && 'bg-tone-1')}>
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
          <span className="eyebrow block">{following && words ? words.follows : (model?.provider ?? 'Model')}</span>
          <span className={cn('block truncate text-[14px] font-medium', following && 'text-muted-foreground')}>{name}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <div role="radiogroup" aria-label={`Thinking for ${info.label}`} className="flex flex-wrap gap-1">
        {efforts.map((effort) => {
          const selected = effort === setting.effort
          return (
            <button key={effort} type="button" role="radio" aria-checked={selected} onClick={() => onEffort(effort)} className={pillClass(selected, following)}>
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
        {words ? (
          <button
            type="button"
            onClick={() => onFollow(!following)}
            className="rounded-full px-2 py-0.5 font-medium whitespace-nowrap text-foreground outline-offset-0 transition-colors duration-[160ms] ease-[ease] hover:bg-surface-2"
          >
            {following ? 'Set its own' : words.follow}
          </button>
        ) : null}
      </div>
    </section>
  )
}

interface ReviewRowProps {
  role: ReviewRole
  tier: TierId
  /** The model the chosen tier runs with, and its thinking level when known. */
  name: string
  effort: Effort | null
  onChoose: (tier: TierId) => void
}

/** One of a change review's two roles, and the tier it uses. */
function ReviewRow({ role, tier, name, effort, onChoose }: ReviewRowProps) {
  const info = REVIEW_ROLE_INFO[role]
  return (
    <section aria-label={info.label} className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-3xl bg-surface px-4 py-3">
      <div className="min-w-[16rem] flex-1">
        <h3 className="text-[15px] leading-tight font-semibold tracking-tight">{info.label}</h3>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{info.meantFor}</p>
      </div>
      <TierChoice label={`Tier for ${info.label}`} value={tier} onChoose={onChoose} />
      <p className="w-52 truncate text-[12px]" title={effort ? `${name}, ${effort}` : name}>
        <span className="font-medium">{name}</span>
        {effort ? <span className="text-muted-foreground"> {effort}</span> : null}
      </p>
    </section>
  )
}

/** One of the four tiers. Left and Right move along them and stop at the ends; the chosen one is the group's stop for Tab. */
export function TierChoice({ label, value, onChoose }: { label: string; value: TierId; onChoose: (tier: TierId) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1"
      onKeyDown={(event) => {
        const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!delta || event.metaKey || event.ctrlKey || event.altKey) return
        event.preventDefault()
        const next = TIER_IDS[Math.min(TIER_IDS.length - 1, Math.max(0, TIER_IDS.indexOf(value) + delta))]!
        if (next === value) return
        event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus()
        onChoose(next)
      }}
    >
      {TIER_IDS.map((tier) => {
        const selected = tier === value
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={tier}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(tier)}
            className={pillClass(selected)}
          >
            {TIER_INFO[tier].label}
          </button>
        )
      })}
    </div>
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
  /** Pi's models, then Claude Code's when the card can run on it. */
  models: ModelChoice[]
  /** Why the Claude Code group offers nothing, in its place after Pi's providers. */
  note: string | null
  /** The model chosen now, when it is one Pi names. */
  current: string | null
  onChoose: (model: ModelChoice) => void
  onBack: () => void
}

/** The model list for one card. It slides up over the cards, inside the lightbox. */
function ModelList({ target, models, note, current, onChoose, onBack }: ModelListProps) {
  const [search, setSearch] = useState('')
  const found = useMemo(() => filterModels(models, search), [models, search])
  const [active, setActive] = useState(() => Math.max(0, models.findIndex((model) => model.id === current)))
  const at = Math.min(active, Math.max(0, found.length - 1))
  const label = target === 'lead' ? 'hobkin' : TIER_INFO[target].label
  const providers = [...new Set(found.map((model) => model.provider))]
  const list = useRef<HTMLDivElement | null>(null)

  // Only the list moves to show the active row, before the frame is drawn. scrollIntoView would also scroll the
  // lightbox, which can scroll from script, while the list still sits below its place as it slides up.
  useLayoutEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[data-active="true"]')
    if (!box || !row) return
    box.scrollTop = scrollToShow({ top: row.offsetTop, height: row.offsetHeight }, { top: box.scrollTop, height: box.clientHeight })
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

      <div ref={list} role="listbox" aria-label={`Models for ${label}`} className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto px-8 pb-4">
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
        {/* Last, like the group it stands for, so nothing above it moves when the host's answer brings it. */}
        {note && filterModels(claudeChoices(), search).length > 0 ? (
          <div>
            <div className="eyebrow px-3 pt-3 pb-1">{CLAUDE_CODE}</div>
            <p className="px-3 py-2.5 text-[12px] text-muted-foreground">{note}</p>
          </div>
        ) : null}
      </div>
    </motion.div>
  )
}
