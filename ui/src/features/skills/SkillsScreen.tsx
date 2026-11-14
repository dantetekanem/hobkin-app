import { BookOpen, MessageSquarePlus, RotateCw, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { SkillEntry, SkillsState } from '#shared/pi-resources/wire.ts'
import { Hero, Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER_UNDER_SECOND_ROW } from '@/app/screen-layout.ts'
import { useStill } from '@/app/still.ts'
import { Button } from '@/components/ui/button.tsx'
import { Switch } from '@/components/ui/switch.tsx'
import { cn } from '@/lib/utils.ts'
import { groupsOf, matching } from './groups.ts'
import { Empty, messageOf, Notices, PageHeading, Part, pieces, sentence, timeOf, useLanding, walkWithArrows } from './page-parts.tsx'
import { SkillDetail } from './SkillDetail.tsx'
import { skillActions, useShownSkills, useSkills } from './store.ts'

/** Where the list on the page comes from, and when it was read, in one line. */
function sourceLine(live: boolean, state: SkillsState | null): string {
  if (!live) return "Sample data. Nothing here changes Pi's settings."
  if (!state) return "Reading Pi's skills."
  const from = `From Pi's settings, ${state.settings ?? 'which the host reads when asked'}.`
  return state.readAt ? `${from} ${sentence(`Read at ${timeOf(state.readAt)}`)} A change takes hold when Pi next starts or reloads.` : from
}

function summaryOf(skills: readonly SkillEntry[]): string {
  if (skills.length === 0) return 'No skills yet'
  const on = skills.filter((skill) => skill.on).length
  const count = skills.length === 1 ? '1 skill' : `${skills.length} skills`
  return on === skills.length ? `${count}, all on` : `${count}, ${on} on`
}

/** The one line under a skill's description when there is something to know: Pi skips it, uses another, or it waits to be named. */
function noteOf(skill: SkillEntry): { text: string; warn: boolean } | null {
  if (skill.problem) return { text: `Pi skips this file: ${skill.problem}.`, warn: true }
  if (skill.shadowedBy) return { text: `Pi uses another skill named ${skill.name}.`, warn: true }
  if (!skill.on) return { text: 'Off. Pi does not load it.', warn: false }
  if (skill.commandOnly) return { text: `Only when named: /skill:${skill.name}`, warn: false }
  return null
}

/**
 * Skills: every skill Pi has, from its own folder, the Agent Skills folder, its settings and its packages. Each can be
 * turned off and on, read in full, and handed to main hobkin with a change asked for in the user's words. With a host,
 * what shows is what it read from Pi, and a switch changes Pi's settings through Pi's own code. Spec:
 * 039-skills-and-extensions. This file is the entry the frame mounts.
 *
 * Keys: the arrows move between controls by where they sit, and Escape closes an open skill. An Escape with nothing
 * of the page's own open is left for the frame, which steps back up to Settings.
 */
export function SkillsScreen() {
  const { live, state } = useShownSkills()
  const actions = skillActions(live)
  const turning = useSkills((store) => store.turning)
  const [notice, setNotice] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ path: string; ask: boolean } | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  /** The control to give the keyboard back to once the open skill has closed. */
  const opener = useRef<HTMLElement | null>(null)
  const still = useStill()

  useLanding(root, scroller)

  // Opening the page reads Pi's skills, so a change made in a terminal shows here too.
  useEffect(() => {
    setNotice(null)
    actions.refresh().catch((error: unknown) => setNotice(messageOf(error)))
  }, [actions])

  const skills = useMemo(() => state?.skills ?? [], [state])
  const groups = useMemo(() => groupsOf(matching(skills, query)), [skills, query])
  const shownSkill = open ? (skills.find((skill) => skill.path === open.path) ?? null) : null

  // A skill that went away while it was open takes its detail with it.
  useEffect(() => {
    if (open && !shownSkill) setOpen(null)
  }, [open, shownSkill])

  const turn = (skill: SkillEntry, on: boolean) => {
    setNotice(null)
    actions.turn(skill.path, on).catch((error: unknown) => setNotice(messageOf(error)))
  }

  const show = (skill: SkillEntry, ask: boolean) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen({ path: skill.path, ask })
  }

  const close = () => setOpen(null)

  const readAgain = () => {
    setNotice(null)
    actions.refresh().catch((error: unknown) => setNotice(messageOf(error)))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      if (!open) return
      event.preventDefault()
      close()
      return
    }
    // The arrows walk the open skill while it is open, and the list otherwise.
    const layer = open ? root.current?.querySelector<HTMLElement>('[data-detail]') : scroller.current
    walkWithArrows(event, layer, still)
  }

  // What did not go as asked, then what kept Pi from reading, then what it could not read.
  const notices = [
    ...(notice ? [notice] : []),
    ...(state?.error ? [state.error] : []),
    ...(state?.problems ?? []).map((problem) => `Pi could not read all of its skills: ${problem}`),
  ]

  return (
    <div ref={root} tabIndex={-1} onKeyDown={onKeyDown} className="relative h-full outline-none">
      <div ref={scroller} inert={open !== null} className={`${SCREEN_SCROLLER_UNDER_SECOND_ROW} pb-12`}>
        {/* The page loads on demand and may arrive after the canvas has played its entrance, so it starts its own. */}
        <motion.div variants={pieces} initial="enter" animate="center" className={`flex flex-col gap-10 ${SCREEN_COLUMN}`}>
          <Hero>
            <PageHeading title="Skills" line="What Pi's agents can load when a task calls for it, each one a SKILL.md file. Turn one off, read it whole, or ask hobkin to change it." />
          </Hero>
          <Rise>
            <Part
              label="Pi's skills"
              title={state ? summaryOf(skills) : 'Reading'}
              line={sourceLine(live, state)}
              aside={
                <>
                  <label className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-3 size-3.5 text-muted-foreground" aria-hidden="true" />
                    <input
                      data-key-stop=""
                      type="search"
                      aria-label="Find a skill"
                      value={query}
                      onChange={(event) => setQuery(event.currentTarget.value)}
                      placeholder="Find a skill"
                      className="h-8 w-48 rounded-full border border-input bg-surface pr-3 pl-8 text-[13px] outline-offset-2 placeholder:text-muted-foreground/70"
                    />
                  </label>
                  {live ? (
                    <Button variant="outline" size="sm" data-key-stop="" aria-label="Read Pi's skills again" onClick={readAgain}>
                      <RotateCw aria-hidden="true" />
                      Read again
                    </Button>
                  ) : null}
                </>
              }
            >
              <Notices items={notices} />
            </Part>
          </Rise>
          <Rise>
            <div className="flex flex-col gap-9">
              {groups.length === 0 ? (
                <Empty>{!state ? "Reading Pi's skills." : skills.length === 0 ? "Pi has no skills yet. A folder with a SKILL.md in Pi's skills folder is one." : 'No skill matches that.'}</Empty>
              ) : (
                groups.map((group) => (
                  <section key={group.key} aria-label={group.label} className="flex flex-col gap-3">
                    <header>
                      <h3 className="eyebrow">{group.label}</h3>
                      <p className="mt-1 text-[12px] break-words text-muted-foreground">{group.line}</p>
                    </header>
                    <div className="grid grid-cols-2 gap-3 @max-[760px]:grid-cols-1">
                      {group.skills.map((skill) => (
                        <SkillTile key={skill.path} skill={skill} busy={turning.includes(skill.path)} onTurn={turn} onShow={show} />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </Rise>
        </motion.div>
      </div>
      <AnimatePresence
        onExitComplete={() => {
          opener.current?.focus({ preventScroll: true })
          opener.current = null
        }}
      >
        {shownSkill && open ? (
          <SkillDetail key={shownSkill.path} skill={shownSkill} ask={open.ask} still={still} actions={actions} busy={turning.includes(shownSkill.path)} onTurn={(on) => turn(shownSkill, on)} onClose={close} />
        ) : null}
      </AnimatePresence>
    </div>
  )
}

interface SkillTileProps {
  skill: SkillEntry
  /** It is being turned off or on now. */
  busy: boolean
  onTurn: (skill: SkillEntry, on: boolean) => void
  onShow: (skill: SkillEntry, ask: boolean) => void
}

/** A skill: its name and description, a switch that turns it off and on, and the ways to read it whole and to ask for a change. */
function SkillTile({ skill, busy, onTurn, onShow }: SkillTileProps) {
  const note = noteOf(skill)
  return (
    <article data-tile={skill.path} aria-label={skill.name} className="flex min-w-0 flex-col gap-3 rounded-[22px] bg-background p-4">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className={cn('truncate font-heading text-[15px] leading-tight font-semibold tracking-[-0.015em]', !skill.on && 'text-muted-foreground')}>{skill.name}</h4>
          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted-foreground">{skill.description || 'No description.'}</p>
        </div>
        <Switch data-key-stop="" checked={skill.on} disabled={busy} aria-label={`${skill.name}, ${skill.on ? 'on' : 'off'}`} onCheckedChange={(on) => onTurn(skill, on)} className="mt-0.5" />
      </header>
      {note ? <p className={cn('text-[12px] break-words', note.warn ? 'text-warn-fg' : 'text-muted-foreground')}>{note.text}</p> : null}
      <footer className="mt-auto flex flex-wrap gap-1.5">
        <Button variant="outline" size="sm" data-key-stop="" onClick={() => onShow(skill, false)}>
          <BookOpen aria-hidden="true" />
          View more
        </Button>
        <Button variant="ghost" size="sm" data-key-stop="" onClick={() => onShow(skill, true)}>
          <MessageSquarePlus aria-hidden="true" />
          Ask for a change
        </Button>
      </footer>
    </article>
  )
}
