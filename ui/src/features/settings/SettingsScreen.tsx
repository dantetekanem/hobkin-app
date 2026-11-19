import { Minus, Plus, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type ReactNode } from 'react'
import { TIER_IDS, TIER_INFO, resolveTier } from '#shared/tiers/tiers.ts'
import { TILE_KEYS } from '@/app/key-list.ts'
import { Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER_UNDER_SECOND_ROW } from '@/app/screen-layout.ts'
import { originOf, setThemeChoice, useTheme, useThemeChoice, type ThemeChoice } from '@/app/theme.ts'
import { useStops } from '@/app/stops.ts'
import { useView } from '@/app/view-store.ts'
import { Hob } from '@/avatar/Hob.tsx'
import { AgentHood } from '@/components/Mark.tsx'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { useModelChoices } from '@/features/tiers/models.ts'
import { useTiers } from '@/features/tiers/store.ts'
import { BackupTile } from './BackupTile.tsx'
import { KeptThemesList } from './KeptThemesList.tsx'
import { PetTile } from './PetTile.tsx'
import { ReviewTile } from './ReviewTile.tsx'
import { ClaudeCodeTile } from './ClaudeCodeTile.tsx'
import { SubscriptionsTile } from './SubscriptionsTile.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { AboutLine } from './AboutLine.tsx'
import { NotificationsLine } from '@/features/notifications/NotificationsLine.tsx'
import { NerdStats } from './NerdStats.tsx'
import { UpdateModels } from './UpdateModels.tsx'
import { SetupAgainTile } from './SetupAgainTile.tsx'
import { useChat } from '@/features/chat/chat-store.ts'
import { hostStore } from '@/lib/host/client.ts'
import { runWork, useWorkUi, useWorkView } from '@/features/work/store.ts'
import { play } from '@/features/sound/index.ts'
import { AGENTS, BUDGET, OPACITY, OPEN_BY_DEFAULT, activeThemeLabel, budgetUse, formatTokens, stepBudget, type ActiveTheme, type BlockKind } from './rules.ts'
import { useSettings, type Movement, type TypeFace } from './store.ts'

/**
 * Settings, as hobkin's desk: each setting is a small living scene, and the scene is the control.
 * This file is the entry the frame mounts. Spec: 020-settings.
 */
export function SettingsScreen() {
  const closeSettings = useView((view) => view.closeSettings)
  const root = useRef<HTMLDivElement | null>(null)
  useStops(root)

  return (
    <div
      ref={root}
      className={`${SCREEN_SCROLLER_UNDER_SECOND_ROW} pb-6`}
    >
      <div className={`grid grid-cols-6 gap-3 @max-[820px]:grid-cols-2 ${SCREEN_COLUMN}`}>
        <DayAndNight />
        <AgentsAtOnce />
        <Models />
        <ReviewTile />
        <IntegrationsTile />
        <SubscriptionsTile />
        <ClaudeCodeTile />
        <TypeTile />
        <OpacityTile />
        <DailyBudget />
        <PetTile />
        <MovementTile />
        <SoundTile />
        <OpenBlocksTile />
        <WhatLeaves />
        <Keys />
        <BackupTile />
        <SetupAgainTile />
      </div>
      <NotificationsLine className="mx-auto mt-6 max-w-[60ch] text-center text-[13px] text-muted-foreground" />
      <AboutLine />
      <section aria-label="Nerd stats" className="absolute top-5 right-16 z-10">
        <NerdStats />
      </section>
      {/* Last in the walk, and in the corner for the mouse. Escape does the same from anywhere in Settings. */}
      <Button variant="ghost" size="icon" aria-label="Close settings" data-stop="" onClick={closeSettings} className="absolute top-5 right-5 z-10">
        <X />
      </Button>
    </div>
  )
}

export function Tile({ name, value, className, children }: { name: string; value: ReactNode; className?: string; children: ReactNode }) {
  return (
    <Rise className={className}>
      <section aria-label={name} className="flex h-full flex-col gap-3 rounded-3xl bg-background p-5">
        <header>
          <h2 className="eyebrow">{name}</h2>
          <p className="mt-1 font-heading text-[20px] leading-tight font-semibold tracking-[-0.022em]">{value}</p>
        </header>
        {children}
      </section>
    </Rise>
  )
}

/** A row of choices. Left and Right move between them, as in any radio group. */
export function Choice<Value extends string>({
  label,
  value,
  options,
  onChoose,
}: {
  label: string
  value: Value
  options: readonly { value: Value; label: string }[]
  onChoose: (value: Value, element: HTMLElement) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-fit rounded-full bg-tone-1 p-0.5"
      onKeyDown={(event) => {
        // Left and Right change the choice. Up and Down are left for walking between controls.
        const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
        if (!delta) return
        const next = options[(options.findIndex((option) => option.value === value) + delta + options.length) % options.length]!
        const button = event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.value}"]`)
        button?.focus()
        if (button) onChoose(next.value, button)
        event.preventDefault()
      }}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            // The chosen one is this group's stop in the walk.
            data-stop={selected ? '' : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={(event) => onChoose(option.value, event.currentTarget)}
            className={cn(
              'relative h-8 rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap outline-offset-0',
              'transition-colors duration-[160ms] ease-[ease]',
              selected ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selected ? <motion.span layoutId={`choice-${label}`} className="absolute inset-0 rounded-full bg-surface-2" transition={spring.pill} /> : null}
            <span className="relative">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const THEMES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Follow the Mac' },
  { value: 'custom', label: 'Custom' },
]

function DayAndNight() {
  const choice = useThemeChoice()
  const theme = useTheme()
  const themeName = useSettings((state) => state.themeName)
  const dark = theme === 'dark'
  const active: ActiveTheme = choice === 'custom' ? { kind: 'custom', name: themeName } : { kind: choice }

  return (
    <Tile
      name="Day and night"
      value={activeThemeLabel(active, theme)}
      className="col-span-4 row-span-2 @max-[820px]:col-span-2"
    >
      <div className="relative min-h-[150px] flex-1 overflow-hidden rounded-2xl bg-tone-2">
        <svg viewBox="0 0 560 220" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 size-full" aria-hidden="true">
          {/* The sun sets behind the hills and the moon rises, on the same arc. */}
          <motion.circle r="26" fill="var(--hb-sun)" initial={false} animate={{ cx: dark ? 520 : 400, cy: dark ? 250 : 64 }} transition={spring.screen} />
          <motion.g initial={false} animate={{ opacity: dark ? 1 : 0, y: dark ? 0 : 90 }} transition={spring.screen}>
            <path d="M178 40 a30 30 0 1 0 26 44 a24 24 0 0 1 -26 -44 Z" fill="var(--hb-text)" />
            {[
              [70, 52, 2.4],
              [118, 96, 1.8],
              [282, 34, 2.2],
              [344, 88, 1.6],
              [452, 46, 2],
              [506, 104, 1.6],
            ].map(([cx, cy, r]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="var(--hb-text)" opacity="0.7" />
            ))}
          </motion.g>
          <path d="M0 150 Q90 96 180 132 T360 120 T560 138 V220 H0 Z" fill="var(--hb-ridge-0)" />
          <path d="M0 172 Q120 122 230 158 T430 146 T560 164 V220 H0 Z" fill="var(--hb-ridge-1)" />
          <path d="M0 190 Q100 158 210 182 T420 176 T560 190 V220 H0 Z" fill="var(--hb-ridge-2)" />
          <path d="M0 206 Q140 184 280 202 T560 204 V220 H0 Z" fill="var(--hb-ridge-3)" />
        </svg>
        <div className="absolute right-6 bottom-1">
          <Hob mood={dark ? 'sleepy' : 'idle'} size={84} stage="var(--hb-ridge-3)" />
        </div>
      </div>
      <Choice label="Theme" value={choice} options={THEMES} onChoose={(value, element) => setThemeChoice(value, originOf(element))} />
      {choice === 'custom' ? <CustomColors /> : null}
    </Tile>
  )
}

/**
 * The themes hobkin made, to put one back on, and a request for a new one. The request goes to main hobkin as a chat
 * message the user sent. The composer's draft stays as it is.
 */
function CustomColors() {
  const sending = useSettings((state) => state.themeSending)
  const note = useSettings((state) => state.themeNote)
  const [text, setText] = useState('')

  const send = async () => {
    const asked = text
    const sent = await useSettings.getState().ask(asked, useChat, hostStore)

    // Once hobkin has it the field empties, unless something new was typed meanwhile.
    if (sent) setText((current) => (current === asked ? '' : current))
  }

  return (
    <div className="flex flex-col gap-4">
      <KeptThemesList />
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <label htmlFor="custom-theme-request" className="text-[12px] font-medium">Ask hobkin for a new theme</label>
        <div className="flex gap-2">
          <input
            id="custom-theme-request"
            aria-describedby="custom-theme-status"
            data-stop=""
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            placeholder="A quiet forest at night"
            className="min-w-0 flex-1 rounded-xl border border-border-strong bg-tone-1 px-3 py-2 text-[13px]"
          />
          <Button type="submit" disabled={sending || !text.trim()}>{sending ? 'Sending…' : 'Send'}</Button>
        </div>
        <p id="custom-theme-status" role="status" className="text-[12px] text-muted-foreground">
          {note ?? 'Describe the theme. hobkin will choose readable colors.'}
        </p>
      </form>
    </div>
  )
}

/** How much of the backgrounds and cards shows. The app is the preview: this tile fades with it, and its text does not. */
function OpacityTile() {
  const opacity = useSettings((state) => state.backgroundOpacity)
  const setOpacity = useSettings((state) => state.setBackgroundOpacity)
  const changeOpacity = useSettings((state) => state.changeBackgroundOpacity)
  const track = useRef<HTMLDivElement | null>(null)
  const words = opacity >= OPACITY.max ? 'Solid' : `${Math.round(opacity * 100)}%`
  const share = (opacity - OPACITY.min) / (OPACITY.max - OPACITY.min)

  const setFromPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()
    if (box) setOpacity(OPACITY.min + ((clientX - box.left) / box.width) * (OPACITY.max - OPACITY.min))
  }

  return (
    <Tile name="Background opacity" value={words} className="col-span-6 @max-[820px]:col-span-2">
      <div className="flex flex-1 items-center gap-5">
        {/* Hills behind a card: the card lets them through, and its lines of text stay solid. */}
        <div aria-hidden="true" className="relative h-[84px] w-[200px] shrink-0 overflow-hidden rounded-2xl">
          <svg viewBox="0 0 200 84" preserveAspectRatio="none" className="absolute inset-0 size-full">
            <path d="M0 34 Q50 12 100 30 T200 26 V84 H0 Z" fill="var(--hb-ridge-1)" />
            <path d="M0 58 Q60 38 120 54 T200 52 V84 H0 Z" fill="var(--hb-ridge-3)" />
          </svg>
          <div className="absolute inset-x-5 inset-y-3.5 flex flex-col justify-center gap-1.5 rounded-xl bg-surface px-3">
            <span className="h-1.5 w-3/4 rounded-full bg-foreground" />
            <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div
            ref={track}
            role="slider"
            aria-label="Background opacity"
            aria-valuemin={OPACITY.min}
            aria-valuemax={OPACITY.max}
            aria-valuenow={opacity}
            aria-valuetext={words}
            tabIndex={0}
            data-stop=""
            className="relative h-9 cursor-ew-resize touch-none rounded-full bg-tone-1 outline-offset-2"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setFromPointer(event.clientX)
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) setFromPointer(event.clientX)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') changeOpacity(1)
              else if (event.key === 'ArrowLeft') changeOpacity(-1)
              else return
              event.preventDefault()
            }}
          >
            <div className="absolute inset-0 overflow-hidden rounded-full">
              <motion.div
                className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-primary"
                initial={false}
                animate={{ transform: `scaleX(${0.06 + share * 0.94})` }}
                transition={spring.follow}
              />
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">Backgrounds and cards fade to this. Text, icons and the focus ring stay solid.</p>
        </div>
      </div>
    </Tile>
  )
}

const HUES = [262, 200, 86, 20, 320, 150, 40, 290]

function AgentsAtOnce() {
  const agents = useSettings((state) => state.agents)
  const changeAgents = useSettings((state) => state.changeAgents)

  return (
    <Tile name="Agents at once" value={agents === 1 ? '1 agent' : `${agents} agents`} className="col-span-2">
      <div className="flex min-h-[44px] flex-1 flex-wrap items-end gap-1">
        <AnimatePresence initial={false} mode="popLayout">
          {HUES.slice(0, agents).map((hue) => (
            <motion.span
              key={hue}
              layout
              initial={{ opacity: 0, transform: 'translateY(18px) scale(0.5)' }}
              animate={{ opacity: 1, transform: 'translateY(0px) scale(1)', transition: spring.alive }}
              exit={{ opacity: 0, transform: 'translateY(14px) scale(0.6)', transition: { duration: 0.16 } }}
            >
              <AgentHood hue={hue} size={30} working />
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
      <div
        role="spinbutton"
        aria-label="Agents at once"
        aria-valuemin={AGENTS.min}
        aria-valuemax={AGENTS.max}
        aria-valuenow={agents}
        tabIndex={0}
        data-stop=""
        className="flex w-fit items-center gap-1 rounded-full bg-tone-1 p-0.5 outline-offset-2"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === '+' || event.key === '=') changeAgents(1)
          else if (event.key === 'ArrowLeft' || event.key === '-') changeAgents(-1)
          else return
          event.preventDefault()
        }}
      >
        <StepButton label="One fewer" disabled={agents <= AGENTS.min} onClick={() => changeAgents(-1)}>
          <Minus className="size-4" aria-hidden="true" />
        </StepButton>
        <span className="w-6 text-center text-[14px] font-semibold tabular-nums">{agents}</span>
        <StepButton label="One more" disabled={agents >= AGENTS.max} onClick={() => changeAgents(1)}>
          <Plus className="size-4" aria-hidden="true" />
        </StepButton>
      </div>
    </Tile>
  )
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      // The group takes the keyboard and the arrows. These are for the mouse.
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full transition-[background-color,transform,opacity] duration-[140ms] ease-out hover:bg-surface-2 active:scale-[0.94] disabled:opacity-35"
    >
      {children}
    </button>
  )
}

function Models() {
  const config = useTiers((state) => state.config)
  const models = useModelChoices()
  const openTiers = useTiers((state) => state.openTiers)
  const nameOf = (id: string) => models.find((model) => model.id === id)?.name ?? id
  const rows = [
    { label: 'hobkin', depth: 0, ...config.lead, followsLead: false },
    ...TIER_IDS.map((tier, index) => ({ label: TIER_INFO[tier].label, depth: index + 1, ...resolveTier(config, tier) })),
  ]

  return (
    <Tile name="Models" value="The lead and four tiers" className="col-span-2">
      <ul className="flex flex-1 flex-col gap-1.5 text-[12px]">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2">
            <span className="w-11 shrink-0 font-semibold">{row.label}</span>
            <span className={cn('min-w-0 flex-1 truncate', row.followsLead && 'text-muted-foreground')}>{row.followsLead ? 'follows hobkin' : nameOf(row.model)}</span>
            <span className="shrink-0 text-muted-foreground">{row.effort}</span>
          </li>
        ))}
      </ul>
      <Button variant="outline" className="w-fit" data-stop="" onClick={() => openTiers()}>
        Change models
      </Button>
      <UpdateModels />
    </Tile>
  )
}

/**
 * Work mode's day, from hobkin's own status: the limit it keeps, what it has spent, and the stop when the day is used up.
 * Moving the bar saves the limit where work mode reads it, as `hobkin work tokens` does.
 */
function DailyBudget() {
  const { work, live } = useWorkView()
  const localTokens = useSettings((state) => state.dailyTokens)
  const setLocalTokens = useSettings((state) => state.setDailyTokens)
  const [draft, setDraft] = useState<number | null>(null)
  const track = useRef<HTMLDivElement | null>(null)
  const said = useWorkUi((state) => state.said['tokens'])
  const dailyTokens = draft ?? work?.dailyTokens ?? localTokens
  const use = budgetUse(work?.tokensToday ?? null, dailyTokens)
  const onScale = (tokens: number) => `${Math.min(100, Math.max(0, (tokens / BUDGET.max) * 100))}%`

  const save = (tokens: number) => {
    setLocalTokens(tokens)
    if (!work) return setDraft(null)
    void runWork({ do: 'tokens', tokens }, { live, place: 'tokens' }).finally(() => setDraft(null))
  }
  const fromPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect()
    return box ? stepBudget(((clientX - box.left) / box.width) * BUDGET.max, 0) : null
  }

  return (
    <Tile name="Daily budget" value={`${formatTokens(dailyTokens)} tokens a day`} className="col-span-6 @max-[820px]:col-span-2">
      <div
        ref={track}
        role="slider"
        aria-label="Daily budget in tokens"
        aria-valuemin={BUDGET.min}
        aria-valuemax={BUDGET.max}
        aria-valuenow={dailyTokens}
        aria-valuetext={`${formatTokens(dailyTokens)} tokens a day`}
        tabIndex={0}
        data-stop=""
        className="relative mt-auto h-9 cursor-ew-resize touch-none rounded-full bg-tone-1 outline-offset-2"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDraft(fromPointer(event.clientX))
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) setDraft(fromPointer(event.clientX))
        }}
        onPointerUp={(event) => {
          const tokens = fromPointer(event.clientX)
          if (tokens !== null) save(tokens)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') save(stepBudget(dailyTokens, 1))
          else if (event.key === 'ArrowLeft') save(stepBudget(dailyTokens, -1))
          else return
          event.preventDefault()
        }}
      >
        <div className="absolute inset-0 overflow-hidden rounded-full">
          {/* The budget, and over it what the day has used on the same scale: where they meet, the day is used up. */}
          <motion.div
            className="absolute inset-y-0 left-0 w-full origin-left rounded-full bg-primary"
            initial={false}
            animate={{ transform: `scaleX(${Math.min(1, dailyTokens / BUDGET.max)})` }}
            transition={spring.follow}
          />
          {use && (
            <div
              className={cn('absolute inset-y-0 left-0 rounded-full', use.reached ? 'bg-destructive/60' : 'bg-foreground/25')}
              style={{ width: onScale(Math.min(work?.tokensToday ?? 0, dailyTokens)) }}
            />
          )}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">{use ? use.line : 'Usage unavailable: hobkin has not reported today yet.'}</p>
      {said?.tone === 'refused' ? <p className="text-[12px] text-destructive">{said.text}</p> : null}
    </Tile>
  )
}

/** The way into Integrations. The services themselves live on their own screen (023-integrations). */
function IntegrationsTile() {
  const toggleIntegrations = useView((view) => view.toggleIntegrations)
  // Pi's skills and extensions have pages of their own beside it, under Settings (039-skills-and-extensions).
  const togglePage = useView((view) => view.togglePage)

  return (
    <Tile name="Integrations" value="What hobkin can reach" className="col-span-6 @max-[820px]:col-span-2">
      <div className="flex flex-1 items-center justify-between gap-4 @max-[820px]:flex-col @max-[820px]:items-start">
        <p className="max-w-[60ch] text-[13px] text-muted-foreground">
          GitHub, plus Linear, Sentry, Home Assistant and more, and any MCP server of your own. Routines and agents use them through Pi.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" className="shrink-0" data-stop="" data-opens="integrations" onClick={toggleIntegrations}>
            Open integrations
            <Kbd>⌘I</Kbd>
          </Button>
          <Button variant="outline" className="shrink-0" data-stop="" data-opens="skills" onClick={() => togglePage('skills')}>
            Skills
          </Button>
          <Button variant="outline" className="shrink-0" data-stop="" data-opens="extensions" onClick={() => togglePage('extensions')}>
            Pi extensions
          </Button>
        </div>
      </div>
    </Tile>
  )
}

const FACES: readonly { value: TypeFace; label: string }[] = [
  { value: 'space-grotesk', label: 'Space Grotesk' },
  { value: 'inter', label: 'Inter' },
  { value: 'geist', label: 'Geist' },
  { value: 'dm-sans', label: 'DM Sans' },
  { value: 'figtree', label: 'Figtree' },
]

/** The face for reading text. The whole app changes as the choice does, so the app itself is the preview. */
function TypeTile() {
  const typeFace = useSettings((state) => state.typeFace)
  const setTypeFace = useSettings((state) => state.setTypeFace)

  return (
    <Tile name="Type" value={FACES.find((face) => face.value === typeFace)!.label} className="col-span-6 @max-[820px]:col-span-2">
      <div className="flex flex-1 flex-col gap-1">
        <p className="text-[15px] leading-relaxed">
          Two things finished overnight. The login redirect fix is on its branch with 14 passing tests, ready for you to review.
        </p>
        <p className="text-[12px] text-muted-foreground">Yesterday · 42 messages · storefront · 4 queued, 2 waiting on you</p>
      </div>
      <p className="text-[12px] text-muted-foreground">This is the face for reading. Headings, the menu and the wordmark stay in Space Grotesk.</p>
      <Choice label="Text face" value={typeFace} options={FACES} onChoose={(value) => setTypeFace(value)} />
    </Tile>
  )
}

const MOVEMENTS: readonly { value: Movement; label: string }[] = [
  { value: 'lively', label: 'Lively' },
  { value: 'system', label: 'Follow the Mac' },
  { value: 'still', label: 'Still' },
]

const MOVEMENT_SAYS: Record<Movement, string> = {
  lively: 'Everything moves, even when the Mac asks for less.',
  system: 'Moves unless the Mac asks for less.',
  still: 'Screens fade, and nothing travels.',
}

function MovementTile() {
  const movement = useSettings((state) => state.movement)
  const setMovement = useSettings((state) => state.setMovement)

  return (
    <Tile name="Movement" value={MOVEMENTS.find((option) => option.value === movement)!.label} className="col-span-3 @max-[820px]:col-span-2">
      <div className="flex flex-1 items-end justify-between gap-3">
        <p className="max-w-[26ch] text-[12px] text-muted-foreground">{MOVEMENT_SAYS[movement]}</p>
        <Hob mood={movement === 'lively' ? 'happy' : 'idle'} size={72} still={movement === 'still'} />
      </div>
      <Choice label="Movement" value={movement} options={MOVEMENTS} onChoose={(value) => setMovement(value)} />
    </Tile>
  )
}

const SOUND_CHOICES: readonly { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

/** hobkin's little sounds (features/sound). Choosing On plays one, so the user hears what they chose. */
function SoundTile() {
  const sound = useSettings((state) => state.sound)
  const setSound = useSettings((state) => state.setSound)
  const choose = (value: 'on' | 'off') => {
    setSound(value === 'on')
    if (value === 'on') play('cheer')
  }

  return (
    <Tile name="Sound" value={sound ? 'On' : 'Off'} className="col-span-3 @max-[820px]:col-span-2">
      <div className="flex flex-1 items-end justify-between gap-3">
        <p className="max-w-[26ch] text-[12px] text-muted-foreground">{sound ? 'Soft sounds as hobkin talks and hops, and a chime for notifications.' : 'hobkin makes no sound.'}</p>
        <Hob mood={sound ? 'listening' : 'idle'} size={72} />
      </div>
      <Choice label="Sound" value={sound ? 'on' : 'off'} options={SOUND_CHOICES} onChoose={choose} />
    </Tile>
  )
}

const BLOCK_KINDS: readonly { value: BlockKind; label: string; says: string }[] = [
  { value: 'change', label: 'Code changes', says: 'The diff of each file an agent changes.' },
  { value: 'shell', label: 'Commands', says: 'What each command printed.' },
  { value: 'looks', label: 'Reads and searches', says: 'What a read gave back, and the list of what was looked for.' },
  { value: 'other', label: 'Other tools', says: 'What any other tool gave back.' },
]

/** The kinds that arrive open, in a few words: "Code changes", "Code changes and commands", "Every kind". */
function kindsOpen(on: readonly { label: string }[]): string {
  if (on.length === 0) return 'Headers only'
  if (on.length === BLOCK_KINDS.length) return 'Every kind'
  if (on.length === 1) return on[0]!.label
  if (on.length === 2) return `${on[0]!.label} and ${on[1]!.label.toLowerCase()}`
  return `${on.length} kinds`
}

/** Which kinds of an agent's blocks arrive open. Blocks not opened or closed by hand follow a change at once (blocks.ts). */
function OpenBlocksTile() {
  const openByDefault = useSettings((state) => state.openByDefault) ?? OPEN_BY_DEFAULT
  const setOpenByDefault = useSettings((state) => state.setOpenByDefault)
  const on = BLOCK_KINDS.filter((kind) => openByDefault[kind.value])

  return (
    <Tile name="Open by default" value={kindsOpen(on)} className="col-span-6 @max-[820px]:col-span-2">
      <div className="grid flex-1 grid-cols-2 items-start gap-x-8 gap-y-3 @max-[820px]:grid-cols-1">
        {BLOCK_KINDS.map((kind) => (
          <SwitchRow key={kind.value} label={kind.label} says={kind.says} checked={openByDefault[kind.value]} onChange={(open) => setOpenByDefault(kind.value, open)} />
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        The rest show their one-line header. A block opened or closed by hand stays that way, and <Kbd>⌃O</Kbd> opens or closes every one.
      </p>
    </Tile>
  )
}

function WhatLeaves() {
  const usageEvents = useSettings((state) => state.usageEvents)
  const feedback = useSettings((state) => state.feedback)
  const setUsageEvents = useSettings((state) => state.setUsageEvents)
  const setFeedback = useSettings((state) => state.setFeedback)
  const count = Number(usageEvents) + Number(feedback)

  return (
    <Tile name="What leaves this Mac" value={count === 0 ? 'Nothing' : count === 1 ? 'One thing' : 'Two things'} className="col-span-6 @max-[820px]:col-span-2">
      <div className="grid flex-1 grid-cols-2 items-start gap-x-8 gap-y-3 @max-[820px]:grid-cols-1">
        <SwitchRow
          label="Usage events"
          checked={usageEvents}
          onChange={setUsageEvents}
          says="Which parts of hobkin were used and how runs ended, as counts and fixed words. Never a message, a report, a name or a path."
        />
        <SwitchRow
          label="Feedback"
          checked={feedback}
          onChange={setFeedback}
          says="Sending feedback from the app is not built yet. Nothing is sent until it is, and then only after you read exactly what goes."
        />
      </div>
      <p className="text-[12px] text-muted-foreground">Your model provider and the tools you connect also see what agents work on.</p>
    </Tile>
  )
}

function SwitchRow({ label, says, checked, onChange }: { label: string; says: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-3">
      <Switch checked={checked} onCheckedChange={(next) => onChange(next)} data-stop="" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{label}</span>
        <span className="block text-[12px] leading-snug text-muted-foreground">{says}</span>
      </span>
    </label>
  )
}

function Keys() {
  return (
    <Tile name="Keys" value="Everything from the keyboard" className="col-span-6 @max-[820px]:col-span-2">
      <ul className="grid flex-1 grid-cols-2 content-start gap-x-8 gap-y-1.5 text-[12px] @max-[820px]:grid-cols-1">
        {TILE_KEYS.map(({ keys, does }) => (
          <li key={keys} className="flex items-center gap-2">
            <Kbd className="shrink-0">{keys}</Kbd>
            <span className="text-muted-foreground">{does}</span>
          </li>
        ))}
      </ul>
    </Tile>
  )
}
