import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, ChevronRight, X } from 'lucide-react'
import { spring, tween } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useStill } from '@/features/reports/still.ts'
import { openTarget } from './navigate.ts'
import type { HomeAction, HomeRow, HomeTarget, HomeTone } from './types.ts'

/** Each tone as a solid dot, a tinted tile behind an icon, and text. They map to the app's tokens only. */
export const DOT: Record<HomeTone, string> = {
  accent: 'bg-sun', bad: 'bg-bad-fg', warn: 'bg-warn-fg', ok: 'bg-ok-fg', info: 'bg-code-fg', quiet: 'bg-muted-foreground',
}
export const TILE: Record<HomeTone, string> = {
  accent: 'bg-sun/15 text-sun-fg',
  bad: 'bg-bad/15 text-bad-fg',
  warn: 'bg-warn/15 text-warn-fg',
  ok: 'bg-ok/15 text-ok-fg',
  info: 'bg-code/15 text-code-fg',
  quiet: 'bg-surface-2 text-muted-foreground',
}
export const TEXT: Record<HomeTone, string> = {
  accent: 'text-sun-fg', bad: 'text-bad-fg', warn: 'text-warn-fg', ok: 'text-ok-fg', info: 'text-code-fg', quiet: 'text-foreground',
}

export function ToneDot({ tone, className }: { tone: HomeTone; className?: string }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[tone], className)} />
}

/** An icon on a tile tinted by its tone, so a row says what it is before it is read. */
export function ToneIcon({ tone, children, size = 'md' }: { tone: HomeTone; children: ReactNode; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden="true" className={cn('grid shrink-0 place-items-center', size === 'lg' ? 'size-10 rounded-xl [&_svg]:size-5' : 'size-8 rounded-lg [&_svg]:size-4', TILE[tone])}>
      {children}
    </span>
  )
}

/** Whether a target leaves the app, so its button carries an outward arrow instead of a chevron. */
export const leaves = (target: HomeTarget) => target.to === 'url'

export function Go({ action, className }: { action: HomeAction; className?: string }) {
  const Icon = leaves(action.target) ? ArrowUpRight : ChevronRight
  return (
    <span className={cn('flex shrink-0 items-center gap-0.5 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground', className)}>
      {action.label}
      <Icon aria-hidden="true" className="size-3.5" />
    </span>
  )
}

/**
 * A dashboard card. A built-in passes `target` for its "See all" link; a custom widget passes `onDismiss` instead, so
 * its header carries a "×" to wave it off. One of the two is always present.
 */
export function Widget({ title, icon, target, count, aside, link = 'See all', onDismiss, children }: {
  title: string
  icon: ReactNode
  target?: HomeTarget
  count?: number
  aside?: string | null
  link?: string
  onDismiss?: () => void
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex h-full min-w-0 flex-col gap-3 rounded-[20px] border border-border bg-surface p-5">
      <header className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground [&_svg]:size-3.5">{icon}</span>
        <h2 className="min-w-0 truncate font-heading text-[15px] font-semibold tracking-tight">{title}</h2>
        {count ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">{count}</span> : null}
        {aside ? <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">{aside}</span> : null}
        {target ? (
          <button
            type="button"
            aria-label={`${link}: ${title}`}
            onClick={() => openTarget(target)}
            className="group ml-auto flex shrink-0 items-center gap-0.5 rounded-md text-xs text-muted-foreground hover:text-foreground"
          >
            {link}
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            aria-label={`Dismiss: ${title}`}
            onClick={() => onDismiss()}
            className={cn('grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 hover:text-foreground', target ? '' : 'ml-auto')}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </header>
      {children}
    </section>
  )
}

/**
 * A row opens what it names: the whole row is the button, and its verb says where it goes. A dismissable row (a
 * notification the user can wave off) also carries a hover "×" in space kept for it; it rides `layout`, so when a sibling
 * leaves the rest glide up, and fades as it goes. `list` is the rows it stands among: the row measures its place only
 * when that list changes, not on every draw of Home.
 */
export function Row({ row, list, icon, lead, onDismiss }: { row: HomeRow; list?: readonly HomeRow[]; icon?: ReactNode; lead?: ReactNode; onDismiss?: () => void }) {
  const still = useStill()
  const meta = [row.detail, row.aside].filter(Boolean)
  return (
    <motion.li
      layout={still ? false : 'position'}
      layoutDependency={list}
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={still ? { opacity: 0 } : { opacity: 0, transform: 'translateX(-10px)' }}
      transition={{ layout: spring.follow, opacity: tween.exit }}
      className="group/row relative"
    >
      <button
        type="button"
        onClick={() => openTarget(row.action.target)}
        className={cn('group -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2', onDismiss ? 'pr-9' : '')}
      >
        {lead ?? <ToneIcon tone={row.tone}>{icon}</ToneIcon>}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 break-words text-sm font-medium">{row.title}</span>
          {meta.length ? (
            <span className="mt-0.5 flex min-w-0 gap-1.5 text-xs text-muted-foreground">
              {row.detail ? <span className="min-w-0 truncate">{row.detail}</span> : null}
              {row.detail && row.aside ? <span aria-hidden="true">·</span> : null}
              {row.aside ? <span className="shrink-0 tabular-nums">{row.aside}</span> : null}
            </span>
          ) : null}
        </span>
        <Go action={row.action} />
      </button>
      {onDismiss ? (
        <button
          type="button"
          aria-label={`Dismiss: ${row.title}`}
          onClick={() => onDismiss()}
          className="absolute right-0 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-surface hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </motion.li>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col gap-0.5">
      <AnimatePresence mode="popLayout" initial={false}>{children}</AnimatePresence>
    </ul>
  )
}

/** What a widget says when it has nothing, with a calm icon instead of an empty box. */
export function Empty({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-3 text-[13px] text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0">
      {icon}
      <span>{children}</span>
    </p>
  )
}

export function More({ count, target }: { count: number; target: HomeTarget }) {
  return count > 0 ? (
    <button type="button" onClick={() => openTarget(target)} className="self-start rounded-md text-xs font-medium text-muted-foreground hover:text-foreground">
      +{count} more
    </button>
  ) : null
}
