import { Background, BackgroundVariant, ReactFlow, ViewportPortal, useNodesState, useStore as useFlowStore, type Edge, type Node, type NodeMouseHandler, type OnMove } from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import './graph.css'
import { motion, useTransform } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import { NODE_SIZE } from '#shared/review/layout.ts'
import { useTheme } from '@/app/theme.ts'
import { useReduced, useRig, useSession, useSessionStore } from '../state/context.tsx'
import { pulsePoint } from '../story/travel.ts'
import { NodeCard } from './NodeCard.tsx'
import { TestList } from './TestList.tsx'
import { Wire } from './Wire.tsx'

const nodeTypes = { card: NodeCard }
const edgeTypes = { wire: Wire }
// The user asked for the badge in the corner to go. React Flow is MIT, and its guide on attribution allows hiding it.
const PRO_OPTIONS = { hideAttribution: true }
/** The whole graph of a wide change has to fit a narrow canvas, so the camera may pull far back. */
const ZOOM = { min: 0.08, max: 1.6 }
/** A dot every `gap` points of the graph, `size` pixels wide on screen. */
const DOTS = { gap: 32, size: 1.6 }
const fine = typeof matchMedia === 'function' ? matchMedia('(hover: hover) and (pointer: fine)') : null

/**
 * The graph: every node of the review in its column and every wire from a right pin to a left pin.
 * It pans by dragging and by two-finger scroll, and zooms by pinch and by Command with scroll.
 * It is a view of the review model: nodes can be moved, and nothing else about the graph can be changed here.
 */
export function Graph() {
  const store = useSessionStore()
  const rig = useRig()
  const viewNodes = useSession((session) => session.view.nodes)
  const viewEdges = useSession((session) => session.view.edges)
  // React Flow puts `light` or `dark` on its own root. Left alone it says `light`, which would bring the
  // light palette back inside the graph while the rest of the app is dark.
  const theme = useTheme()

  const placed = useMemo<Node[]>(
    () =>
      // In reading order, column by column, so the order on screen is the order in the document.
      [...viewNodes]
        .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
        .map((node) => ({ id: node.id, type: 'card', position: node.position, data: {}, ...NODE_SIZE[node.kind], selectable: false, focusable: false })),
    [viewNodes],
  )
  const edges = useMemo<Edge[]>(() => viewEdges.map((edge) => ({ id: edge.id, type: 'wire', source: edge.from, target: edge.to, selectable: false, focusable: false })), [viewEdges])
  const [nodes, setNodes, onNodesChange] = useNodesState(placed)
  useEffect(() => setNodes(placed), [placed, setNodes])

  const onNodeClick: NodeMouseHandler = (_event, node) => store.getState().focusOn(node.id)
  const onNodeDoubleClick: NodeMouseHandler = (_event, node) => void store.getState().openCode(node.id)
  // Hover counts only when the pointer itself moved. The camera carries nodes under a pointer at rest all
  // the time, and a touch fires a hover on tap: neither is the reviewer pointing at something.
  const pointerMoved = useRef(0)
  const onNodeMouseEnter: NodeMouseHandler = (_event, node) => {
    if (fine?.matches !== false && performance.now() - pointerMoved.current < 250) store.getState().hoverOn(node.id)
  }
  const onNodeMouseMove: NodeMouseHandler = (_event, node) => {
    if (fine?.matches === false) return
    pointerMoved.current = performance.now()
    store.getState().hoverOn(node.id)
  }
  const onNodeMouseLeave: NodeMouseHandler = () => store.getState().hoverOn(null)
  // The reviewer took the graph in hand. The camera stops where it is and follows them.
  const onMove: OnMove = (event, viewport) => {
    if (event) rig.takeFrom(viewport)
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseMove={onNodeMouseMove}
      onNodeMouseLeave={onNodeMouseLeave}
      onPaneMouseMove={() => (pointerMoved.current = performance.now())}
      onNodeDragStop={(_event, node) => store.getState().moveNode(node.id, node.position)}
      onEdgeClick={(_event, edge) => store.getState().openWire(edge.id)}
      onPaneClick={() => store.getState().openWire(null)}
      onMoveStart={onMove}
      onMove={onMove}
      minZoom={ZOOM.min}
      maxZoom={ZOOM.max}
      panOnDrag
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      // The review's own keys walk the story and the graph. React Flow's would move nodes with the arrows.
      disableKeyboardA11y
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      panActivationKeyCode={null}
      nodeDragThreshold={4}
      colorMode={theme}
      proOptions={PRO_OPTIONS}
      aria-label="The change as a graph"
    >
      <Dots />
      <Rider />
      <TestList />
    </ReactFlow>
  )
}

/**
 * Barely visible dots under the graph, for depth: they move and spread with it, keep their size on screen, and fade as
 * the camera pulls back and they crowd together. Their color is a token of the review (`--rv-dot`), for both themes.
 */
function Dots() {
  const zoom = useFlowStore((state) => state.transform[2])
  const apart = DOTS.gap * zoom
  const opacity = Math.min(1, Math.max(0.3, (apart - 6) / 18))
  return <Background variant={BackgroundVariant.Dots} gap={DOTS.gap} size={DOTS.size / zoom} color="var(--rv-dot)" style={{ opacity }} />
}

/**
 * The pulse that runs along the connecting wire, from the previous focus to the new one, with the camera
 * following it. It reads the camera's own progress, so the two cannot drift apart.
 */
function Rider() {
  const rig = useRig()
  const reduced = useReduced()
  const transform = useTransform(() => {
    const ride = rig.ride()
    if (!ride) return 'translate(0px, 0px)'
    const point = pulsePoint(ride.curve, ride.reversed, rig.progress.get())
    return `translate(${point.x}px, ${point.y}px)`
  })
  const opacity = useTransform(() => {
    const progress = rig.progress.get()
    // It fades in as it leaves and out as it lands, so it never pops.
    return rig.ride() ? Math.min(1, progress * 8, (1 - progress) * 8) : 0
  })
  if (reduced) return null
  return (
    <ViewportPortal>
      <motion.div className="rv-rider" style={{ transform, opacity }} />
    </ViewportPortal>
  )
}
