/**
 * Step 1, triage: what kind of change this is and what each part deserves, from metadata alone. File names, folders,
 * the type of change, line counts, the description and the commits decide what is read line by line later. Mass
 * deletions, translation batches, renames, lockfiles and generated files are never read: they get the checks that
 * matter more than their lines (FOUNDATION section 6, skills/change-triage).
 */
import type { Bucket, BucketCheck, BucketChange, BucketKind, ChangedFile, ChangeMeta, Claim, FileDiff, Mode, PlanStep, RepoReader, Treatment, Triage } from './types.ts'

// ───────────────────────── Paths ─────────────────────────

const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Gemfile\.lock|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|Podfile\.lock|mix\.lock|flake\.lock|packages\.lock\.json)$/
const VENDORED = /(^|\/)(vendor|third_party|third-party|node_modules|bower_components)\//
const SNAPSHOT = /(^|\/)__snapshots__\/|\.snap$/
const GENERATED = /(^|\/)(dist|build|out|generated|__generated__)\/|\.min\.(js|css)$|\.map$|\.pb\.go$|_pb2\.py$|\.generated\.[a-z]+$/
const ASSET = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|svg|woff2?|ttf|otf|eot|mp3|wav|ogg|mp4|mov|webm|pdf|zip|gz)$/i
const LOCALE_FOLDER = /(^|\/)(locales?|i18n|lang|langs|translations?)\//
const LOCALE_FILE = /\.(po|pot|xliff|xlf|arb|strings)$|(^|\/)res\/values-[^/]+\/strings\.xml$/
const TEST = /(^|\/)(test|tests|spec|specs|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|_(test|spec)\.rb$|(^|\/)test_[^/]+\.py$|_test\.py$|_test\.go$/
const MIGRATION = /(^|\/)db\/(migrate|data)\/|(^|\/)migrations?\/|(^|\/)db\/(schema\.rb|structure\.sql)$|(^|\/)schema\.prisma$/
const DEPENDENCY = /(^|\/)(Gemfile|package\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.py|setup\.cfg|go\.mod|Cargo\.toml|composer\.json|Podfile|mix\.exs|build\.gradle(\.kts)?|pom\.xml|[^/]+\.gemspec|[^/]+\.csproj)$/
/** Agent instructions change what an agent does, so they are read like configuration, not skipped like prose. */
const AGENT_TEXT = /(^|\/)(prompts?|skills?)\/.+\.md$|(^|\/)(SKILL|AGENTS|CLAUDE|GEMINI)\.md$/
const DOCS = /\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(docs?|documentation)\/|(^|\/)(LICENSE|CHANGELOG|README|NOTICE|AUTHORS|CONTRIBUTING)(\.[a-z]+)?$/i
const CONFIG = /(^|\/)config\/|(^|\/)\.github\/workflows\/|(^|\/)\.[^/]*rc(\.[a-z]+)?$|\.(ya?ml|toml|ini|env|properties|conf)$|\.conf\.json$|(^|\/)(Dockerfile|docker-compose[^/]*|Procfile|Makefile|tsconfig[^/]*\.json)$|(^|\/)[^/]+\.config\.[cm]?[jt]s$/
/** Words in a path that make a folder the one to read first among identical sites. */
const SENSITIVE = /money|price|amount|tax|pay|charge|refund|billing|invoice|auth|password|token|secret|session|permission|tenant|account/i

/** A locale code as a path segment or file stem: `en`, `pt-BR`, `zh_Hant`. */
const LOCALE_CODE = /^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/

/** A lockfile, which a package manager writes: `pnpm-lock.yaml`, `Gemfile.lock`, `go.sum`. */
export const isLockfile = (path: string): boolean => LOCKFILE.test(path)

/** A test file by its path: a test folder, or a test's name such as `orders_spec.rb` or `cart.test.ts`. */
export const isTestPath = (path: string): boolean => TEST.test(path)

interface Kinded {
  kind: BucketKind
  treatment: Treatment
  why: string
}

/** What one file is, from its path and status alone. First match wins. */
export function classify(file: ChangedFile): Kinded {
  const { path } = file
  if (ASSET.test(path)) return { kind: 'asset', treatment: 'skip', why: 'images, fonts and media are counted' }
  if (file.binary) return { kind: 'other', treatment: 'skip', why: 'binary files are counted' }
  if (LOCKFILE.test(path)) return { kind: 'dependency', treatment: 'skip', why: 'lockfile' }
  if (VENDORED.test(path)) return { kind: 'generated', treatment: 'skip', why: 'vendored code is counted' }
  if (SNAPSHOT.test(path)) return { kind: 'generated', treatment: 'skip', why: 'test snapshots are counted' }
  if (GENERATED.test(path)) return { kind: 'generated', treatment: 'skip', why: 'generated files are counted' }
  if (isPureRename(file)) return { kind: kindOfPath(path), treatment: 'skip', why: 'pure renames: old to new listed, references to the old path checked' }
  if (localeOf(path)) return { kind: 'translation', treatment: 'sample', why: 'one locale read in full, every other checked for every key' }
  return { kind: kindOfPath(path), treatment: treatmentOf(kindOfPath(path)), why: whyOf(kindOfPath(path)) }
}

function kindOfPath(path: string): BucketKind {
  if (TEST.test(path)) return 'test'
  if (MIGRATION.test(path)) return 'migration'
  if (DEPENDENCY.test(path)) return 'dependency'
  if (AGENT_TEXT.test(path)) return 'config'
  if (DOCS.test(path)) return 'docs'
  if (CONFIG.test(path)) return 'config'
  return 'code'
}

function treatmentOf(kind: BucketKind): Treatment {
  if (kind === 'test') return 'tests'
  if (kind === 'docs' || kind === 'asset' || kind === 'generated' || kind === 'other') return 'skip'
  return 'scan'
}

const WHY: Partial<Record<BucketKind, string>> = {
  code: 'production code, read line by line',
  test: 'tests, read as proof for the code they run',
  migration: 'schema change: always a unit of its own',
  config: 'takes effect at load or deploy: always a unit of its own',
  dependency: 'dependency change: always a unit of its own',
  docs: 'documentation is counted',
}
const whyOf = (kind: BucketKind) => WHY[kind] ?? 'counted'

const isPureRename = (file: ChangedFile) => file.status === 'renamed' && (file.similarity === 100 || (file.added === 0 && file.deleted === 0))

/**
 * A translation file's locale and the set it belongs to: every locale of `config/locales/*.yml`, or of
 * `locales/*\/common.json`, is one set. Null when the path is not a translation.
 */
export function localeOf(path: string): { locale: string; set: string } | null {
  if (!LOCALE_FOLDER.test(path) && !LOCALE_FILE.test(path)) return null
  const parts = path.split('/')
  const name = parts.at(-1)!
  const stem = name.replace(/\.[^.]+$/, '')
  // `en.yml`, `pt-BR.json`, and Rails' `devise.en.yml`.
  const fileLocale = LOCALE_CODE.test(stem) ? stem : stem.split('.').at(-1)!
  const localeLedByName = LOCALE_CODE.test(fileLocale) && fileLocale !== stem.split('.')[0]
  if (localeLedByName || LOCALE_CODE.test(stem)) {
    const localeInName = new RegExp(`(^|\\.)${escapeRegex(fileLocale)}(\\.[^.]+)$`)
    return { locale: fileLocale, set: [...parts.slice(0, -1), name.replace(localeInName, '$1*$2')].join('/') }
  }
  // `locales/en/common.json`: the locale is a folder.
  const at = parts.slice(0, -1).findIndex((part, index) => index > 0 && LOCALE_CODE.test(part) && LOCALE_FOLDER.test(`${parts.slice(0, index).join('/')}/`))
  if (at > 0) return { locale: parts[at]!, set: parts.map((part, index) => (index === at ? '*' : part)).join('/') }
  if (LOCALE_FILE.test(path)) return { locale: stem, set: path }
  return null
}

/** Names languages by their code, and names nothing for a word that only looks like one, such as `app` or `ui`. */
const LANGUAGES = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' })

/** Whether a locale code names a real language: `en`, `pt-BR` and `zh_Hant` do; `app` and `common` do not. */
export function isLanguageCode(code: string): boolean {
  if (!LOCALE_CODE.test(code)) return false
  try {
    return LANGUAGES.of(code.replace('_', '-')) !== undefined
  } catch {
    return false
  }
}

/** The English source of a set of translations: `en`, `en-GB`, `en_US`. */
export const isEnglish = (code: string) => /^en([-_]|$)/i.test(code)

/** A translation of the English source: a file read as a locale whose code is a real language other than English. */
export function isTranslation(path: string): boolean {
  const locale = localeOf(path)?.locale
  return locale != null && isLanguageCode(locale) && !isEnglish(locale)
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.')

/** The longest folder every path shares, or `.`. */
function commonFolder(paths: readonly string[]): string {
  const folders = paths.map((path) => dirOf(path).split('/'))
  const first = folders[0] ?? ['.']
  let length = first.length
  for (const folder of folders) {
    let same = 0
    while (same < Math.min(length, folder.length) && folder[same] === first[same]) same += 1
    length = same
  }
  return length ? first.slice(0, length).join('/') : '.'
}

// ───────────────────────── Removal, ports, mechanical repeats ─────────────────────────

/** FOUNDATION section 13: a folder whose deletions are ten times its additions is a removal bucket. */
const REMOVAL_RATIO = 10
const deletionHeavy = (file: ChangedFile) => file.status === 'deleted' || file.deleted >= REMOVAL_RATIO * Math.max(file.added, 1)

/**
 * Files never read line by line because they go away: every deleted file, and every file of a folder whose changed
 * files are all mostly deletions. The folder named is the deepest one they share, so it says what was removed.
 */
function removalGroups(files: readonly ChangedFile[]): Map<string, string> {
  const group = new Map<string, string>()
  const byFolder = new Map<string, ChangedFile[]>()
  for (const file of files) {
    for (let folder = dirOf(file.path); ; folder = dirOf(folder)) {
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), file])
      if (folder === '.') break
    }
  }
  // Shallowest first, so a removed folder is taken whole before its subfolders are looked at.
  const folders = [...byFolder.keys()].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
  for (const folder of folders) {
    const inside = byFolder.get(folder)!.filter((file) => !group.has(file.path))
    if (inside.length < 2 || !inside.every(deletionHeavy)) continue
    const added = inside.reduce((sum, file) => sum + file.added, 0)
    const deleted = inside.reduce((sum, file) => sum + file.deleted, 0)
    if (deleted < REMOVAL_RATIO * Math.max(added, 1)) continue
    const root = commonFolder(inside.map((file) => file.path))
    for (const file of inside) group.set(file.path, root)
  }
  for (const file of files) if (file.status === 'deleted' && !group.has(file.path)) group.set(file.path, dirOf(file.path))
  return group
}

const PORT_MIN_MATCHES = 5
const languageOf = (path: string) => path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ''
const stemOf = (path: string) => path.split('/').at(-1)!.replace(/(_test|_spec|\.test|\.spec)?\.[^.]+$/, '')

/** One language's tree deleted while another's is added with matching names: a port, checked by test parity first. */
function portedPaths(files: readonly ChangedFile[]): Set<string> {
  const deleted = files.filter((file) => file.status === 'deleted')
  const added = files.filter((file) => file.status === 'added')
  const ported = new Set<string>()
  for (const from of new Set(deleted.map((file) => languageOf(file.path)))) {
    for (const to of new Set(added.map((file) => languageOf(file.path)))) {
      if (!from || !to || from === to) continue
      const old = deleted.filter((file) => languageOf(file.path) === from)
      const fresh = added.filter((file) => languageOf(file.path) === to)
      const names = new Set(fresh.map((file) => stemOf(file.path)))
      const matched = old.filter((file) => names.has(stemOf(file.path)))
      if (matched.length < PORT_MIN_MATCHES || matched.length * 2 < old.length) continue
      const stems = new Set(matched.map((file) => stemOf(file.path)))
      for (const file of [...old, ...fresh]) if (stems.has(stemOf(file.path))) ported.add(file.path)
    }
  }
  return ported
}

const MECHANICAL_MIN_FILES = 3
const SITES_READ = 3
const IDENTIFIER = /[A-Za-z_$][\w$]*[?!]?/g

/**
 * A hunk with the one name it renames replaced by placeholders, or null when it changes more than one name.
 * Two hunks are the same edit when these agree exactly; anything else in them that differs leaves them apart.
 */
function normalizedHunk(lines: readonly string[]): string | null {
  const removed = lines.filter((line) => line.startsWith('-')).map((line) => line.slice(1).trim())
  const added = lines.filter((line) => line.startsWith('+')).map((line) => line.slice(1).trim())
  if (!removed.length || removed.length !== added.length) return null
  const names = (texts: readonly string[]) => new Set(texts.flatMap((text) => text.match(IDENTIFIER) ?? []))
  const before = names(removed)
  const after = names(added)
  const gone = [...before].filter((name) => !after.has(name))
  const came = [...after].filter((name) => !before.has(name))
  if (gone.length !== 1 || came.length !== 1) return null
  const swap = (text: string, name: string, mark: string) => text.replace(new RegExp(`(?<![\\w$])${escapeRegex(name)}(?![\\w$])`, 'g'), mark)
  return [...removed.map((text) => `-${swap(text, gone[0]!, '⟨old⟩')}`), ...added.map((text) => `+${swap(text, came[0]!, '⟨new⟩')}`)].join('\n')
}

/** Files whose every hunk is the same edit after normalizing the changed name, three or more to a group. */
function mechanicalGroups(diffs: readonly FileDiff[], eligible: ReadonlySet<string>): string[][] {
  const bySignature = new Map<string, string[]>()
  for (const diff of diffs) {
    if (!eligible.has(diff.path) || !diff.hunks.length) continue
    const shapes = new Set(diff.hunks.map((hunk) => normalizedHunk(hunk.lines)))
    if (shapes.size !== 1 || shapes.has(null)) continue
    const signature = [...shapes][0]!
    bySignature.set(signature, [...(bySignature.get(signature) ?? []), diff.path])
  }
  return [...bySignature.values()].filter((paths) => paths.length >= MECHANICAL_MIN_FILES).map((paths) => paths.toSorted())
}

/** The three sites read in a mechanical bucket: the first, the last and the one in the most sensitive folder. */
function sitesToRead(paths: readonly string[]): string[] {
  const sorted = paths.toSorted()
  const sensitive = sorted.find((path) => SENSITIVE.test(path) && path !== sorted[0] && path !== sorted.at(-1))
  const middle = sorted[Math.floor(sorted.length / 2)]!
  return [...new Set([sorted[0]!, sorted.at(-1)!, sensitive ?? middle])].slice(0, SITES_READ)
}

// ───────────────────────── Claims ─────────────────────────

const CLAIM = /\b(behind|flag|feature|no behaviou?r change|does(n't| not) change|unchanged|only (affects|changes|touches)|no (callers|users|longer used)|unused|dead code|backwards? compatible|safe to|tested|test plan|covered by|roll ?out|ramp|backfill|migrat\w*|refactor\w*|renam\w*|no functional change|pure (refactor|rename|move))\b/i
const DIRECTIVE = /\b(ignore|disregard|skip (the )?(review|tests?|checks?)|do(n't| not) (review|check|read)|approve (this|it|the)|merge (this|it) (now|quickly|without)|lgtm|you (must|should) (approve|merge|ignore)|as an ai|system prompt|previous instructions)\b/i
const FLAG = /\bbehind\s+(the\s+)?(feature\s+)?(flag|[:`'"]?[a-z][\w.-]*)|feature[- ]flag|\bflipper\b|\bflag(ged)?\b/i

/** Sentences, one per line or bullet, split again where one sentence ends and the next begins. */
function sentencesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*([-*+]|\d+[.)])\s+/, '').trim())
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8 && sentence.length <= 300)
}

/** What the description and commits say: claims to check, never instructions. Orders aimed at a reviewer are findings. */
function claimsOf(meta: ChangeMeta): { claims: Claim[]; directives: string[]; flagged: boolean } {
  const claims: Claim[] = []
  const directives: string[] = []
  const said = new Set<string>()
  const pull = meta.description.source === 'pull-request'
  const take = (text: string, source: string, always = false) => {
    for (const sentence of sentencesOf(text)) {
      if (DIRECTIVE.test(sentence)) {
        if (!directives.includes(sentence)) directives.push(sentence)
        continue
      }
      if ((always || CLAIM.test(sentence)) && !said.has(sentence)) {
        said.add(sentence)
        claims.push({ text: sentence, source, status: 'unchecked' })
      }
    }
  }
  if (meta.description.title) take(meta.description.title, pull ? 'PR title' : 'description title', true)
  if (meta.description.body) take(meta.description.body, pull ? 'PR description' : 'description')
  for (const commit of meta.commits) take([commit.subject, commit.body ?? ''].join('\n'), `commit ${commit.sha.slice(0, 7)}`)
  const words = [meta.description.title, meta.description.body, ...meta.commits.flatMap((commit) => [commit.subject, commit.body])].filter(Boolean).join('\n')
  return { claims, directives, flagged: FLAG.test(words) }
}

// ───────────────────────── Plan ─────────────────────────

const clamp = (value: number, low: number, high: number) => Math.round(Math.min(high, Math.max(low, value)))

/** Napkin estimates from reference/budget.md, scaled by what the buckets hold. Measured times replace them as the review runs. */
function planOf(buckets: readonly Bucket[], files: number): Triage['plan'] {
  const scanned = buckets.filter((bucket) => bucket.treatment === 'scan').reduce((sum, bucket) => sum + bucket.added + bucket.deleted, 0)
  const definitions = scanned ? clamp(scanned / 25, 1, 200) : 0
  const queued = Math.ceil(definitions * 0.4)
  const units = clamp(Math.ceil(definitions / 3), definitions ? 1 : 0, 9) + buckets.filter((bucket) => ['sample', 'removal', 'parity'].includes(bucket.treatment)).length
  const steps: PlanStep[] = [
    { id: 'triage', estimate_seconds: clamp(5 + files * 0.05, 5, 20) },
    { id: 'map-search', estimate_seconds: definitions ? clamp(10 + definitions * 0.5, 10, 120) : 5 },
    { id: 'map-proof', estimate_seconds: definitions ? clamp(60 + definitions * 15, 60, 1800) : 1, note: 'the repository’s own tests, at head and with each changed definition undone' },
    { id: 'risk-floor', estimate_seconds: 1 },
    { id: 'risk-model', estimate_seconds: clamp(30 + queued * 15, 30, 600), units: queued },
    { id: 'shape', estimate_seconds: clamp(10 + definitions * 0.2, 10, 30) },
    { id: 'story', estimate_seconds: clamp(60 + units * 5, 60, 120), units },
    { id: 'blind-check', estimate_seconds: 20 },
  ]
  return {
    steps,
    estimate_seconds: steps.reduce((sum, step) => sum + step.estimate_seconds, 0),
    machine_seconds: steps.find((step) => step.id === 'map-proof')!.estimate_seconds,
    reading_minutes: Math.max(1, Math.round(units * 1.2 * 10) / 10),
  }
}

// ───────────────────────── Triage ─────────────────────────

interface Placed {
  file: ChangedFile
  kinded: Kinded
  /** Files that share a key share a bucket. */
  key: string
  folder: string
  sample?: Bucket['sample']
}

const ORDER: Treatment[] = ['scan', 'tests', 'sample', 'removal', 'parity', 'skip']
/** Production code first, then its tests, then what is always its own unit. */
const KIND_ORDER: BucketKind[] = ['code', 'test', 'migration', 'config', 'dependency', 'translation', 'generated', 'docs', 'asset', 'other']

const changeOf = (files: readonly ChangedFile[]): BucketChange => {
  const statuses = new Set(files.map((file) => (file.status === 'copied' ? 'added' : file.status)))
  return statuses.size === 1 ? ([...statuses][0] as BucketChange) : 'mixed'
}

/**
 * Sorts a change into buckets, picks its mode, lists its claims and plans the review, without reading a source line.
 * `diffs`, when given, lets identical edits across many files be read three times instead of every time.
 */
export function triage(meta: ChangeMeta, { diffs = [] }: { diffs?: readonly FileDiff[] } = {}): Triage {
  const ported = portedPaths(meta.files)
  const removed = removalGroups(meta.files.filter((file) => !ported.has(file.path) && classify(file).treatment !== 'skip'))
  const placed: Placed[] = meta.files.map((file) => {
    const kinded = classify(file)
    if (ported.has(file.path)) {
      const side = file.status === 'deleted' ? 'old' : 'new'
      const ported: Kinded = {
        kind: kinded.kind === 'test' ? 'test' : 'code',
        treatment: 'parity',
        why: `port to another language: the ${side} tree, checked by test parity first`,
      }
      return { file, kinded: ported, key: `parity:${side}`, folder: '' }
    }
    if (removed.has(file.path)) {
      const folder = removed.get(file.path)!
      const gone: Kinded = { kind: kinded.kind, treatment: 'removal', why: 'removed: checked for what still refers to it, never read' }
      return { file, kinded: gone, key: `removal:${folder}`, folder }
    }
    const locale = kinded.kind === 'translation' ? localeOf(file.path) : null
    if (locale) return { file, kinded, key: `translation:${locale.set}`, folder: '' }
    return { file, kinded, key: `${kinded.kind}:${kinded.treatment}:${dirOf(file.path)}`, folder: dirOf(file.path) }
  })

  // Identical edits across files: read three, count the rest.
  const eligible = new Set(placed.filter((entry) => entry.kinded.treatment === 'scan' && entry.kinded.kind === 'code').map((entry) => entry.file.path))
  for (const [index, paths] of mechanicalGroups(diffs, eligible).entries()) {
    const read = sitesToRead(paths)
    for (const entry of placed.filter((candidate) => paths.includes(candidate.file.path))) {
      entry.kinded = {
        kind: 'code',
        treatment: 'sample',
        why: `${paths.length} files with the same edit once the changed name is normalized: ${read.length} read, the rest counted`,
      }
      entry.key = `mechanical:${index}`
      entry.sample = { read, trusted: paths.length - read.length }
    }
  }

  const groups = new Map<string, Placed[]>()
  for (const entry of placed) groups.set(entry.key, [...(groups.get(entry.key) ?? []), entry])
  const buckets = [...groups.values()]
    .map((entries): Omit<Bucket, 'id'> => {
      const files = entries.map((entry) => entry.file)
      const paths = files.map((file) => file.path).toSorted()
      const { kind, treatment, why } = entries[0]!.kinded
      let sample = entries[0]!.sample
      if (kind === 'translation' && treatment === 'sample') {
        const read = paths.find((path) => isEnglish(localeOf(path)?.locale ?? '')) ?? paths[0]!
        sample = { read: [read], trusted: paths.length - 1, parity_check: `key set and interpolation variables against ${read}` }
      }
      return {
        folder: entries[0]!.folder || commonFolder(paths),
        kind,
        change: changeOf(files),
        paths,
        files: files.length,
        added: files.reduce((sum, file) => sum + file.added, 0),
        deleted: files.reduce((sum, file) => sum + file.deleted, 0),
        treatment,
        why,
        ...(sample ? { sample } : {}),
      }
    })
    .sort(
      (a, b) =>
        ORDER.indexOf(a.treatment) - ORDER.indexOf(b.treatment) ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.folder.localeCompare(b.folder),
    )
    .map((bucket, index) => ({ id: `b${index + 1}`, ...bucket }))

  const { claims, directives, flagged } = claimsOf(meta)
  const description_source = meta.description.source === 'commits' && !meta.commits.length ? 'none' : meta.description.source
  return {
    schema: 'review-triage/1',
    range: meta.range,
    mode: modeOf(buckets, flagged),
    description_source,
    totals: {
      files: meta.files.length,
      added: meta.files.reduce((sum, file) => sum + file.added, 0),
      deleted: meta.files.reduce((sum, file) => sum + file.deleted, 0),
    },
    buckets,
    claims,
    ...(directives.length ? { directives } : {}),
    plan: planOf(buckets, meta.files.length),
  }
}

/**
 * The treatment holding the most changed lines sets the mode. A code change that comes with a translation batch or a
 * removal is `mixed`, because each part is reviewed its own way.
 */
function modeOf(buckets: readonly Bucket[], flagged: boolean): Mode {
  const lines = (treatments: Treatment[]) => buckets.filter((bucket) => treatments.includes(bucket.treatment)).reduce((sum, bucket) => sum + bucket.added + bucket.deleted, 0)
  const has = (treatments: Treatment[]) => buckets.some((bucket) => treatments.includes(bucket.treatment))
  const change: Mode = flagged ? 'flagged-change' : 'unflagged-change'
  if (has(['scan', 'tests']) && has(['sample', 'removal'])) return 'mixed'
  const held: [Mode, number][] = [
    ['port', has(['parity']) ? lines(['parity']) || 1 : 0],
    [change, has(['scan', 'tests']) ? lines(['scan', 'tests']) || 1 : 0],
    ['removal', has(['removal']) ? lines(['removal']) || 1 : 0],
    ['bulk', has(['sample']) ? lines(['sample']) || 1 : 0],
  ]
  const [mode, most] = held.reduce((best, entry) => (entry[1] > best[1] ? entry : best))
  return most > 0 ? mode : 'bulk'
}

// ───────────────────────── Checks that replace reading ─────────────────────────

/**
 * Runs the checks that matter more than a bucket's lines: every expected locale has every key the read locale gained,
 * with the same interpolation variables; nothing that remains refers to what was removed or renamed away. A check
 * that cannot run says so with `passed: null`, and the worse case is assumed.
 */
export async function checkBuckets(result: Triage, reader: RepoReader, meta: Pick<ChangeMeta, 'base' | 'head' | 'files'>): Promise<Triage> {
  const buckets: Bucket[] = []
  for (const bucket of result.buckets) {
    let checks: BucketCheck[] | undefined
    if (bucket.kind === 'translation' && bucket.treatment === 'sample') checks = await localeChecks(bucket, reader, meta)
    else if (bucket.treatment === 'removal') checks = await removalChecks(bucket, reader, meta)
    else if (bucket.change === 'renamed' && bucket.treatment === 'skip') checks = await renameChecks(bucket, reader, meta)
    buckets.push(checks ? { ...bucket, checks } : bucket)
  }
  return { ...result, buckets }
}

/** Any of these words standing alone: not part of a longer name. Works for `git grep -E` and JavaScript alike. */
const wholeWord = (texts: readonly string[]) => `(^|[^A-Za-z0-9_])(${texts.map(escapeRegex).join('|')})($|[^A-Za-z0-9_])`

async function localeChecks(bucket: Bucket, reader: RepoReader, { base, head }: Pick<ChangeMeta, 'base' | 'head'>): Promise<BucketCheck[]> {
  const readPath = bucket.sample?.read[0] ?? bucket.paths[0]!
  const set = localeOf(readPath)
  if (!set) return [{ name: 'locales', passed: null, detail: `could not tell the locale of ${readPath}` }]
  const inSet = (path: string) => localeOf(path)?.set === set.set
  const folder = set.set.split('/*')[0]!.replace(/\/[^/]*\*.*$/, '').replace(/\/$/, '') || dirOf(readPath)
  const atHead = (await reader.list(head, folder)).filter(inSet)
  const atBase = (await reader.list(base, folder)).filter(inSet)
  const readKeys = keysOf(readPath, await reader.text(head, readPath))
  if (!readKeys) return [{ name: 'locales', passed: null, detail: `could not read the keys of ${readPath}` }]
  const before = keysOf(readPath, await reader.text(base, readPath)) ?? new Map<string, string>()
  const gained = [...readKeys.keys()].filter((key) => !before.has(key))
  const checks: BucketCheck[] = []
  for (const path of atBase.filter((path) => !atHead.includes(path))) {
    checks.push({ name: 'locale present', passed: false, breaks: true, detail: `${path} is gone at head` })
  }
  for (const path of [...new Set([...atHead, ...bucket.paths.filter(inSet)])].filter((path) => path !== readPath).toSorted()) {
    const keys = keysOf(path, await reader.text(head, path))
    if (!keys) {
      checks.push({ name: `locale ${localeOf(path)?.locale ?? path}`, passed: null, detail: `could not read the keys of ${path}` })
      continue
    }
    const problems: string[] = []
    const missing = gained.filter((key) => !keys.has(key))
    if (missing.length) problems.push(`${path} lacks ${missing.join(', ')}`)
    for (const key of gained.filter((key) => keys.has(key))) {
      const want = variablesOf(readKeys.get(key)!)
      const have = variablesOf(keys.get(key)!)
      if (want.join() !== have.join()) {
        problems.push(`${path}: ${key} has ${have.join(' ') || 'no variables'} where ${readPath} has ${want.join(' ') || 'none'}`)
      }
    }
    checks.push({
      name: `locale ${localeOf(path)?.locale ?? path}`,
      passed: problems.length === 0,
      ...(problems.length ? { breaks: true } : {}),
      detail: problems.join('; ') || `${path} has all ${gained.length} keys ${readPath} gained`,
    })
  }
  return checks
}

/** The variable written the way its syntax writes it: `%{name}`, `{{name}}`, `%(name)` or `{name}`. */
function variableSpelling(matched: string, name: string | undefined): string {
  if (matched.startsWith('%{')) return `%{${name}}`
  if (matched.startsWith('{{')) return `{{${name}}}`
  if (matched.startsWith('%(')) return `%(${name})`
  return `{${name}}`
}

/** Interpolation variables a translation uses: `%{name}`, `{{name}}`, `{name}`, `%(name)s`, sorted. */
function variablesOf(value: string): string[] {
  const found = new Set<string>()
  for (const match of value.matchAll(/%\{(\w+)\}|\{\{\s*(\w+)\s*\}\}|(?<![{%$])\{(\w+)\}|%\((\w+)\)[sd]/g)) {
    const name = match[1] ?? match[2] ?? match[3] ?? match[4]
    found.add(variableSpelling(match[0], name))
  }
  return [...found].sort()
}

/** Every key of a translation file, flattened with dots, without the locale's own root key. Null when it cannot be read. */
export function keysOf(path: string, text: string | null): Map<string, string> | null {
  if (text == null) return null
  const locale = localeOf(path)?.locale
  const dropRoot = (map: Map<string, string>) => {
    const roots = new Set([...map.keys()].map((key) => key.split('.')[0]))
    if (roots.size !== 1 || ![...roots][0] || [...roots][0] !== locale) return map
    return new Map([...map].map(([key, value]) => [key.split('.').slice(1).join('.'), value]))
  }
  try {
    if (/\.json$|\.arb$/.test(path)) return dropRoot(flattenJson(JSON.parse(text)))
    if (/\.ya?ml$/.test(path)) return dropRoot(flattenYaml(text))
    if (/\.pot?$/.test(path)) return new Map([...text.matchAll(/^msgid\s+"(.+)"\s*\nmsgstr\s+"(.*)"/gm)].map((match) => [match[1]!, match[2]!]))
    if (/\.strings$/.test(path)) return new Map([...text.matchAll(/^\s*"(.+?)"\s*=\s*"(.*)"\s*;/gm)].map((match) => [match[1]!, match[2]!]))
  } catch {
    return null
  }
  return null
}

function flattenJson(value: unknown, prefix = '', into = new Map<string, string>()): Map<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) flattenJson(inner, prefix ? `${prefix}.${key}` : key, into)
  } else if (prefix) into.set(prefix, String(value ?? ''))
  return into
}

/** Nested `key: value` maps by indentation: enough for translation files, not a general YAML reader. */
function flattenYaml(text: string): Map<string, string> {
  const into = new Map<string, string>()
  const stack: { indent: number; key: string }[] = []
  let block: number | null = null
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (block != null && indent > block) continue
    block = null
    const match = line.match(/^\s*(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?))\s*:(?:\s+(.*))?$/)
    if (!match) continue
    const key = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    const value = (match[4] ?? '').trim()
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
    const path = [...stack.map((entry) => entry.key), key].join('.')
    if (!value) stack.push({ indent, key })
    else if (/^[|>][-+]?$/.test(value)) {
      into.set(path, '')
      block = indent
    } else into.set(path, value.replace(/^(['"])(.*)\1$/, '$2'))
  }
  return into
}

/** Names a removed file defined that something else could still use: Ruby constants by their full name, exported JS/TS names. */
function namesDefined(path: string, text: string): string[] {
  if (/\.rb$/.test(path)) {
    const stack: { indent: number; name: string; parent: boolean }[] = []
    const all: { name: string; entry: { parent: boolean } }[] = []
    for (const line of text.split('\n')) {
      const match = line.match(/^(\s*)(class|module)\s+([A-Z][\w:]*)/)
      if (!match) continue
      const indent = match[1]!.length
      while (stack.length && stack.at(-1)!.indent >= indent) stack.pop()
      if (stack.length) stack.at(-1)!.parent = true
      const entry = { indent, name: [...stack.map((outer) => outer.name), match[3]!].join('::'), parent: false }
      stack.push(entry)
      all.push({ name: entry.name, entry })
    }
    // A module that only holds others is a namespace other code shares: searching for it would find them.
    return all.filter(({ entry }) => !entry.parent).map(({ name }) => name)
  }
  if (/\.[cm]?[jt]sx?$/.test(path)) {
    const names = [...text.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]!)
    return names.filter((name) => name.length >= 6)
  }
  return []
}

/** A removed or moved file's path without its extension and source folder, as an import or require would name it. */
function importPathOf(path: string): string {
  const stem = path.replace(/\.[^./]+$/, '').replace(/\/index$/, '')
  const parts = stem.split('/').filter((part) => !['app', 'lib', 'src', 'models', 'services', 'controllers', 'jobs'].includes(part) || part === stem.split('/').at(-1))
  return parts.slice(-2).join('/')
}

/**
 * Every line at head outside `skip` that names a term, found in one search of the whole tree for all of them, so
 * fixtures, other platforms' code and other projects in the repository count too.
 */
async function referencesTo(reader: RepoReader, head: string, terms: readonly string[], skip: ReadonlySet<string>): Promise<string[]> {
  if (!terms.length) return []
  const matchers = terms.map((term) => ({ term, pattern: new RegExp(wholeWord([term])) }))
  const found: string[] = []
  for (const hit of await reader.grep(head, wholeWord(terms))) {
    if (skip.has(hit.path)) continue
    for (const { term } of matchers.filter(({ pattern }) => pattern.test(hit.text))) {
      found.push(`${hit.path}:${hit.line} still refers to ${term}: ${hit.text.trim().slice(0, 120)}`)
    }
  }
  return found
}

/** Breaks on each line that still names a term, passes with `cleanDetail` when none does, and cannot tell when the search fails. */
async function nothingRefersTo(
  name: string,
  reader: RepoReader,
  { head, terms, skip, cleanDetail }: { head: string; terms: readonly string[]; skip: ReadonlySet<string>; cleanDetail: string },
): Promise<BucketCheck> {
  let references: string[]
  try {
    references = await referencesTo(reader, head, terms, skip)
  } catch (error) {
    return { name, passed: null, detail: `could not search the tree: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (references.length) return { name, passed: false, breaks: true, detail: references.join('\n') }
  return { name, passed: true, detail: cleanDetail }
}

async function removalChecks(bucket: Bucket, reader: RepoReader, { base, head, files }: Pick<ChangeMeta, 'base' | 'head' | 'files'>): Promise<BucketCheck[]> {
  const deleted = files.filter((file) => bucket.paths.includes(file.path) && file.status === 'deleted')
  const terms = new Set<string>()
  for (const file of deleted) {
    terms.add(importPathOf(file.path))
    const text = await reader.text(base, file.path)
    if (text) for (const name of namesDefined(file.path, text)) terms.add(name)
  }
  const checks: BucketCheck[] = [
    await nothingRefersTo('nothing refers to what was removed', reader, {
      head,
      terms: [...terms],
      skip: new Set(bucket.paths),
      cleanDetail: `no file at head refers to the ${deleted.length} removed files (${terms.size} names searched)`,
    }),
  ]
  // A test deleted while its subject stays is a finding, not a break.
  const orphans: string[] = []
  for (const file of deleted.filter((entry) => TEST.test(entry.path))) {
    for (const subject of subjectsOf(file.path)) {
      if ((await reader.text(head, subject)) != null) orphans.push(`${file.path} was deleted while ${subject} remains`)
    }
  }
  if (orphans.length) checks.push({ name: 'tests deleted whose subject remains', passed: false, detail: orphans.join('\n') })
  return checks
}

/** Where a test's subject would live by convention. */
function subjectsOf(testPath: string): string[] {
  const ruby = testPath.match(/^(test|spec)\/(.+)_(test|spec)\.rb$/)
  if (ruby) return [`app/${ruby[2]}.rb`, `lib/${ruby[2]}.rb`]
  const js = testPath.match(/^(.*?)(?:__tests__\/)?([^/]+)\.(test|spec)\.([cm]?[jt]sx?)$/)
  if (js) return [`${js[1]}${js[2]}.${js[4]}`, `${js[1]!.replace(/^(test|tests)\//, 'src/')}${js[2]}.${js[4]}`]
  return []
}

async function renameChecks(bucket: Bucket, reader: RepoReader, { head, files }: Pick<ChangeMeta, 'head' | 'files'>): Promise<BucketCheck[]> {
  const moved = files.filter((file) => bucket.paths.includes(file.path) && file.oldPath)
  const oldTerms = moved.map((file) => importPathOf(file.oldPath!))
  const terms = oldTerms.filter((term, index) => oldTerms.indexOf(term) === index && !moved.some((file) => importPathOf(file.path) === term))
  return [
    await nothingRefersTo('nothing refers to the old paths', reader, {
      head,
      terms,
      skip: new Set(bucket.paths),
      cleanDetail: moved.map((file) => `${file.oldPath} → ${file.path}`).join('\n') || 'no renames',
    }),
  ]
}
