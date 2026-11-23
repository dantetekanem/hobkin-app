import { motion, type Variants } from 'motion/react'
import { memo } from 'react'
import { Rise } from '@/app/Reveal.tsx'
import { SCREEN_COLUMN, SCREEN_SCROLLER } from '@/app/screen-layout.ts'
import { stagger, staggerDelay } from '@/lib/motion.ts'
import { dismiss } from './dismissals.ts'
import { Custom, Needs, Problems, Projects, Today, Week, Yolo } from './Sections.tsx'
import { Stage, StatusChips } from './Stage.tsx'
import type { HomeModel } from './types.ts'

/** Home's pieces land one after another once the screen has arrived, the stage first. */
const pieces: Variants = {
  enter: {},
  center: { transition: { staggerChildren: stagger, delayChildren: staggerDelay } },
}

const CELL = 'flex min-w-0 flex-col'

// Each section draws again only when its own part of the model changes. The agents at work change up to five times a
// second, and only the stage shows them.
const StageSection = memo(Stage)
const ChipsSection = memo(StatusChips)
const TodaySection = memo(Today)
const NeedsSection = memo(Needs)
const YoloSection = memo(Yolo)
const ProblemsSection = memo(Problems)
const WeekSection = memo(Week)
const ProjectsSection = memo(Projects)
const CustomSection = memo(Custom)

/**
 * Home, drawn from its model: the stage with hobkin, the card that matters most and the agents at work, the status
 * chips under it, today's runs, then what needs the user, YOLO mode, problems, the week and the projects. The layout is
 * fixed, so everything keeps its place as the numbers change; hobkin's own widgets follow the projects.
 */
export function HomeView({ model }: { model: HomeModel }) {
  // An available model always supplies seven days, including when there are no runs.
  const unavailable = model.week.days.length === 0
  const custom = model.widgets.flatMap(widget => (widget.kind === 'custom' && widget.custom ? [widget.custom] : []))
  return (
    <div className={`${SCREEN_SCROLLER} pb-14`}>
      <motion.div variants={pieces} className={`${SCREEN_COLUMN} @container flex flex-col gap-5`}>
        {/* The chips ride in the stage's piece: a piece that turns up after the screen arrived would stay hidden. */}
        <Rise className="flex flex-col gap-3">
          <StageSection model={model} unavailable={unavailable} onDismiss={dismiss} />
          <ChipsSection header={model.header} />
        </Rise>
        <Rise>
          <TodaySection upcoming={model.upcoming} unavailable={unavailable} />
        </Rise>
        <div className="grid grid-cols-2 gap-4 @max-[760px]:grid-cols-1">
          <Rise className={CELL}><NeedsSection needs={model.needs} unavailable={unavailable} /></Rise>
          <Rise className={CELL}><YoloSection yolo={model.yolo} /></Rise>
          <Rise className={CELL}><ProblemsSection problems={model.problems} unavailable={unavailable} /></Rise>
          <Rise className={CELL}><WeekSection week={model.week} unavailable={unavailable} /></Rise>
          <Rise className={`${CELL} col-span-full`}>
            <ProjectsSection projects={model.projects} connections={model.connections} unavailable={unavailable} />
          </Rise>
          {/* hobkin writes these at any time, so they show as they come rather than wait for the screen's entrance. */}
          {custom.map(spec => (
            <div key={spec.id} className={CELL}><CustomSection spec={spec} now={model.upcoming.day.now} /></div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
