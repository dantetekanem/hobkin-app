import { Check, Search } from 'lucide-react'
import { memo, useMemo, useRef, useState, type RefObject } from 'react'
import { claudeChoices } from '#shared/tiers/claude-code.ts'
import { TIER_IDS, TIER_INFO, filterModels, type Effort, type ModelChoice, type TierId } from '#shared/tiers/tiers.ts'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx'
import { sendChange, type ChangeTarget } from '@/features/chat/send-change.ts'
import { shownTier } from '@/features/tiers/host-tiers.ts'
import { useModelChoices } from '@/features/tiers/models.ts'
import { useTiers } from '@/features/tiers/store.ts'
import { runCommand, useHasHost, useListHost, type HostState } from '@/lib/host/index.ts'
import { cn } from '@/lib/utils.ts'
import { agentModelOf, agentTierOf, changeFor, changeForTier, changeTarget, effortsOf, modelWords, tierWords, type AgentModel } from './agent-model.ts'
import { useAgent, type RunningAgent } from './running-agents.ts'

/** The pill's one width, whatever tier or model it names, so nothing in the row moves when either changes. */
const PILL = 'w-[84px] shrink-0 truncate rounded-full border border-border px-1.5 text-center text-[10px] leading-4 font-medium text-muted-foreground'

const runIn = (state: HostState, runId: string | null) => (runId === null ? undefined : state.snapshot.runs?.find((run) => run.id === runId))

/** What an agent of the dock works on now, the tier that is when it runs on one, and what each tier runs with now. */
interface AgentRuns {
  current: AgentModel
  tier: TierId | null
  tiers: Record<TierId, AgentModel>
}

/** What an agent of the dock works on now: its run's model, its hobkin's engine, or what its tier runs with. */
function useAgentRuns(agent: RunningAgent): AgentRuns {
  const live = useHasHost()
  const runId = agent.durable ? agent.durable.run : agent.id
  const asks = live && runId !== null
  // Three plain strings, so a row draws again only when its own run's model, level or tier changes.
  const model = useListHost((state) => (asks ? runIn(state, runId)?.model : undefined))
  const effort = useListHost((state) => (asks ? runIn(state, runId)?.effort : undefined))
  const ranOn = useListHost((state) => (asks ? runIn(state, runId)?.tier : undefined))
  const config = useTiers((state) => state.config)
  const follows = useTiers((state) => state.follows)
  const checks = useTiers((state) => state.checks)
  const tiers = useMemo(() => {
    const now = {} as Record<TierId, AgentModel>
    for (const tier of TIER_IDS) now[tier] = shownTier({ config, follows, checks }, tier)
    return now
  }, [config, follows, checks])
  return useMemo(() => {
    const run = asks ? { model, effort, tier: ranOn } : undefined
    const current = agentModelOf(agent, run, (tier) => tiers[tier])
    return { current, tier: agentTierOf(agent, run, current, (tier) => tiers[tier]), tiers }
  }, [agent, asks, model, effort, ranOn, tiers])
}

/**
 * The tier at the end of an agent's row in the dock, or its model when it runs on none, with the whole model on hover.
 * Pressed, it opens a small choice of hobkin's tiers, the models Pi can use now and the levels of the one the agent
 * works on, and a choice goes to hobkin at once; hobkin's answer or refusal shows in the same place. An agent hobkin
 * cannot change (on Claude Code, or a run that waits for its time) shows its tier or model only.
 */
export const AgentModelPill = memo(function AgentModelPill({ agent }: { agent: RunningAgent }) {
  const runs = useAgentRuns(agent)
  const models = useModelChoices()
  const named = useMemo(() => [...models, ...claudeChoices()], [models])
  const words = runs.tier ? tierWords(runs.tier) : (modelWords(runs.current.model, named) ?? 'model')
  const full = runs.tier ? `${tierWords(runs.tier)}: ${fullName(runs.current)}` : fullName(runs.current)
  const offer = changeTarget(agent)
  if ('why' in offer) {
    return (
      <span className={PILL} title={`${full}. ${offer.why}`}>
        {words}
      </span>
    )
  }
  return <ModelChoicePopover agent={agent} target={offer.target} runs={runs} models={models} words={words} full={full} />
})

/** The pill's hover: the whole `provider/id`, and its level when known. */
function fullName({ model, effort }: AgentModel): string {
  if (!model) return 'The model is not reported'
  return effort ? `${model} at ${effort}` : model
}

interface ModelChoicePopoverProps {
  agent: RunningAgent
  target: ChangeTarget
  runs: AgentRuns
  models: readonly ModelChoice[]
  words: string
  full: string
}

/** What a choice sends for this agent, hobkin's answer to it, and whether one is on its way. */
function useModelChange(target: ChangeTarget, { current, tiers }: AgentRuns) {
  const live = useHasHost()
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)

  const send = async (change: { model?: string; effort?: Effort } | null) => {
    if (!change || busy) return
    setBusy(true)
    setAnswer(null)
    const done = await sendChange(target, change, { live, run: (name, args) => runCommand(name, args as never) })
    setBusy(false)
    setAnswer(done.ok ? { ok: true, words: done.message } : { ok: false, words: done.why })
  }

  return {
    busy,
    answer,
    clear: () => setAnswer(null),
    onTier: (tier: TierId) => void send(changeForTier(current, tiers[tier])),
    onModel: (model: ModelChoice) => void send(changeFor(current, model)),
    onEffort: (effort: Effort) => void send(effort === current.effort ? null : { effort }),
  }
}

function ModelChoicePopover({ agent, target, runs, models, words, full }: ModelChoicePopoverProps) {
  const [open, setOpen] = useState(false)
  const { clear, ...choice } = useModelChange(target, runs)
  // Where the keyboard was before the choice opened: it goes back there, not to the pill, which is out of Tab's way.
  const back = useRef<HTMLElement | null>(null)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          clear()
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger
        tabIndex={-1}
        title={`${full}. Choose another tier or model`}
        aria-label={`Runs on ${words}. Choose another tier or model`}
        // The row opens the agent on a click; the pill only opens its choice.
        onClick={(event) => event.stopPropagation()}
        className={cn(PILL, 'transition-colors duration-[160ms] ease-[ease] hover:border-border-strong hover:text-foreground data-[popup-open]:border-border-strong data-[popup-open]:text-foreground')}
      >
        {words}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={6}
        data-agent-model=""
        finalFocus={() => (back.current?.isConnected ? back.current : true)}
        className="w-80 gap-2 p-2"
        // The popup is drawn outside the row but sits inside it for React: its clicks and keys are its own, so x in the
        // search never stops the agent and a click never opens its page.
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <ModelChoiceBody title={agent.title} current={runs.current} tier={runs.tier} tiers={runs.tiers} models={models} {...choice} />
      </PopoverContent>
    </Popover>
  )
}

interface AgentModelChoiceOverProps {
  agentId: string
  target: ChangeTarget
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the choice is drawn over: the agent's message box. */
  anchor: RefObject<Element | null>
  /** Where the keyboard goes back to once it closes. */
  back: RefObject<HTMLElement | null>
}

/**
 * The pill's choice, opened by /model from an agent's own page and drawn over its message box. Each opening starts
 * without the answer to the last one. An agent that has left the list has nothing to change.
 */
export function AgentModelChoiceOver({ agentId, ...props }: AgentModelChoiceOverProps) {
  const agent = useAgent(agentId)
  return agent ? <ChoiceOver agent={agent} {...props} /> : null
}

type ChoiceOverProps = Omit<AgentModelChoiceOverProps, 'agentId'> & { agent: RunningAgent }

function ChoiceOver({ agent, target, open, onOpenChange, anchor, back }: ChoiceOverProps) {
  const runs = useAgentRuns(agent)
  const models = useModelChoices()
  const { clear, ...choice } = useModelChange(target, runs)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) clear()
        onOpenChange(next)
      }}
    >
      <PopoverContent
        anchor={anchor}
        side="top"
        align="end"
        sideOffset={8}
        data-agent-model=""
        finalFocus={back}
        className="w-80 gap-2 p-2"
        // Drawn outside the page but inside it for React: its keys are its own, so they never walk the page's steps.
        onKeyDown={(event) => event.stopPropagation()}
      >
        <ModelChoiceBody title={agent.title} current={runs.current} tier={runs.tier} tiers={runs.tiers} models={models} {...choice} />
      </PopoverContent>
    </Popover>
  )
}

/** hobkin's answer to the last choice: what the agent works on now, or why not. */
export interface Answer {
  ok: boolean
  words: string
}

interface ModelChoiceBodyProps {
  title: string
  current: AgentModel
  /** The tier it runs on now, or null on a model of its own. */
  tier: TierId | null
  /** What each tier runs with now. */
  tiers: Record<TierId, AgentModel>
  models: readonly ModelChoice[]
  busy: boolean
  answer: Answer | null
  onTier: (tier: TierId) => void
  onModel: (model: ModelChoice) => void
  onEffort: (effort: Effort) => void
}

/**
 * The choice itself: hobkin's tiers with the one it runs on chosen, a search, Pi's models by provider with the current
 * one checked, the current model's levels, and one line for hobkin's answer. Every part keeps its height, so the popup
 * never grows or shrinks under the pointer.
 */
export function ModelChoiceBody({ title, current, tier, tiers, models, busy, answer, onTier, onModel, onEffort }: ModelChoiceBodyProps) {
  const [search, setSearch] = useState('')
  const found = useMemo(() => filterModels(models, search), [models, search])
  const providers = [...new Set(found.map((model) => model.provider))]
  const efforts = effortsOf(current.model, models)
  const status = busy ? 'Asking hobkin…' : (answer?.words ?? 'It takes a new tier, model or level from its next step.')

  return (
    <>
      <div className="flex items-baseline gap-2 px-1">
        <span className="eyebrow shrink-0">Runs on</span>
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">{title}</span>
      </div>
      <div role="radiogroup" aria-label="Tier" className="flex h-6 items-center gap-1 px-1">
        {TIER_IDS.map((id) => {
          const selected = id === tier
          const runsWith = tiers[id]
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              // A tier whose model the window cannot name is no choice: there is nothing to send.
              disabled={busy || !runsWith.model}
              title={runsWith.model ? `${TIER_INFO[id].meantFor}. ${fullName(runsWith)}` : `${TIER_INFO[id].meantFor}. Its model is not reported`}
              onClick={() => onTier(id)}
              className={cn(
                'h-6 flex-1 rounded-full px-2 text-[11px] font-medium transition-[background-color,color] duration-[160ms] ease-[ease] disabled:opacity-60',
                selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              {TIER_INFO[id].label}
            </button>
          )
        })}
      </div>
      <label className="flex h-8 items-center gap-2 rounded-full border border-input bg-surface px-3 transition-colors duration-[160ms] ease-[ease] focus-within:border-ring">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || !found[0]) return
            event.preventDefault()
            onModel(found[0])
          }}
          placeholder="Search models"
          aria-label="Search models"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div role="group" aria-label="Models" className="scroll-quiet h-52 overflow-y-auto">
        {found.length === 0 ? <p className="px-2 py-3 text-[12px] text-muted-foreground">No model matches that.</p> : null}
        {providers.map((provider) => (
          <div key={provider}>
            <div className="eyebrow px-2 pt-2 pb-0.5">{provider}</div>
            {found
              .filter((model) => model.provider === provider)
              .map((model) => (
                <button
                  key={model.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={model.id === current.model}
                  onClick={() => onModel(model)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-[120ms] ease-[ease] hover:bg-surface-2 focus-visible:bg-surface-2 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate text-[13px]">{model.name}</span>
                  {model.id === current.model ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
                </button>
              ))}
          </div>
        ))}
      </div>
      <div role="radiogroup" aria-label="Thinking" className="flex h-6 items-center gap-1 overflow-hidden px-1">
        {efforts.length === 0 ? (
          <span className="text-[11px] text-muted-foreground">No thinking levels known for this model.</span>
        ) : (
          efforts.map((effort) => {
            const selected = effort === current.effort
            return (
              <button
                key={effort}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={busy}
                onClick={() => onEffort(effort)}
                className={cn(
                  'h-6 shrink-0 rounded-full px-2 text-[11px] font-medium transition-[background-color,color] duration-[160ms] ease-[ease] disabled:opacity-60',
                  selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
                )}
              >
                {effort}
              </button>
            )
          })
        )}
      </div>
      <p role="status" title={answer?.words} className={cn('line-clamp-2 h-8 px-1 text-[11px] leading-4', answer && !answer.ok ? 'text-bad-fg' : 'text-muted-foreground')}>
        {status}
      </p>
    </>
  )
}
