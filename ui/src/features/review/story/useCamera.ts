/**
 * The camera over the graph. It holds where the graph is looked at as motion values and writes them to
 * React Flow's viewport, so every camera move is one transform on one element.
 *
 * Purpose of the motion: explanation and spatial consistency. A step change is seen occasionally and is
 * the point of the story, so it travels (spring.travel, about 650ms). A second key press mid-flight
 * retargets the same springs from where they are, with the speed they have.
 */
import { animate, useMotionValue, useMotionValueEvent, useTransform, type AnimationPlaybackControls, type MotionValue, type Transition } from 'motion/react'
import { useMemo, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { spring } from '@/lib/motion.ts'
import type { WireCurve } from '../graph/wire-path.ts'
import { cameraFor, uncoveredArea, viewportFor, type Camera, type Cover, type Size, type Viewport } from './camera.ts'
import { rideOffset } from './travel.ts'

export interface Ride {
  curve: WireCurve
  reversed: boolean
}

export interface CameraRig {
  /** Where the graph sits right now. Overlays that follow the graph read this. */
  viewport: MotionValue<Viewport>
  /** How far along the current ride the camera is, 0 to 1. The pulse on the wire reads this. */
  progress: MotionValue<number>
  /** Pixels of the code panel on screen. The panel writes it and the uncovered area follows. */
  panel: MotionValue<number>
  /** Pixels of the steps panel on screen, at the left. Written by that panel. */
  side: MotionValue<number>
  ride(): Ride | null
  /** The part of the canvas nothing covers, for a code panel of the given height and a steps panel of the given width. */
  area(panelHeight?: number, sideWidth?: number): ReturnType<typeof uncoveredArea>
  setCanvas(size: Size, cover: Cover): void
  /** Moves the camera. `cut` places it without travel. */
  goTo(target: Camera, options?: { ride?: Ride | null; cut?: boolean; transition?: Transition }): void
  /** The reviewer moved the graph by hand: stop any travel and take the camera from where they left it. */
  takeFrom(viewport: Viewport): void
  current(): Camera
}

const close = (a: number, b: number, by = 0.01) => Math.abs(a - b) < by

export function useCamera(): CameraRig {
  const flow = useReactFlow()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const zoom = useMotionValue(1)
  const panel = useMotionValue(0)
  const side = useMotionValue(0)
  const progress = useMotionValue(1)
  // What is left of an interrupted ride's lean. It fades out so a retarget never jumps.
  const carry = useMotionValue(0)
  // The canvas and what floats over it. A motion value, so a resize moves the graph like any other camera change.
  const room = useMotionValue<{ canvas: Size; cover: Cover }>({ canvas: { width: 800, height: 600 }, cover: { top: 0, bottom: 0 } })
  const state = useRef({
    ride: null as Ride | null,
    carried: { x: 0, y: 0 },
    running: [] as AnimationPlaybackControls[],
  })

  const viewport = useTransform(() => {
    const { ride, carried } = state.current
    const { canvas, cover } = room.get()
    const lean = rideOffset(ride?.curve ?? null, ride?.reversed ?? false, progress.get())
    const fade = carry.get()
    const camera = { x: x.get() + lean.x + carried.x * fade, y: y.get() + lean.y + carried.y * fade, zoom: zoom.get() }
    return viewportFor(camera, uncoveredArea(canvas, { top: cover.top, bottom: cover.bottom + panel.get(), left: side.get() }))
  })

  useMotionValueEvent(viewport, 'change', (next) => {
    // Writing back what React Flow already has would only echo the reviewer's own pan.
    const now = flow.getViewport()
    if (close(now.x, next.x) && close(now.y, next.y) && close(now.zoom, next.zoom, 0.0005)) return
    void flow.setViewport(next)
  })

  return useMemo<CameraRig>(() => {
    const stop = () => {
      for (const animation of state.current.running) animation.stop()
      state.current.running = []
    }
    const area = (panelHeight = panel.get(), sideWidth = side.get()) => {
      const { canvas, cover } = room.get()
      return uncoveredArea(canvas, { top: cover.top, bottom: cover.bottom + panelHeight, left: sideWidth })
    }
    const leanNow = () => {
      const { ride, carried } = state.current
      const lean = rideOffset(ride?.curve ?? null, ride?.reversed ?? false, progress.get())
      return { x: lean.x + carried.x * carry.get(), y: lean.y + carried.y * carry.get() }
    }

    return {
      viewport,
      progress,
      panel,
      side,
      ride: () => state.current.ride,
      area,
      setCanvas: (canvas, cover) => room.set({ canvas, cover }),
      goTo: (target, { ride = null, cut = false, transition = spring.travel } = {}) => {
        const lean = leanNow()
        stop()
        if (cut) {
          state.current.ride = null
          state.current.carried = { x: 0, y: 0 }
          carry.jump(0)
          progress.jump(1)
          x.jump(target.x)
          y.jump(target.y)
          zoom.jump(target.zoom)
          return
        }
        // Keep the camera exactly where it is: what the old ride leaned by becomes an offset that fades away.
        state.current.carried = lean
        carry.jump(1)
        state.current.ride = ride
        progress.jump(ride ? 0 : 1)
        state.current.running = [
          animate(x, target.x, transition),
          animate(y, target.y, transition),
          animate(zoom, target.zoom, transition),
          animate(carry, 0, transition),
          ...(ride ? [animate(progress, 1, transition)] : []),
        ]
      },
      takeFrom: (next) => {
        stop()
        state.current.ride = null
        state.current.carried = { x: 0, y: 0 }
        carry.jump(0)
        progress.jump(1)
        const camera = cameraFor(next, area())
        x.jump(camera.x)
        y.jump(camera.y)
        zoom.jump(camera.zoom)
      },
      current: () => {
        const lean = leanNow()
        return { x: x.get() + lean.x, y: y.get() + lean.y, zoom: zoom.get() }
      },
    }
  }, [carry, panel, progress, room, side, viewport, x, y, zoom])
}
