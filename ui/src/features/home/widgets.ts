import type { CustomBody, CustomWidget, HomeLayout, HomeModel, HomeWidget, WidgetKind } from './types.ts'

/** A custom widget with no weight of its own sits here: in the ambient band, just under the day's timeline. */
const DEFAULT_CUSTOM_WEIGHT = 140

/**
 * The widgets, in the order they fall to when nothing is urgent: what is happening now first, the day's shape next,
 * then the slower, retrospective cards. Urgency (below) lifts a widget above this; this only breaks ties and seeds a
 * default the user always sees in the same places.
 */
export const WIDGET_ORDER: readonly WidgetKind[] = [
  'running', 'upcoming', 'projects', 'connections', 'week', 'needs', 'problems',
]

type Model = Omit<HomeModel, 'widgets'>

/** Null means the widget does not apply at all and is left out (a connection the host has not looked at, no projects). */
type Score = number | null

const hasBad = (rows: { tone: string }[]) => rows.some(row => row.tone === 'bad')
const hasLoud = (rows: { tone: string }[]) => rows.some(row => row.tone === 'accent' || row.tone === 'bad' || row.tone === 'warn')

/**
 * How much each widget needs the user right now. A widget with waiting work or a fresh problem scores far above the
 * ambient cards, so it climbs to the top; an empty one sinks to the bottom but still shows its calm "all clear" state.
 */
function score(kind: WidgetKind, model: Model): Score {
  switch (kind) {
    case 'needs':
      return model.needs.rows.length ? 1000 + model.needs.rows.length + (hasLoud(model.needs.rows) ? 50 : 0) : 40
    case 'problems':
      return model.problems.rows.length ? 900 + model.problems.rows.length + (hasBad(model.problems.rows) ? 60 : 0) : 30
    case 'running':
      if (model.running.held) return 820
      if (model.running.rows.length) return 600 + model.running.rows.length
      return model.running.queue.length ? 220 : 70
    case 'connections': {
      if (!model.connections.known) return null
      // An integration's counts live in this widget, so what it says needs the user, or a server waiting for sign-in, lifts it.
      const needsUser = model.connections.tiles.some(tile => tile.tone === 'warn' || tile.tone === 'bad') || model.connections.lift > 0
      return needsUser ? 560 + model.connections.lift * 20 : 60
    }
    case 'upcoming':
      return model.upcoming.rows.some(row => row.tone === 'warn') ? 300 : 150
    case 'projects':
      if (!model.projects.rows.length) return null
      return hasLoud(model.projects.rows) ? 260 : 90
    case 'week':
      return 50
  }
}

const str = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** One custom widget's body, or null when it is not one of the three shapes the client can draw. */
function customBodyOf(value: unknown): CustomBody | null {
  if (!value || typeof value !== 'object') return null
  const body = value as Record<string, unknown>
  if (body.kind === 'stat' && str(body.value)) {
    return { kind: 'stat', value: body.value, ...(str(body.label) ? { label: body.label } : {}) }
  }
  if (body.kind === 'text' && str(body.text)) {
    return { kind: 'text', text: body.text }
  }
  if (body.kind === 'keyvalue' && Array.isArray(body.rows)) {
    const rows = body.rows
      .filter((row): row is { k: string; v: string } => !!row && typeof row === 'object' && str((row as Record<string, unknown>).k) && str((row as Record<string, unknown>).v))
      .map(row => ({ k: row.k, v: row.v }))
    return rows.length ? { kind: 'keyvalue', rows } : null
  }
  return null
}

/** One widget hobkin authored, or null when the spec is missing an id, a title or a body the client can draw. */
function customWidgetOf(value: unknown): CustomWidget | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const body = customBodyOf(raw.body)
  if (!str(raw.id) || !str(raw.title) || !body) return null
  const widget: CustomWidget = { id: raw.id, title: raw.title, body }
  if (typeof raw.weight === 'number' && Number.isFinite(raw.weight)) widget.weight = raw.weight
  if (str(raw.updatedAt)) widget.updatedAt = raw.updatedAt
  return widget
}

/** The custom widgets hobkin sent, validated and de-duplicated by id. Anything malformed is dropped, not thrown. */
export function customWidgetsOf(value: unknown): CustomWidget[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<string, CustomWidget>()
  for (const item of value) {
    const widget = customWidgetOf(item)
    if (widget && !byId.has(widget.id)) byId.set(widget.id, widget)
  }
  return [...byId.values()]
}

/** A validated external layout, or null for the client's own deterministic order. Untrusted shape in, so every kind is checked. */
export function layoutOf(value: unknown): HomeLayout | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const kinds = (field: unknown): WidgetKind[] =>
    Array.isArray(field) ? field.filter((k): k is WidgetKind => WIDGET_ORDER.includes(k as WidgetKind)) : []
  const order = kinds((value as Record<string, unknown>).order)
  const hidden = kinds((value as Record<string, unknown>).hidden)
  return order.length || hidden.length ? { order, hidden } : null
}

/** A widget with the seed that breaks ties: its place in the fixed order, custom widgets after the built-ins. */
interface Seeded {
  widget: HomeWidget
  seed: number
}

/**
 * The widgets to draw, most relevant first. The client ranks the built-ins by urgency so the dashboard moves itself as
 * state changes, and hobkin's own `custom` widgets join the same ranking by their weight (default: the ambient band).
 * An external `layout` (a future hobkin job) overrides the order of the built-in kinds and can hide them, and the
 * screen renders whatever comes back. Widgets that do not apply are left out whichever path is taken.
 */
export function orderWidgets(model: Model, layout: HomeLayout | null, custom: readonly CustomWidget[] = []): HomeWidget[] {
  const builtIn: Seeded[] = WIDGET_ORDER
    .map((kind, index) => ({ kind, weight: score(kind, model), seed: index }))
    .filter((widget): widget is { kind: WidgetKind; weight: number; seed: number } => widget.weight !== null)
    .filter(widget => !layout?.hidden.includes(widget.kind))
    .map(({ kind, weight, seed }) => ({ widget: { id: kind, kind, weight }, seed }))

  const customSeeded: Seeded[] = custom.map((spec, index) => ({
    widget: { id: `custom:${spec.id}`, kind: 'custom', weight: spec.weight ?? DEFAULT_CUSTOM_WEIGHT, custom: spec },
    seed: WIDGET_ORDER.length + index,
  }))

  const all = [...builtIn, ...customSeeded]
  const rank = layout?.order.length ? new Map(layout.order.map((kind, index) => [kind, index])) : null

  // Named kinds lead in the driver's order; everything else, custom widgets included, falls in by weight then seed.
  return all
    .toSorted((a, b) => {
      if (rank) {
        const ra = rank.get(a.widget.kind as WidgetKind) ?? Infinity
        const rb = rank.get(b.widget.kind as WidgetKind) ?? Infinity
        if (ra !== rb) return ra - rb
      }
      return b.widget.weight - a.widget.weight || a.seed - b.seed
    })
    .map(({ widget }) => widget)
}
