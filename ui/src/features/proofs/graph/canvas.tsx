import { Handle, Position, ReactFlow, useNodesInitialized, useReactFlow, useStore, type Edge, type EdgeProps, type FitViewOptions, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { memo, useEffect, useMemo, useRef } from 'react'
import { useTheme } from '@/app/theme.ts'
import { moveCurve, type Curve } from './curves.ts'
import './graph.css'
import type { Point } from './layout.ts'
import type { EdgeLabel, Picture, PictureEdge, PictureNode } from './model.ts'
import { count } from './values.ts'

export type NodeMarks = {
  selected: boolean
  /** A search is on and this node holds none of what it found. */
  dim: boolean
  /** A search is on and this node holds what it found. */
  match: boolean
}

type StateData = { node: PictureNode } & NodeMarks
type MoveData = { edge: PictureEdge; dim: boolean }
type StateNode = Node<StateData, 'state'>
type MoveEdge = Edge<MoveData, 'move'>

/** Where moves attach, for a still render on the server: the middle of each side. In the window the handles say it. */
const handlesOf = (node: PictureNode): NonNullable<Node['handles']> => [
  { type: 'target', position: Position.Left, x: 0, y: node.height / 2 - 0.5, width: 1, height: 1 },
  { type: 'source', position: Position.Right, x: node.width - 1, y: node.height / 2 - 0.5, width: 1, height: 1 },
]

function StateNodeView({ data }: NodeProps<StateNode>) {
  const { node, selected, dim, match } = data
  return (
    <div
      className="pf-node"
      data-look={node.look}
      data-selected={selected}
      data-breaks={Boolean(node.breaks)}
      data-dim={dim}
      data-match={match}
      style={{ width: node.width, height: node.height }}
      title={node.aria}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {node.look === 'group' ? (
        <>
          <span className="max-w-full truncate px-3 font-mono text-[13px] leading-4">{node.text}</span>
          <span className="pf-count leading-3">{count(node.states.length)}</span>
        </>
      ) : node.look === 'ghost' ? (
        <span className="max-w-full truncate px-3 font-mono text-[11.5px] font-medium">{node.text}</span>
      ) : (
        <span className={node.width >= 40 ? 'text-[13px]' : 'text-[11px]'}>{node.text}</span>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
}

/** A mono label at 11px: each character 0.6em wide, so its box is known without measuring. */
const LINE = 16
const labelWidth = (labels: readonly EdgeLabel[]) => Math.max(...labels.map((label) => label.text.length)) * 6.6 + 12

function Labels({ labels, at }: { labels: readonly EdgeLabel[]; at: Point }) {
  const width = labelWidth(labels)
  const height = labels.length * LINE + 4
  return (
    <g className="pf-label" transform={`translate(${at.x} ${at.y})`}>
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={6} />
      {labels.map((label, index) => (
        <text key={label.text} data-breaks={label.breaks || undefined} textAnchor="middle" dominantBaseline="central" y={(index - (labels.length - 1) / 2) * LINE}>
          {label.text}
        </text>
      ))}
    </g>
  )
}

/** A small arrowhead at the end of a move, pointing the way it arrives. */
function arrowAt(curve: Curve, tip: Point): string {
  const [back, side] = [8, 4.5]
  const [cos, sin] = [Math.cos(curve.heading), Math.sin(curve.heading)]
  const base = { x: tip.x - back * cos, y: tip.y - back * sin }
  return `M${tip.x} ${tip.y}L${base.x - side * sin} ${base.y + side * cos}L${base.x + side * sin} ${base.y - side * cos}Z`
}

/** The path's labels sit over its states, clear of them: a path state is 44 high. */
const OVER_PATH = 36

function MoveEdgeView({ sourceX, sourceY, targetX, targetY, data }: EdgeProps<MoveEdge>) {
  if (!data) return null
  const { edge, dim } = data
  const [source, target] = [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ]
  const curve = moveCurve(source, target, edge.loop)
  const middle = curve.at(0.5)
  const level = Math.abs(source.y - target.y) < 1
  let label: Point | null = middle
  if (edge.look === 'near' || edge.labels.length === 0) label = null
  else if (edge.look === 'path' && level && target.x > source.x) label = { x: middle.x, y: middle.y - OVER_PATH }
  // A move the path did not take is named beside where it lands, on the far side from the path, as the design has it.
  else if (edge.look === 'side' && !level) label = { x: target.x - 14, y: target.y + (target.y < source.y ? -24 : 24) }
  return (
    <g className="pf-wire" data-look={edge.look} data-breaks={edge.breaks || undefined} data-dim={dim || undefined}>
      <path className="pf-move" d={curve.d} />
      {edge.look === 'group' ? <path className="pf-arrow" d={arrowAt(curve, target)} /> : null}
      {label ? <Labels labels={edge.labels} at={label} /> : null}
    </g>
  )
}

const nodeTypes = { state: memo(StateNodeView) }
const edgeTypes = { move: memo(MoveEdgeView) }
// React Flow is MIT, and its guide on attribution allows hiding the badge, as the review graph does.
const PRO_OPTIONS = { hideAttribution: true }
/** The canvas's size before the window measures it, so a still render on the server fits the picture too. */
const SEED = { width: 620, height: 420 }
const LOOKS_UNDER: Record<PictureEdge['look'], number> = { near: 0, side: 1, group: 2, path: 3 }

export interface GraphCanvasProps {
  picture: Picture
  positions: ReadonlyMap<string, Point>
  marks: (node: PictureNode) => NodeMarks
  /** The node to keep in view as the user steps. */
  focus: string | null
  fit: FitViewOptions
  still: boolean
  onPick: (node: PictureNode) => void
}

/**
 * The picture on a React Flow canvas: it pans by dragging and zooms by pinching, and the page keeps its own scroll.
 * States are picked with a click; the keyboard steps through the counterexample from the step bar.
 */
export function GraphCanvas({ picture, positions, marks, focus, fit, still, onPick }: GraphCanvasProps) {
  const theme = useTheme()
  const nodes = useMemo<StateNode[]>(
    () =>
      picture.nodes.map((node) => ({
        id: node.id,
        type: 'state',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: { node, ...marks(node) },
        width: node.width,
        height: node.height,
        handles: handlesOf(node),
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        ariaLabel: node.aria,
      })),
    [picture, positions, marks],
  )
  const dimmed = useMemo(() => new Set(nodes.filter((node) => node.data.dim).map((node) => node.id)), [nodes])
  const edges = useMemo<MoveEdge[]>(
    () =>
      [...picture.edges]
        .sort((a, b) => LOOKS_UNDER[a.look] - LOOKS_UNDER[b.look])
        .map((edge) => ({
          id: edge.id,
          type: 'move',
          source: edge.from,
          target: edge.to,
          data: { edge, dim: dimmed.has(edge.from) && dimmed.has(edge.to) },
          selectable: false,
          focusable: false,
        })),
    [picture, dimmed],
  )
  const focusBox = useMemo(() => {
    const node = picture.nodes.find((entry) => entry.id === focus)
    const at = focus ? positions.get(focus) : undefined
    return node && at ? { x: at.x, y: at.y, width: node.width, height: node.height } : null
  }, [picture, positions, focus])

  return (
    <ReactFlow<StateNode, MoveEdge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_event, node) => onPick(node.data.node)}
      width={SEED.width}
      height={SEED.height}
      fitView
      fitViewOptions={fit}
      minZoom={0.1}
      maxZoom={2}
      panOnDrag
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      preventScrolling={false}
      nodesDraggable={false}
      nodesConnectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      elementsSelectable={false}
      // The step bar's keys walk the counterexample. React Flow's would move nodes with the arrows.
      disableKeyboardA11y
      deleteKeyCode={null}
      selectionKeyCode={null}
      multiSelectionKeyCode={null}
      panActivationKeyCode={null}
      onlyRenderVisibleElements
      colorMode={theme}
      proOptions={PRO_OPTIONS}
      aria-label="The state graph"
    >
      <Camera focus={focusBox} fit={fit} still={still} />
    </ReactFlow>
  )
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Room left around a state the camera brings into view. */
const MARGIN = 28

/**
 * Fits the picture once its states are placed, then keeps the focused state in view as the user steps: when it would
 * leave the canvas, the camera slides to it at the same zoom, or jumps there under Still.
 */
function Camera({ focus, fit, still }: { focus: Box | null; fit: FitViewOptions; still: boolean }) {
  const flow = useReactFlow()
  const ready = useNodesInitialized()
  const width = useStore((state) => state.width)
  const height = useStore((state) => state.height)
  const fitted = useRef(false)
  const latest = useRef({ focus, width, height })
  latest.current = { focus, width, height }

  useEffect(() => {
    const keepInView = (duration: number) => {
      const { focus: box, width: across, height: down } = latest.current
      if (!box || !across) return
      const { x, y, zoom } = flow.getViewport()
      const [left, top] = [box.x * zoom + x, box.y * zoom + y]
      const [right, bottom] = [left + box.width * zoom, top + box.height * zoom]
      if (left >= MARGIN && top >= MARGIN && right <= across - MARGIN && bottom <= down - MARGIN) return
      void flow.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom, duration })
    }
    if (!ready || !width) return
    if (!fitted.current) {
      fitted.current = true
      void flow.fitView({ ...fit, duration: 0 }).then(() => keepInView(0))
      return
    }
    keepInView(still ? 0 : 280)
  }, [ready, width, flow, fit, focus, still])

  return null
}
