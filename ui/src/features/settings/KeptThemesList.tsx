import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type KeyboardEvent } from 'react'
import { backgroundImageCss } from '#shared/protocol/appearance.ts'
import { KEPT_NAME_MAX, KEPT_THEMES_MAX } from '#shared/protocol/theme-history.ts'
import { originOf, pickKeptTheme, useThemeChoice } from '@/app/theme.ts'
import { runCommand } from '@/lib/host/client.ts'
import { useHost } from '@/lib/host/hooks.ts'
import { spring, tween } from '@/lib/motion.ts'
import { themeDay, themeSwatches, type ThemeSwatch } from './kept-themes.ts'

const said = (error: unknown, otherwise: string) => (error instanceof Error && error.message ? error.message : otherwise)

/**
 * The custom themes hobkin made, newest first, under Custom in Day and night (020-settings). Picking one puts it on, and
 * it opens from its swatch. Edit renames or removes them. The host keeps the list, so it holds after a restart.
 */
export function KeptThemesList() {
  const kept = useHost((state) => state.themes)
  const customOn = useThemeChoice() === 'custom'
  const swatches = themeSwatches(kept, customOn)
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  if (!swatches.length) return null

  const pick = async (id: string, origin?: { x: number; y: number }) => {
    setNote(null)
    if (!(await pickKeptTheme(id, origin))) setNote('Not changed. Connect to hobkin first.')
  }
  const rename = async (swatch: ThemeSwatch, name: string) => {
    const clean = name.trim()
    if (!clean || clean === swatch.title) return
    try {
      await runCommand('appearance.rename', { id: swatch.id, name: clean })
      setNote(null)
    } catch (error) {
      setNote(said(error, 'Not renamed. Connect to hobkin first.'))
    }
  }
  const remove = async (swatch: ThemeSwatch) => {
    try {
      await runCommand('appearance.remove', { id: swatch.id })
      setNote(null)
    } catch (error) {
      setNote(said(error, 'Not removed. Connect to hobkin first.'))
    }
  }

  // Left and Right put the next theme on, as in any radio group. The keyboard's change shows at once, without the reveal.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const at = swatches.findIndex(({ id }) => id === (event.target as HTMLElement).dataset.theme)
    const next = swatches[(Math.max(0, at) + delta + swatches.length) % swatches.length]!
    event.currentTarget.querySelector<HTMLElement>(`[data-theme="${next.id}"]`)?.focus()
    void pick(next.id)
  }

  const stop = swatches.find(({ on }) => on)?.id ?? swatches[0]!.id
  const line = note ?? (swatches.length >= KEPT_THEMES_MAX ? `hobkin keeps ${KEPT_THEMES_MAX} themes. The next new one replaces the oldest.` : '')

  return (
    <section aria-labelledby="kept-themes-label" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <h3 id="kept-themes-label" className="text-[12px] font-medium">Your themes</h3>
        <button
          type="button"
          data-stop=""
          onClick={() => setEditing((on) => !on)}
          className="-my-1 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-[color,transform] duration-[140ms] ease-out hover:text-foreground active:scale-[0.97]"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <motion.div
        layoutScroll
        role={editing ? 'list' : 'radiogroup'}
        aria-labelledby="kept-themes-label"
        onKeyDown={editing ? undefined : onKeyDown}
        // The right edge fades over the trailing space, so a theme cut off there says there are more, and the last one,
        // scrolled to, sits clear of the fade.
        style={{ maskImage: EDGE_FADE, WebkitMaskImage: EDGE_FADE }}
        className="scroll-quiet -mx-1 flex snap-x scroll-px-1 overflow-x-auto overscroll-x-contain pt-1 pr-7 pb-1 pl-1"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {swatches.map((swatch) => (
            <motion.div
              key={swatch.id}
              layout
              exit={{ opacity: 0, transform: 'scale(0.96)', transition: tween.exit }}
              transition={spring.follow}
              className="shrink-0 snap-start"
            >
              {editing ? (
                <EditCard swatch={swatch} onRename={rename} onRemove={remove} />
              ) : (
                <PickCard swatch={swatch} stop={swatch.id === stop} onPick={pick} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
      <p role="status" className={line ? 'text-[12px] text-muted-foreground' : 'sr-only'}>
        {line}
      </p>
    </section>
  )
}

const CARD = 'flex w-[108px] flex-col gap-1.5 rounded-[18px] p-1 text-left'
const EDGE_FADE = 'linear-gradient(to right, #000 calc(100% - 28px), transparent)'

function PickCard({ swatch, stop, onPick }: { swatch: ThemeSwatch; stop: boolean; onPick: (id: string, origin?: { x: number; y: number }) => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={swatch.on}
      data-theme={swatch.id}
      // The theme on now, or the first, is this group's stop in the walk.
      data-stop={stop ? '' : undefined}
      tabIndex={stop ? 0 : -1}
      title={swatch.asked ?? undefined}
      onClick={(event) => onPick(swatch.id, originOf(event.currentTarget))}
      className={`${CARD} outline-offset-0 transition-transform duration-[140ms] ease-out active:scale-[0.97]`}
    >
      <span className="relative block">
        {swatch.on ? (
          <motion.span
            layoutId="kept-theme-on"
            transition={spring.follow}
            className="pointer-events-none absolute -inset-[3px] rounded-[15px] border-2 border-foreground"
          />
        ) : null}
        <Swatch swatch={swatch} />
      </span>
      <span className="block truncate px-0.5 text-[12px] leading-tight font-medium">{swatch.title}</span>
      <span className="block truncate px-0.5 text-[11px] leading-tight text-muted-foreground">{themeDay(swatch.at)}</span>
    </button>
  )
}

function EditCard({ swatch, onRename, onRemove }: { swatch: ThemeSwatch; onRename: (swatch: ThemeSwatch, name: string) => void; onRemove: (swatch: ThemeSwatch) => void }) {
  const [name, setName] = useState(swatch.title)
  // Escape puts the name back, so the blur that follows must not save it.
  const cancelled = useRef(false)

  return (
    <div role="listitem" className={CARD}>
      <span className="relative block">
        <Swatch swatch={swatch} />
        {/* The theme on now stays until another is put on. */}
        {swatch.on ? null : (
          <button
            type="button"
            aria-label={`Remove ${swatch.title}`}
            data-stop=""
            onClick={() => onRemove(swatch)}
            className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-surface-2 text-foreground shadow-sm ring-1 ring-border-strong transition-transform duration-[140ms] ease-out active:scale-[0.9]"
          >
            <X className="size-3" strokeWidth={2.75} aria-hidden="true" />
          </button>
        )}
      </span>
      <input
        aria-label={`Name for ${swatch.title}`}
        data-stop=""
        value={name}
        maxLength={KEPT_NAME_MAX}
        onChange={(event) => setName(event.currentTarget.value)}
        onFocus={() => (cancelled.current = false)}
        onBlur={() => {
          if (cancelled.current || !name.trim()) setName(swatch.title)
          else onRename(swatch, name)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') {
            // This field takes the Escape, so Settings stays open.
            event.preventDefault()
            cancelled.current = true
            event.currentTarget.blur()
          }
        }}
        className="w-full min-w-0 rounded-md bg-tone-1 px-1.5 py-0.5 text-[12px] leading-tight font-medium"
      />
      <span className="block truncate px-0.5 text-[11px] leading-tight text-muted-foreground">{swatch.on ? 'On now' : themeDay(swatch.at)}</span>
    </div>
  )
}

/** A small window in the theme's own colors: its background, a card with a heading and a line of muted text, and the accent. */
function Swatch({ swatch }: { swatch: ThemeSwatch }) {
  const { palette } = swatch
  return (
    <span
      aria-hidden="true"
      className="relative block h-16 w-full overflow-hidden rounded-xl ring-1 ring-foreground/10 ring-inset"
      style={{
        backgroundColor: palette.background,
        ...(swatch.photo ? { backgroundImage: backgroundImageCss({ kind: 'photo', id: 'milky-way' }, palette), backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
      }}
    >
      <span
        className="absolute inset-y-2.5 right-3 left-2.5 flex flex-col justify-center gap-1.5 rounded-lg px-2"
        style={{ backgroundColor: palette.surface, ...(swatch.border ? { boxShadow: `inset 0 0 0 1px ${swatch.border}` } : {}) }}
      >
        <span className="font-heading text-[13px] leading-none font-semibold tracking-[-0.02em]" style={{ color: palette.text }}>
          Aa
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: palette.muted }} />
          <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: palette.accent }} />
        </span>
      </span>
    </span>
  )
}
