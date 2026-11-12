import { Columns2, Rows2, UnfoldVertical, X } from 'lucide-react'
import { animate, motion, useMotionValueEvent, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Unit } from '#shared/review/assessment.ts'
import { hashLines } from '#shared/review/lines.ts'
import type { ReviewFileContents, ReviewNode } from '#shared/review/types.ts'
import { Kbd } from '@/components/ui/kbd.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx'
import { spring } from '@/lib/motion.ts'
import { cn } from '@/lib/utils.ts'
import { useTimings } from '../dev/dev.ts'
import { KIND } from '../graph/kinds.tsx'
import { askHobkin, type AskCommand } from '../panel/ask.ts'
import { toStepUnit, unitInFocus } from '../reading/model.ts'
import { reviewMemory, useReduced, useReviewMemory, useRig, useSession, useSessionStore, useSource } from '../state/context.tsx'
import { DiffView, type DiffViewHandle, type LineMark } from './DiffView.tsx'
import type { Emphasis } from './diff-rows.ts'
import { Explanation } from './Explanation.tsx'

/** The share of the window's height the panel may take. */
export const PANEL_SHARE = { initial: 0.3, min: 0.2, max: 0.7, step: 0.05 }

export const clampShare = (share: number) => Math.min(PANEL_SHARE.max, Math.max(PANEL_SHARE.min, share))

/** Narrower than this, the explanation and the code are two tabs instead of two columns. */
const SPLIT_WIDTH = 760

/** The open panel's own keys. The review's key handler asks here when a key is not one of the story's. */
let openPanelKey: ((key: string, shift: boolean) => boolean) | null = null

export function panelKey(key: string, shift = false): boolean {
  return openPanelKey?.(key, shift) ?? false
}

interface Tab {
  node: ReviewNode
  fileId: string
  label: string
}

/** One tab for each file each focus node points into. A step of three tests in one file has three tabs. */
function tabsOf(nodes: readonly ReviewNode[], files: readonly { id: string; path: string }[]): Tab[] {
  const tabs: Tab[] = []
  for (const node of nodes) {
    const fileIds = [...new Set(node.anchors.map((anchor) => anchor.fileId))]
    // A node with no lines, such as a binary file, still names its file.
    if (fileIds.length === 0) fileIds.push(files.find((file) => file.path === node.subtitle)?.id ?? '')
    for (const fileId of fileIds.filter(Boolean)) {
      const fileName = (files.find((file) => file.id === fileId)?.path ?? fileId).split('/').at(-1)!
      tabs.push({ node, fileId, label: nodes.length > 1 ? node.title : fileName })
    }
  }
  return tabs
}

/**
 * The code panel. It belongs to the canvas: it rises from the canvas's bottom edge and never covers the
 * conversation. The graph moves up and re-frames in the same movement, so the node stays in view above its code.
 * On its left the change review explains the unit of that code, with quick links to ask hobkin about it, and on its
 * right is the code. When the panel is narrow the two are tabs: Explanation and Code.
 *
 * Purpose of the motion: spatial consistency. The panel comes from the bottom and leaves through the bottom,
 * on spring.sheet, so Enter then Escape pressed quickly turns it round from where it is.
 */
export function CodePanel({ height, windowHeight, units, ask }: {
  height: number
  windowHeight: number
  /** The change review's units, when it has rated this change. */
  units?: readonly Unit[]
  /** Sends to hobkin, for a live review. */
  ask: AskCommand | null
}) {
  const store = useSessionStore()
  const source = useSource()
  const rig = useRig()
  const reduced = useReduced()
  const review = useSession((session) => session.review)
  const focus = useSession((session) => session.focus)
  const code = useSession((session) => session.code)
  const nodeOf = useSession((session) => session.nodeOf)
  const split = useReviewMemory((memory) => memory.splitDiff)
  const picked = useSession((session) => session.selection)
  const lineCounts = useSession((session) => session.counts.lines)
  const pointed = useSession((session) => session.pointed)
  const diffView = useRef<DiffViewHandle>(null)
  const sheet = useRef<HTMLElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [tab, setTab] = useState<'explain' | 'code'>('explain')
  const [dragging, setDragging] = useState(false)
  // The panel keeps what it showed while it slides away.
  const [lastCode, setLastCode] = useState(code)
  const [onScreen, setOnScreen] = useState(false)
  if (code != null && code !== lastCode) setLastCode(code)
  const shownCode = code ?? lastCode
  const open = code != null

  const tabs = useMemo(() => {
    const focused = focus.map((id) => nodeOf.get(id)).filter((node): node is ReviewNode => node != null)
    const shown = shownCode ? nodeOf.get(shownCode) : undefined
    return tabsOf(shown && !focused.includes(shown) ? [shown] : focused, review.files)
  }, [focus, nodeOf, review.files, shownCode])
  const [fileOf, setFileOf] = useState<Record<string, string>>({})
  const active = tabs.find((tab) => tab.node.id === shownCode && (fileOf[tab.node.id] ?? tab.fileId) === tab.fileId) ?? tabs.find((tab) => tab.node.id === shownCode) ?? tabs[0]

  // What the change review says about this code: the unit of the node shown, else the unit of what is in focus.
  const unit = useMemo(() => {
    const focused = focus.map((id) => nodeOf.get(id)).filter((node): node is ReviewNode => node != null)
    const found = unitInFocus(units, active ? [active.node] : [], null) ?? unitInFocus(units, focused, pointed)
    return found ? toStepUnit(found) : undefined
  }, [active, focus, nodeOf, pointed, units])
  const shownNode = active?.node.id
  const askAbout = useMemo(() => (ask ? (words: string) => askHobkin(store, ask, words, shownNode) : null), [ask, shownNode, store])

  // Two columns when there is room for both, two tabs when there is not. Only a change of side draws again.
  useLayoutEffect(() => {
    const element = sheet.current
    if (!element) return
    const measure = () => setNarrow(element.offsetWidth < SPLIT_WIDTH)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The panel's height on screen drives the uncovered area, so the camera and the panel move as one.
  const opened = useRef(0)
  useEffect(() => {
    if (height > 0 && rig.panel.get() < 1) opened.current = performance.now()
    // While the reviewer drags its edge the panel is under their hand, so it follows without a spring.
    if (reduced || dragging) {
      rig.panel.jump(height)
      return
    }
    const playing = animate(rig.panel, height, spring.sheet)
    void playing.finished.then(() => {
      if (opened.current && height > 0) useTimings.getState().record('Panel opened', performance.now() - opened.current)
      opened.current = 0
    })
    return () => playing.stop()
  }, [dragging, height, reduced, rig])
  useMotionValueEvent(rig.panel, 'change', (value) => {
    const visible = value > 0.5
    if (visible !== onScreen) setOnScreen(visible)
  })

  const drawnHeight = height || Math.round(clampShare(reviewMemory.getState().panelShare ?? PANEL_SHARE.initial) * windowHeight)
  const transform = useTransform(() => `translateY(${Math.max(0, drawnHeight - rig.panel.get())}px)`)
  // The steps panel is full height on the left, so the code starts where it ends, and follows it as it tucks away.
  const left = useTransform(() => rig.side.get())

  // The file's two sides come from the source. The review file itself holds no code.
  const [files, setFiles] = useState<Record<string, ReviewFileContents | { failed: string }>>({})
  const fileId = active?.fileId
  useEffect(() => {
    if (!fileId || files[fileId]) return
    let current = true
    source.getFile(review.id, fileId).then(
      (file) => current && setFiles((before) => ({ ...before, [fileId]: file })),
      (error: unknown) => current && setFiles((before) => ({ ...before, [fileId]: { failed: error instanceof Error ? error.message : 'The file did not load.' } })),
    )
    return () => {
      current = false
    }
  }, [fileId, files, review.id, source])
  const file = fileId ? files[fileId] : undefined

  const emphasis = useMemo<Emphasis[]>(
    () => (active ? active.node.anchors.filter((anchor) => anchor.fileId === active.fileId).map(({ side, startLine, endLine }) => ({ side, startLine, endLine })) : []),
    [active],
  )

  // Lines selected for a note, and the lines of this file that already carry notes.
  const selection = useMemo<Emphasis | null>(() => (picked && picked.fileId === fileId ? { side: picked.side, startLine: picked.startLine, endLine: picked.endLine } : null), [fileId, picked])
  const marks = useMemo<LineMark[]>(() => lineCounts.filter((range) => range.fileId === fileId).map(({ side, startLine, endLine, count }) => ({ side, startLine, endLine, count })), [fileId, lineCounts])
  const onSelect = useMemo(
    () => (range: Emphasis | null) => {
      if (!range || !file || 'failed' in file) return store.getState().selectLines(null)
      const text = (range.side === 'added' ? file.head : file.base) ?? ''
      store.getState().selectLines({ kind: 'lines', fileId: file.fileId, ...range, hash: hashLines(text, range.startLine, range.endLine) })
    },
    [file, store],
  )

  const select = (tab: Tab) => {
    setFileOf((before) => ({ ...before, [tab.node.id]: tab.fileId }))
    store.getState().showCode(tab.node.id)
  }
  const resize = (share: number) => reviewMemory.getState().setPanelShare(clampShare(share))

  useEffect(() => {
    if (!open) return
    openPanelKey = (key, shift) => {
      // Shift with Up and Down picks lines for a note, a line at a time.
      if (shift && (key === 'ArrowUp' || key === 'ArrowDown')) return diffView.current?.moveSelection(key === 'ArrowDown' ? 1 : -1), true
      const at = active ? tabs.indexOf(active) : -1
      const share = reviewMemory.getState().panelShare ?? PANEL_SHARE.initial
      switch (key.toLowerCase()) {
        // V for the view in one column or two. S is the steps panel's.
        case 'v':
          return reviewMemory.getState().setSplitDiff(!reviewMemory.getState().splitDiff), true
        case 'e':
          return diffView.current?.showMore(), true
        case 'f':
          return diffView.current?.showWholeFile(), true
        case ']':
          return tabs.length > 1 && select(tabs[(at + 1) % tabs.length]!), true
        case '[':
          return tabs.length > 1 && select(tabs[(at - 1 + tabs.length) % tabs.length]!), true
        case '=':
        case '+':
          return resize(share + PANEL_SHARE.step), true
        case '-':
          return resize(share - PANEL_SHARE.step), true
        case 'pagedown':
          return diffView.current?.scrollBy(12), true
        case 'pageup':
          return diffView.current?.scrollBy(-12), true
        default:
          return false
      }
    }
    return () => {
      openPanelKey = null
    }
  })

  const recordFirstLines = useMemo(() => (ms: number) => useTimings.getState().record('First lines', ms), [])
  const { icon: Icon } = active ? KIND[active.node.kind] : KIND.code
  const path = review.files.find((entry) => entry.id === active?.fileId)

  const explanation = (
    <div className="rv-explain rv-scroll h-full min-h-0 overflow-y-auto px-4 py-3.5" data-rv-code tabIndex={-1}>
      <Explanation unit={unit} node={active?.node} ask={askAbout} />
    </div>
  )
  const diff = (
    <div className="h-full min-h-0 min-w-0">
      {!file ? (
        <p className="dv-note px-4 py-5 font-sans text-[14px] opacity-60">{fileId ? 'Reading the file…' : 'This node points at no file.'}</p>
      ) : 'failed' in file ? (
        <p className="dv-note px-4 py-5 font-sans text-[14px] opacity-70">{file.failed}</p>
      ) : (
        <DiffView key={file.fileId} ref={diffView} file={file} emphasis={emphasis} split={split} selection={selection} onSelect={onSelect} marks={marks} onFirstLines={recordFirstLines} />
      )}
    </div>
  )

  return (
    <motion.section
      ref={sheet}
      // A sheet over the graph, with its own keys. The frame leaves the keys of a dialog to the dialog.
      role="dialog"
      aria-label="Code"
      aria-hidden={!open}
      inert={!open}
      data-rv-panel
      data-open={open}
      className="rv-panel absolute right-0 bottom-0 z-20 flex flex-col bg-code-bg text-code-text"
      style={{ left, height: drawnHeight, transform, visibility: open || onScreen ? 'visible' : 'hidden' }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the code panel"
        aria-valuemin={PANEL_SHARE.min * 100}
        aria-valuemax={PANEL_SHARE.max * 100}
        aria-valuenow={Math.round((drawnHeight / windowHeight) * 100)}
        className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-row-resize touch-none justify-center"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          if (dragging) resize((windowHeight - event.clientY) / windowHeight)
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => resize(PANEL_SHARE.initial)}
      >
        <span className="mt-[9px] h-1 w-10 rounded-full bg-[color-mix(in_oklab,var(--hb-code-text)_26%,transparent)] transition-[background-color,transform] duration-[160ms] ease-[var(--ease-out)] group-hover:scale-x-125 group-hover:bg-[color-mix(in_oklab,var(--hb-code-text)_50%,transparent)] group-active:scale-x-125" />
      </div>

      <header className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
        {narrow ? (
          <div role="tablist" aria-label="Explanation or code" className="flex shrink-0 items-center gap-0.5 rounded-full bg-[color-mix(in_oklab,var(--hb-code-text)_8%,transparent)] p-0.5">
            {(['explain', 'code'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-full px-2.5 py-1 font-heading text-[12.5px] font-semibold transition-[background-color,opacity] duration-[160ms]',
                  tab === value ? 'bg-[color-mix(in_oklab,var(--hb-code-text)_16%,transparent)]' : 'opacity-60 hover:opacity-100',
                )}
              >
                {value === 'explain' ? 'Explanation' : 'Code'}
              </button>
            ))}
          </div>
        ) : null}
        <Icon className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        {tabs.length > 1 ? (
          <div role="tablist" aria-label="Code of this step" className="flex min-w-0 items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={`${tab.node.id}:${tab.fileId}`}
                type="button"
                role="tab"
                aria-selected={tab === active}
                title={tab.node.title}
                onClick={() => select(tab)}
                className={cn(
                  'max-w-[22ch] truncate rounded-full px-2.5 py-1 font-heading text-[12.5px] font-medium transition-[background-color,opacity] duration-[160ms]',
                  tab === active ? 'bg-[color-mix(in_oklab,var(--hb-code-text)_14%,transparent)]' : 'opacity-60 hover:opacity-100',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="max-w-[40%] truncate font-heading text-[13px] font-semibold" title={active?.node.title}>
            {active?.node.title}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] opacity-70" title={path?.path}>
          {path?.oldPath && path.oldPath !== path.path ? `${path.oldPath} → ${path.path}` : path?.path}
        </span>
        {active?.node.stats && active.node.kind !== 'criterion' && active.node.kind !== 'context' ? (
          <span className="shrink-0 font-mono text-[12.5px]">
            <span className="text-ok-fg">+{active.node.stats.additions}</span> <span className="text-bad-fg">−{active.node.stats.deletions}</span>
          </span>
        ) : null}
        <PanelButton label={split ? 'One column' : 'Two columns'} keys="V" onClick={() => reviewMemory.getState().setSplitDiff(!split)}>
          {split ? <Rows2 /> : <Columns2 />}
        </PanelButton>
        <PanelButton label="Whole file" keys="F" onClick={() => diffView.current?.showWholeFile()}>
          <UnfoldVertical />
        </PanelButton>
        <PanelButton label="Close the code" keys="esc" onClick={() => store.getState().closeCode()}>
          <X />
        </PanelButton>
      </header>

      {narrow ? (
        <div className="min-h-0 flex-1">{tab === 'explain' ? explanation : diff}</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,36%)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
          {explanation}
          {diff}
        </div>
      )}
    </motion.section>
  )
}

function PanelButton({ label, keys, onClick, children }: { label: string; keys: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="grid size-8 shrink-0 place-items-center rounded-full transition-[background-color,transform] duration-[160ms] ease-[var(--ease-out)] hover:bg-[color-mix(in_oklab,var(--hb-code-text)_12%,transparent)] active:scale-[0.94] [&_svg]:size-4"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>
        {label} <Kbd>{keys}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
