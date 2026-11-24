import { Check, ChevronRightIcon } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { runCommand } from '@/lib/host/client.ts'
import { cn } from '@/lib/utils.ts'
import type { YoloRules as Rules, YoloRuleValue, YoloState } from '#shared/protocol/work.ts'
import { Segmented } from './parts.tsx'
import {
  changeArgs,
  clearArgs,
  GROUPS,
  IDLE,
  KINDS,
  forOneProject,
  NO_RULES,
  numberFrom,
  overridesIn,
  rangeWords,
  refused,
  rowSay,
  RULES,
  rulesIn,
  rulesSentence,
  sampleRulesAfter,
  saved,
  saving,
  shownValue,
  toggleKind,
  wordsFrom,
  wordsText,
  type RuleDef,
  type Save,
} from './yolo-rules.ts'

/** The setting a card's press opens in the block: its name, the project whose own setting it is when the project sets it, and a count that makes each press new. */
export interface OpenSetting {
  name: string
  slug: string | null
  press: number
}

/** Where the block begins, for a still of it: open, at a project, with a setting's save in a given state. */
export interface Start {
  open?: boolean
  scope?: string | null
  saves?: Record<string, Save>
}

/** How long "Saved" stays beside a setting. */
const SAVED_MS = 1800

type Args = { slug?: string; rules?: Record<string, YoloRuleValue>; clear?: string[] }
type SetSample = Dispatch<SetStateAction<YoloState>>

/** What a setting's save does: the host takes it and answers with the rules in force, or with no host the sample takes it. */
function useSend(live: boolean, setSample: SetSample) {
  return async (args: Args): Promise<void> => {
    if (!live) {
      setSample((before) => sampleRulesAfter(before, args))
      return
    }
    // The host answers by publishing work mode's status again, which is what the rows draw.
    await runCommand('work.yolo.rules', args)
  }
}

/** One setting's save: the value chosen shows while it saves and after, and a refusal shows in the row, in the runtime's words, with the host's value back. */
function useRuleSave(held: YoloRuleValue | undefined, send: (value: YoloRuleValue) => Promise<void>, first: Save = IDLE) {
  const [save, setSave] = useState<Save>(first)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const commit = async (value: YoloRuleValue) => {
    if (JSON.stringify(value) === JSON.stringify(shownValue(held, save))) return
    if (timer.current) clearTimeout(timer.current)
    setSave(saving(value))
    try {
      await send(value)
      setSave(saved(value))
      timer.current = setTimeout(() => setSave(IDLE), SAVED_MS)
    } catch (error) {
      setSave(refused(error instanceof Error ? error.message : String(error)))
    }
  }
  return { save, shown: shownValue(held, save), commit, refuse: (text: string) => setSave(refused(text)) }
}

/**
 * "What YOLO mode may do" (063-yolo-settings-and-grades): every rule that decides whether a change merges. Closed it is one
 * sentence of the rules in force; open it is three groups, each setting one line of what it does, saved as it is changed.
 * A project may set the first two groups for itself. A card's press on a holding setting opens the block at that setting.
 */
export function YoloRules({ yolo, live, setSample, opened, start }: { yolo: YoloState; live: boolean; setSample: SetSample; opened: OpenSetting | null; start?: Start }) {
  const [open, setOpen] = useState(start?.open ?? false)
  const [scope, setScope] = useState<string | null>(start?.scope ?? null)
  const root = useRef<HTMLElement | null>(null)

  // A press on a card's holding setting: open the block at it, on the project that sets it for itself, and put focus in its control.
  useEffect(() => {
    if (!opened) return
    setOpen(true)
    setScope(opened.slug && overridesIn(yolo, opened.slug).includes(opened.name) ? opened.slug : null)
    const frame = requestAnimationFrame(() => {
      const row = root.current?.querySelector<HTMLElement>(`[data-rule="${opened.name}"]`)
      row?.scrollIntoView({ block: 'center' })
      row?.querySelector<HTMLElement>('[data-control]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
    // Only a new press opens it: the host's next answer must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.press])

  const send = useSend(live, setSample)
  const all = yolo.rules
  if (!all) {
    return (
      <section aria-label="What YOLO mode may do" className="rounded-3xl bg-background px-5 py-3">
        <p className="h-5 truncate text-[13px] leading-5 text-muted-foreground">{NO_RULES}</p>
      </section>
    )
  }
  const sentence = rulesSentence(all)
  const rules = rulesIn(yolo, scope) ?? all
  const differs = overridesIn(yolo, scope)
  const projects = yolo.projects

  return (
    <section ref={root} aria-label="What YOLO mode may do" className="flex flex-col rounded-3xl bg-background px-5 py-3">
      <button
        type="button"
        data-stop=""
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="pressable -mx-2 flex min-w-0 items-start gap-2 rounded-xl px-2 py-1.5 text-left"
      >
        <ChevronRightIcon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', open && 'rotate-90')} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-heading text-[14px] font-medium">What YOLO mode may do</span>
          <span title={sentence} className="line-clamp-2 text-[13px] leading-[18px] text-muted-foreground">
            {sentence}
          </span>
        </span>
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-4">
          <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            Settings for
            <select
              data-stop=""
              value={scope ?? ''}
              onChange={(event) => setScope(event.target.value || null)}
              className="h-7 rounded-lg border border-input bg-transparent px-2 text-[12.5px] text-foreground"
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.slug} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
            <span className="truncate">{scope ? (differs.length ? `${differs.length} of its settings differ from the rest.` : 'Same as all projects.') : ''}</span>
          </label>
          {GROUPS.map(({ group, title, line }) => {
            const rows = RULES.filter((rule) => rule.group === group && (!scope || forOneProject(rule)))
            if (!rows.length) return null
            return (
              <section key={group} aria-label={title} className="flex flex-col">
                <h4 className="eyebrow flex h-6 items-center">{title}</h4>
                <p className="mb-1 h-[18px] truncate text-[12.5px] leading-[18px] text-muted-foreground">{line}</p>
                {rows.map((rule) => (
                  <RuleRow key={`${scope ?? ''}:${rule.name}`} rule={rule} rules={rules} slug={scope} differs={differs.includes(rule.name)} send={send} first={start?.saves?.[rule.name]} />
                ))}
              </section>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

function RuleRow({ rule, rules, slug, differs, send, first }: { rule: RuleDef; rules: Rules; slug: string | null; differs: boolean; send: (args: Args) => Promise<void>; first?: Save }) {
  const held = rules[rule.name]
  const { save, shown, commit, refuse } = useRuleSave(held, (value) => send(changeArgs(slug, rule.name, value)), first)
  const say = rowSay(rule, save)
  const [handing, setHanding] = useState(false)
  const handBack = async () => {
    if (!slug || handing) return
    setHanding(true)
    try {
      await send(clearArgs(slug, rule.name))
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error))
    } finally {
      setHanding(false)
    }
  }
  return (
    <div data-rule={rule.name} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 py-2.5 first:border-t-0">
      <div className="min-w-[240px] flex-1">
        <p className="flex h-5 items-center gap-2 font-heading text-[14px] leading-5 font-medium">
          <span className="truncate">{rule.label}</span>
          {slug && differs ? (
            <>
              <span className="shrink-0 text-[11.5px] font-medium text-sun-fg">Set for this project</span>
              <Button variant="ghost" size="xs" data-stop="" disabled={handing} onClick={() => void handBack()} className="shrink-0 text-muted-foreground">
                Same as all projects
              </Button>
            </>
          ) : null}
        </p>
        <p role={say.refused ? 'alert' : undefined} title={say.words} className={cn('mt-0.5 h-[18px] truncate text-[12.5px] leading-[18px]', say.refused ? 'text-bad-fg' : 'text-muted-foreground')}>
          {say.words}
        </p>
      </div>
      <div className="ml-auto flex min-w-0 items-center justify-end gap-2">
        <Control rule={rule} value={shown} epoch={save.phase === 'refused' ? save.text : ''} commit={commit} refuse={refuse} />
        <span aria-live="polite" className="flex h-5 w-[68px] shrink-0 items-center gap-1 text-[12px] whitespace-nowrap text-muted-foreground">
          {say.status === 'Saving' ? 'Saving…' : null}
          {say.status === 'Saved' ? (
            <>
              <Check aria-hidden="true" className="size-3.5 text-ok-fg" />
              Saved
            </>
          ) : null}
        </span>
      </div>
    </div>
  )
}

const FIELD = 'h-8 rounded-lg border border-input bg-transparent px-2 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/** The control of one setting, by its kind. It only sends what the user chose: the runtime checks every value. */
function Control({ rule, value, epoch, commit, refuse }: { rule: RuleDef; value: YoloRuleValue | undefined; epoch: string; commit: (value: YoloRuleValue) => void; refuse: (text: string) => void }) {
  if (rule.kind === 'switch') {
    const on = value === true
    return (
      <>
        <span className="w-7 text-right text-[12.5px] text-muted-foreground">{on ? 'On' : 'Off'}</span>
        <Switch aria-label={rule.label} checked={on} onCheckedChange={(next) => commit(next)} data-stop="" data-control="" />
      </>
    )
  }
  if (rule.kind === 'number') {
    const current = typeof value === 'number' ? String(value) : value === null ? 'none' : ''
    const send = (text: string) => {
      const read = numberFrom(rule, text)
      if ('refused' in read) refuse(read.refused)
      else commit(read.value)
    }
    return (
      <>
        <span className="text-[12px] whitespace-nowrap text-muted-foreground">{rule.none ? `${rangeWords(rule)}, or none` : rangeWords(rule)}</span>
        <input
          key={`${current}:${epoch}`}
          aria-label={rule.label}
          inputMode="decimal"
          defaultValue={current}
          data-stop=""
          data-control=""
          onBlur={(event) => send(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className={cn(FIELD, 'w-20 text-right tabular-nums')}
        />
      </>
    )
  }
  if (rule.kind === 'kinds') {
    const chosen = Array.isArray(value) ? value : []
    return (
      <div role="group" aria-label={rule.label} className="flex flex-wrap justify-end gap-1">
        {KINDS.map((kind, at) => {
          const on = chosen.includes(kind.value)
          return (
            <button
              key={kind.value}
              type="button"
              aria-pressed={on}
              data-stop=""
              data-control={at === 0 ? '' : undefined}
              onClick={() => commit(toggleKind(chosen, kind.value))}
              className={cn('pressable h-7 rounded-full px-2.5 text-[12px] font-medium', on ? 'bg-tone-1 text-foreground' : 'text-muted-foreground')}
            >
              {kind.label}
            </button>
          )
        })}
      </div>
    )
  }
  if (rule.kind === 'words') {
    const text = Array.isArray(value) ? wordsText(value) : ''
    return (
      <input
        key={`${text}:${epoch}`}
        aria-label={rule.label}
        defaultValue={text}
        data-stop=""
        data-control=""
        onBlur={(event) => commit(wordsFrom(event.currentTarget.value))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
        className={cn(FIELD, 'w-72 max-w-full')}
      />
    )
  }
  return (
    <Segmented
      label={rule.label}
      name={`yolo-rule-${rule.name}`}
      value={typeof value === 'string' ? value : ''}
      options={rule.choices}
      onChoose={(next) => commit(next)}
    />
  )
}
