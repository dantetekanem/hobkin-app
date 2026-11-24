import { Dialog } from '@base-ui/react/dialog'
import { Check } from 'lucide-react'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Kbd } from '@/components/ui/kbd.tsx'
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
  numberFrom,
  overridesIn,
  rangeWords,
  refused,
  rowSay,
  RULES,
  rulesIn,
  sampleRulesAfter,
  saved,
  saving,
  scopeOpenedAt,
  shownValue,
  toggleKind,
  wordsFrom,
  wordsText,
  type RuleDef,
  type Save,
} from './yolo-rules.ts'
import type { OpenSetting, Start } from './YoloRules.tsx'

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
 * The popup behind the page's Settings button (063-yolo-settings-and-grades): every rule that decides whether a change merges,
 * in three groups, each setting one line of what it does, saved as it is changed. It keeps one size from open to close: its head
 * does not scroll and its body does. A card's press on a holding setting opens it at that setting, in that project's scope.
 */
interface RulesSheetProps {
  open: boolean
  yolo: YoloState
  live: boolean
  setSample: SetSample
  /** The press that opened it at a setting, or null when the button did. */
  target: OpenSetting | null
  onClose: () => void
  /** The Settings button, which has the keyboard again once the popup closes. */
  returnTo: { current: HTMLElement | null }
  start?: Start
}

export function YoloRulesSheet({ open, yolo, live, setSample, target, onClose, returnTo, start }: RulesSheetProps) {
  const still = useStill()
  const popup = useRef<HTMLDivElement | null>(null)
  const fade = still
    ? 'transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0'
    : 'transition-[translate,scale,opacity] duration-[360ms] ease-[var(--ease-drawer)] data-[starting-style]:translate-y-[-46%] data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-[180ms]'
  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-sm transition-opacity duration-[240ms] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          ref={popup}
          // On a card's press the keyboard goes to that setting's control, otherwise to the scope.
          initialFocus={() => popup.current?.querySelector<HTMLElement>(target ? `[data-rule="${target.name}"] [data-control]` : '[data-scope]') ?? null}
          finalFocus={() => returnTo.current}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex h-[min(720px,calc(100vh-48px))] w-[min(760px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] bg-background shadow-float outline-none',
            fade,
          )}
        >
          {open ? <RulesPanel yolo={yolo} live={live} setSample={setSample} target={target} start={start} /> : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** What the popup holds: a head that stays (title, scope, Close) over a body that scrolls. */
export function RulesPanel({ yolo, live, setSample, target, start }: { yolo: YoloState; live: boolean; setSample: SetSample; target: OpenSetting | null; start?: Start }) {
  const [scope, setScope] = useState<string | null>(() => (start?.scope !== undefined ? start.scope : scopeOpenedAt(yolo, target)))
  const body = useRef<HTMLDivElement | null>(null)
  const send = useSend(live, setSample)

  // A card's press: bring that setting to the middle of the body once the popup has drawn it.
  useEffect(() => {
    if (!target) return
    const frame = requestAnimationFrame(() => {
      const row = body.current?.querySelector<HTMLElement>(`[data-rule="${target.name}"]`)
      row?.scrollIntoView({ block: 'center' })
      row?.querySelector<HTMLElement>('[data-control]')?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
    // Only a new press moves it: the host's next answer must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.press])

  const all = yolo.rules
  if (!all) return null
  const rules = rulesIn(yolo, scope) ?? all
  const differs = overridesIn(yolo, scope)

  return (
    <>
      <header className="flex shrink-0 flex-col gap-3 px-7 pt-6 pb-3">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <Dialog.Title className="font-heading text-[22px] leading-tight font-semibold tracking-[-0.02em]">YOLO settings</Dialog.Title>
            <Dialog.Description className="mt-1 h-[22px] truncate text-[13.5px] leading-[22px] text-muted-foreground">What YOLO mode may merge. Each change saves as you make it.</Dialog.Description>
          </div>
          <Dialog.Close render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>
            Close <Kbd>esc</Kbd>
          </Dialog.Close>
        </div>
        <label className="flex h-8 items-center gap-2 text-[12.5px] text-muted-foreground">
          Settings for
          <select
            data-stop=""
            data-scope=""
            value={scope ?? ''}
            onChange={(event) => setScope(event.target.value || null)}
            className="h-7 rounded-lg border border-input bg-transparent px-2 text-[12.5px] text-foreground"
          >
            <option value="">All projects</option>
            {yolo.projects.map((project) => (
              <option key={project.slug} value={project.slug}>
                {project.name}
              </option>
            ))}
          </select>
          <span className="truncate">{scope ? (differs.length ? `${differs.length} of its settings differ from the rest.` : 'Same as all projects.') : ''}</span>
        </label>
      </header>
      <div ref={body} className="scroll-quiet flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto border-t border-border/60 px-7 pt-3 pb-6">
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
    </>
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
