import { animate, AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useMemo, useRef, type RefObject } from 'react'
import { spring, tween } from '@/lib/motion.ts'
import { openRunAmong } from '../../proofs/open-run.ts'
import { MENU } from '../panel/Header.tsx'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { useModelRows } from '../story/use-model-checks.ts'
import { pressProof, proofRoom, proofSiblings } from './beside.ts'

/** The proof's code loads when it first opens, and the review's does not wait for it. */
const ProofPanel = lazy(() => import('../../proofs/ProofPanel.tsx').then((module) => ({ default: module.ProofPanel })))

/** T and Shift+T, for the review's keys (`keys.ts`): from the control `from` names, or the review itself. */
export interface ProofKeys {
  press(shift: boolean, from: string | null): void
}

/** The opener a key comes from: the nearest control that names itself with `data-proof-from`. */
export function proofFrom(element: Element | null): string | null {
  return element?.closest?.('[data-proof-from]')?.getAttribute('data-proof-from') ?? null
}

/** The control `from` names, as drawn: never the copy of a card measured out of sight. */
function controlOf(root: HTMLElement, from: string): HTMLElement | null {
  const named = root.querySelectorAll<HTMLElement>(`[data-proof-from="${CSS.escape(from)}"]`)
  return [...named].find((control) => !control.closest('[inert]')) ?? null
}

interface ProofBesideProps {
  /** The review's width. */
  canvas: number
  /** What the review's panel and the outline leave of it, at the right. */
  room: number
  root: RefObject<HTMLElement | null>
  keys: RefObject<ProofKeys | null>
}

/**
 * The proof beside the review (053-work-control-room, "Proofs"; the user, 2026-11-21: "the TLA+ and TLAPS approval
 * should be much easier to view, move across, have in the same screen, using keys to open/close"). T opens it on the
 * change's first model that needs a look, a click on a model's row opens it on that model, and T, Escape or its close
 * button closes it. J and K move through the change's models in the order the review lists them, and Shift+T or its
 * expand button opens the full page, which comes back to the review as it was, with the proof open again.
 *
 * It sits at the right, the full height of the review, at a fixed width (`proofRoom`), so nothing moves while its code
 * loads: beside the graph, which keeps the room left of it and frames there, or over the graph when there is no room
 * for both. Never over the review's panel, where the verdict is. The review stays mounted under it as it was, and takes
 * the keyboard back on the control that opened it. Closed, nothing of it is mounted.
 */
export function ProofBeside({ canvas, room, root, keys }: ProofBesideProps) {
  const store = useSessionStore()
  const rig = useRig()
  const reduced = useReduced()
  const proof = useSession((session) => session.proof)
  const rows = useModelRows()
  const siblings = useMemo(() => proofSiblings(rows), [rows])
  const box = useRef<HTMLDivElement>(null)
  const { width, covers } = proofRoom(room)
  const open = proof != null

  // The full page of the run the proof shows, among the change's models. Coming back, the proof is open on it again.
  const expand = (id: string) => {
    store.getState().openProof(id, store.getState().proof?.from ?? null)
    openRunAmong(id, siblings)
  }
  const latest = useRef({ rows, siblings, expand })
  latest.current = { rows, siblings, expand }
  useEffect(() => {
    // The open proof's own expand button knows the model it shows now, after J and K.
    const expandShown = () => {
      const button = box.current?.querySelector<HTMLElement>('[aria-label="Open the full page"]')
      const shown = store.getState().proof?.run
      if (button) button.click()
      else if (shown) latest.current.expand(shown)
    }
    const expandRun = (run: string | null) => {
      if (run != null) openRunAmong(run, latest.current.siblings)
      else expandShown()
    }
    keys.current = {
      press: (shift, from) => pressProof(store.getState(), latest.current.rows, shift, from, expandRun),
    }
    return () => {
      keys.current = null
    }
  }, [keys, store])

  // The graph keeps the room left of the proof, and frames there. A proof over the graph moves nothing under it.
  const placed = useRef(false)
  useEffect(() => {
    const covered = open && !covers ? width : 0
    if (!placed.current || reduced) {
      placed.current = true
      rig.proof.jump(covered)
      return
    }
    const playing = animate(rig.proof, covered, spring.sheet)
    return () => playing.stop()
  }, [covers, open, reduced, rig, width])

  // Closing gives the keyboard back to the control that opened it, or to the review.
  const opener = useRef<{ from: string | null } | null>(null)
  useEffect(() => {
    if (proof) {
      opener.current = { from: proof.from }
      return
    }
    const was = opener.current
    opener.current = null
    const review = root.current
    if (!was || !review) return
    const control = was.from ? controlOf(review, was.from) : null
    ;(control ?? review).focus({ preventScroll: true })
  }, [proof, root])

  // The frame's menu floats over the middle of the top: where it lies over the proof, the proof starts under it.
  const place = proofBox(canvas, room)

  return (
    <AnimatePresence>
      {proof ? (
        <motion.div
          key="proof"
          ref={box}
          data-rv-proof=""
          className={PROOF_BOX}
          style={proofBoxStyle(place)}
          initial={{ opacity: 0, transform: reduced ? 'translateX(0px)' : 'translateX(24px)' }}
          animate={{ opacity: 1, transform: 'translateX(0px)', transition: { transform: spring.sheet, opacity: tween.enter } }}
          exit={{ opacity: 0, transition: tween.exit }}
        >
          <Suspense fallback={<p className="px-5 pt-4 text-[13px] text-muted-foreground">Opening the proof…</p>}>
            <div className="min-h-0 flex-1">
              <ProofPanel run={proof.run} siblings={siblings} onClose={() => store.getState().closeProof()} onExpand={expand} />
            </div>
            <TakeKeyboard box={box} run={proof.run} />
          </Suspense>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Where the proof sits, as `proofRoom` places it at the right of a review `canvas` wide with `room` left of the review's
 * panel: its width, and whether it starts under the frame's menu, which floats over the middle of the top.
 */
export function proofBox(canvas: number, room: number): { width: number; under: boolean } {
  const { width, covers } = proofRoom(room)
  const shown = covers ? Math.max(0, Math.round(room)) : width
  const left = canvas - shown
  const menuRight = canvas / 2 + MENU.width / 2 + MENU.gap
  return { width: shown, under: left < menuRight }
}

/** The box's look, the same here and in a still render. */
export const PROOF_BOX = 'absolute top-0 right-0 bottom-0 z-[25] flex flex-col border-l border-border bg-background'
export const proofBoxStyle = ({ width, under }: { width: number; under: boolean }) => ({ width, paddingTop: under ? MENU.bottom - 14 : 0 })

/** Once the proof is drawn, and each time it opens on another run, it has the keyboard, so its keys work at once. */
function TakeKeyboard({ box, run }: { box: RefObject<HTMLElement | null>; run: string }) {
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[data-proof-panel]')?.focus({ preventScroll: true })
  }, [box, run])
  return null
}
