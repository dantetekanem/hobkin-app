/**
 * Zones (spec 055): where a part of the code sits, in the words a person would use. A zone is a layer, what kind of
 * code it is, and a subject, what it is about, so it is finer than "the controllers":
 *
 *   app/controllers/admin/orders_controller.rb   controller · admin/order     "Controllers · Admin orders"
 *   ui/src/features/review/graph/NodeCard.tsx    ui: graph · review           "Window · review graph"
 *   host/src/review/vicinity-scan.ts             host: host · review          "Host · review"
 *   spec/requests/orders_spec.rb                 test:request · order         "Tests · Orders requests"
 *
 * The rules, in order: the component (a package, app or engine, or a top folder this kind of repository splits into);
 * one source root dropped (`app/javascript/`, `app/`, `src/`, `lib/` but not `lib/tasks/`); then the layer from the next
 * folder. A folder named by convention (controllers, models, jobs, views...) is a layer whose file names say the
 * subject, singular, with namespace folders kept. A feature folder is the subject, and its next folder the layer. Code
 * with no such folder is in its component's layer, its first folder the subject. A test takes the subject of the code
 * it mirrors, in the layer `test:<layer>`: a test folder such as `spec/requests/` names the layer, or else the code at
 * the path the test mirrors does. Pure: the same path always gives the same zone.
 */
import { isTestPath } from './triage.ts'
import type { Zone } from './types.ts'

/** Folders whose next folder is a package, app or engine of its own. */
const COMPONENT_HOMES = new Set(['packages', 'apps', 'engines', 'gems'])
/** Top folders that are a part of the repository by themselves, with the words for each. */
const TOPS: Record<string, string> = { host: 'Host', ui: 'Window', shared: 'Shared', server: 'Server', client: 'Client', web: 'Web', api: 'API', 'src-tauri': 'Native' }

/** Folders named by convention: each is a layer, and its files name their subject (`orders_controller.rb`: order). */
const NAMED: Record<string, string> = {
  controllers: 'controller',
  models: 'model',
  jobs: 'job',
  workers: 'job',
  sidekiq: 'job',
  mailers: 'mailer',
  views: 'view',
  helpers: 'helper',
  services: 'service',
  operations: 'service',
  interactors: 'service',
  serializers: 'presenter',
  presenters: 'presenter',
  decorators: 'presenter',
  policies: 'policy',
  channels: 'channel',
  graphql: 'graphql',
  resolvers: 'graphql',
  mutations: 'graphql',
  consumers: 'listener',
  subscribers: 'listener',
  listeners: 'listener',
  routes: 'route',
}
/** `commands` holds service objects in Ruby; elsewhere, as in this repository's `shared/commands`, it is a subject. */
const RUBY_NAMED: Record<string, string> = { commands: 'service' }
/** Folders of interface code: each is a layer, and the folder under it the subject. */
const PARTS: Record<string, string> = { components: 'component', hooks: 'hook', pages: 'page', stores: 'state', state: 'state' }

/** The source roots, as words for a file right under one. */
const ROOT_WORDS: Record<string, string> = { src: 'Source', lib: 'Library', app: 'App' }

const LAYER_WORDS: Record<string, string> = {
  controller: 'Controllers',
  model: 'Models',
  job: 'Jobs',
  mailer: 'Mailers',
  view: 'Views',
  helper: 'Helpers',
  service: 'Services',
  presenter: 'Presenters',
  policy: 'Policies',
  channel: 'Channels',
  graphql: 'GraphQL',
  listener: 'Listeners',
  route: 'Routes',
  task: 'Tasks',
  migration: 'Migrations',
  schema: 'Database',
  config: 'Config',
  component: 'Components',
  hook: 'Hooks',
  page: 'Pages',
  state: 'State',
}

/** Endings a conventional file name carries for its layer: `orders_controller`, `charge_order_job`. */
const NAMED_SUFFIX = /_(controller|job|worker|mailer|helper|serializer|presenter|decorator|policy|channel|service|operation|interactor|command|type|mutation|resolver|consumer|subscriber|listener)$/

const TEST_ROOTS = new Set(['test', 'tests', 'spec', 'specs', '__tests__'])
/** Folders under a test root that say what kind of test is in them, as a layer. */
const TEST_KINDS: Record<string, string> = {
  requests: 'request',
  request: 'request',
  system: 'system',
  integration: 'integration',
  e2e: 'e2e',
  controllers: 'controller',
  models: 'model',
  jobs: 'job',
  workers: 'job',
  mailers: 'mailer',
  helpers: 'helper',
  views: 'view',
  policies: 'policy',
  channels: 'channel',
  services: 'service',
  serializers: 'presenter',
  routing: 'route',
  support: 'support',
  factories: 'support',
  fixtures: 'support',
  shared_examples: 'support',
  shared_contexts: 'support',
}
/** `spec/features/` holds Ruby feature tests; a JavaScript `features/` folder holds the app's features. */
const RUBY_TEST_KINDS: Record<string, string> = { features: 'feature' }
/** How a test of each layer is said after its subject: "Orders requests", "Order model". The layer itself otherwise. */
const TEST_NOUNS: Record<string, string> = { request: 'requests', system: 'system', feature: 'features', integration: 'integration', e2e: 'end to end', route: 'routing' }

/** What the code rules make of a path, before it is a zone: `written` is the subject as the path spells it. */
interface Place {
  layer: string
  subject: string
  written: string
  /** A layer named by convention, whose files name the subject. */
  named: boolean
  label: string
}

const isRuby = (name: string) => /\.(rb|rake|erb)$/.test(name)
const extensionOf = (name: string) => /\.[^./]+$/.exec(name)?.[0] ?? ''

/** A file name without its extensions: `show.html.erb` is `show`, `NodeCard.test.tsx` is `NodeCard.test` then `NodeCard`. */
function stemOf(name: string): string {
  let stem = name.replace(/\.[^.]+$/, '')
  while (/.\.(html|erb|haml|slim|jbuilder|builder|test|spec|e2e|integration|d)$/.test(stem)) stem = stem.replace(/\.[^.]+$/, '')
  return stem || name
}

/** The last word made singular: `order_items` is `order_item`, `categories` is `category`, `addresses` is `address`. */
function singular(text: string): string {
  return text.replace(/([^_]+)$/, (word) => {
    if (/ies$/.test(word) && word.length > 4) return word.replace(/ies$/, 'y')
    if (/(ss|x|ch|sh|us)es$/.test(word)) return word.replace(/es$/, '')
    if (/(ss|us|is)$/.test(word) || !/s$/.test(word)) return word
    return word.replace(/s$/, '')
  })
}

/** A name as words: `NodeCard` is "node card", `vicinity-scan` is "vicinity scan", an all-capital word such as `README` stays. */
function words(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-/.]+/)
    .filter(Boolean)
    .map((word) => (word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word) ? word : word.toLowerCase()))
    .join(' ')
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const componentWords = (component: string) => TOPS[component] ?? sentence(words(component))

const conventionStem = (name: string) => stemOf(name).replace(NAMED_SUFFIX, '')

/** The subject the folders and file name under a conventional layer give, singular, with its namespace folders. */
function subjectUnder(layer: string, segments: readonly string[], stem = conventionStem): { subject: string; written: string } {
  const folders = segments.slice(0, -1).filter((folder) => folder !== 'concerns')
  // A view's file is an action of the resource its folder names: `orders/show.html.erb` is about orders.
  const parts = layer === 'view' && folders.length ? folders : [...folders, stem(segments.at(-1) ?? '')]
  const written = parts.join('/')
  const subject = layer === 'migration' || layer === 'config' || layer === 'schema' ? written : [...parts.slice(0, -1), singular(parts.at(-1)!)].join('/')
  return { subject, written }
}

/** A layer named by convention, and its subject from the folders and file name under it. */
function named(layer: string, segments: readonly string[], component: string | undefined, stem = conventionStem): Place {
  const { subject, written } = subjectUnder(layer, segments, stem)
  const head = component ? `${componentWords(component)} ${LAYER_WORDS[layer]!.toLowerCase()}` : LAYER_WORDS[layer]!
  return { layer, subject, written, named: true, label: `${head} · ${sentence(words(written))}` }
}

/** The code rules, for the path inside its component. */
function placeOf(component: string | undefined, rest: readonly string[]): Place {
  const name = rest.at(-1) ?? ''
  const head = component ? componentWords(component) : undefined
  if (rest[0] === 'config' && rest.length > 1) {
    if (rest.length === 2 && stemOf(name) === 'routes') return { layer: 'route', subject: 'routes', written: 'routes', named: true, label: head ? `${head} routes` : 'Routes' }
    return named('config', [name], component)
  }
  if (rest[0] === 'db' && rest.length > 1) {
    if (rest[1] === 'migrate' && rest.length > 2) return named('migration', [name], component, (file) => stemOf(file).replace(/^\d+_/, ''))
    return named('schema', [name], component, stemOf)
  }
  if (rest[0] === 'lib' && rest[1] === 'tasks' && rest.length > 2) return named('task', rest.slice(2), component)

  const root = rest[0] === 'app' && rest[1] === 'javascript' ? 2 : ['app', 'src'].includes(rest[0]!) || (rest[0] === 'lib' && rest[1] !== 'tasks') ? 1 : 0
  const inner = rest.slice(root)
  const first = inner[0]!
  if (inner.length > 1) {
    const layer = NAMED[first] ?? (isRuby(name) ? RUBY_NAMED[first] : undefined)
    if (layer) return named(layer, inner.slice(1), component)
    if (first === 'features' && inner.length > 2) {
      const feature = inner[1]!
      const layerOf = inner.length > 3 ? inner[2]! : 'feature'
      const said = `${words(feature)}${layerOf === 'feature' ? '' : ` ${words(layerOf)}`}`
      return { layer: layerOf, subject: feature, written: feature, named: false, label: `${head ?? 'Features'} · ${said}` }
    }
    const part = PARTS[first]
    if (part) {
      const subject = inner.length > 2 ? inner[1]! : first
      const flat = subject === first
      const label = head ? `${head} · ${flat ? words(first) : `${words(subject)} ${words(first)}`}` : flat ? LAYER_WORDS[part]! : `${LAYER_WORDS[part]} · ${words(subject)}`
      return { layer: part, subject, written: subject, named: false, label }
    }
  }
  if (component) {
    const subject = inner.length > 1 ? first : stemOf(name)
    return { layer: component, subject, written: subject, named: false, label: `${head} · ${words(subject)}` }
  }
  if (inner.length === 1) {
    const subject = stemOf(name)
    // A file right under a source root is in that root's layer: `src/total.js` is "Source · total".
    if (root && rest.length > 1) return { layer: rest[0]!, subject, written: subject, named: false, label: `${ROOT_WORDS[rest[0]!]} · ${words(subject)}` }
    return { layer: 'root', subject, written: subject, named: false, label: `Top level · ${words(subject)}` }
  }
  const subject = inner.length > 2 ? inner[1]! : stemOf(name)
  return { layer: first, subject, written: subject, named: false, label: `${sentence(words(first))} · ${words(subject)}` }
}

/** A test's zone: the kind its test folder names, or else the code at the path it mirrors, in a test layer. */
function testPlaceOf(component: string | undefined, rest: readonly string[]): Place {
  let mirrored = rest.filter((folder) => folder !== '__tests__')
  if (mirrored.length > 1 && TEST_ROOTS.has(mirrored[0]!)) mirrored = mirrored.slice(1)
  const name = mirrored.at(-1) ?? ''
  const untested = `${stemOf(name).replace(/_(test|spec)$/, '').replace(/^test_/, '')}${extensionOf(name)}`
  const tests = component ? `${componentWords(component)} tests` : 'Tests'
  const kind = mirrored.length > 1 ? (TEST_KINDS[mirrored[0]!] ?? (isRuby(name) ? RUBY_TEST_KINDS[mirrored[0]!] : undefined)) : undefined
  if (kind === 'support') return { layer: 'test:support', subject: 'support', written: 'support', named: false, label: `${tests} · support files` }
  if (kind) {
    const { subject, written } = subjectUnder(kind, [...mirrored.slice(1, -1), untested])
    return { layer: `test:${kind}`, subject, written, named: true, label: `${tests} · ${sentence(words(written))} ${TEST_NOUNS[kind] ?? kind}` }
  }
  const code = placeOf(component, [...mirrored.slice(0, -1), untested])
  // A test of code at the top says only what it is about: "Tests · total".
  const label = code.named
    ? `${tests} · ${sentence(words(code.written))} ${TEST_NOUNS[code.layer] ?? code.layer}`
    : code.layer === 'root'
      ? `Tests · ${words(code.subject)}`
      : `Tests · ${code.label.replace(' · ', ' ')}`
  return { ...code, layer: `test:${code.layer}`, label }
}

/**
 * The zone of a part of the code, from its path: a `test` kind puts any path in a test layer, as the scan does for a
 * helper in a test file. The symbol is taken so a caller can hand in a part as it holds it; no rule reads it, so every
 * part of a file is in the file's zone.
 */
export function zoneOf(path: string, kind?: string, _symbol?: string): Zone {
  const parts = path.replace(/^\.\//, '').split('/').filter(Boolean)
  const atHome = parts.length > 2 && COMPONENT_HOMES.has(parts[0]!)
  const atTop = !atHome && parts.length > 1 && parts[0]! in TOPS
  const component = atHome ? parts[1] : atTop ? parts[0] : undefined
  const rest = atHome ? parts.slice(2) : atTop ? parts.slice(1) : parts
  const place = kind === 'test' || isTestPath(path) ? testPlaceOf(component, rest) : placeOf(component, rest)
  return {
    id: `${component ?? '-'}/${place.layer}/${place.subject}`,
    layer: place.layer,
    subject: place.subject,
    ...(component ? { component } : {}),
    label: place.label,
  }
}
