/**
 * What the review looks for in code, as data a project can change. Patterns are strings, compiled where they are used,
 * so the config can be written as JSON. A pattern that names a flag puts its name in a group called `flag`.
 */

export interface ReviewConfig {
  flags: {
    /** A feature flag is read here. The group `flag` is its name. */
    check: string[]
    /** A test turns a flag on / off. */
    testOn: string[]
    testOff: string[]
    /** Conditions that are on for some people only (a tenant or beta check). Empty until a project adds its own. */
    subset: string[]
  }
  /** Paths whose code a request, job or message enters through. */
  entry: Record<string, string>
  /** Paths of tests that go through the whole request life cycle. */
  lifecycleTests: string[]
  /** Paths whose code does not run in a request: tests, scripts, build tooling. */
  notRequest: string[]
  /** Words that order units inside a level. They never set a level. */
  sensitive: string[]
  /** Lines that write, enqueue, touch a cache key or serialize. */
  signals: { write: string; enqueue: string; cache_key: string; serialization: string }
  /** Paths that take effect at deploy and cannot be put behind a flag. */
  ungateable: { migration: string; schema: string; config: string; dependency: string }
  migration: { additive: string; destructive: string }
}

export const DEFAULT_CONFIG: ReviewConfig = {
  flags: {
    check: [
      'Features\\.enabled\\?\\(\\s*:(?<flag>\\w+)',
      'Flipper\\.enabled\\?\\(\\s*:(?<flag>\\w+)',
      'feature_enabled\\?\\(\\s*:(?<flag>\\w+)',
      'isFeatureEnabled\\(\\s*[\'"](?<flag>[\\w.-]+)',
      'isEnabled\\(\\s*[\'"](?<flag>[\\w.-]+)',
      'useFlag\\(\\s*[\'"](?<flag>[\\w.-]+)',
      'featureFlags\\.(?<flag>[A-Za-z_]\\w*)',
    ],
    testOn: ['with_flag\\(\\s*:(?<flag>\\w+)', 'enable_flag\\(\\s*:(?<flag>\\w+)', 'Flipper\\.enable\\(\\s*:(?<flag>\\w+)', 'setFlag\\(\\s*[\'"](?<flag>[\\w.-]+)[\'"]\\s*,\\s*true'],
    testOff: ['without_flag\\(\\s*:(?<flag>\\w+)', 'disable_flag\\(\\s*:(?<flag>\\w+)', 'Flipper\\.disable\\(\\s*:(?<flag>\\w+)', 'setFlag\\(\\s*[\'"](?<flag>[\\w.-]+)[\'"]\\s*,\\s*false'],
    subset: [],
  },
  entry: {
    controller: '(^|/)controllers?/',
    graphql: '(^|/)(graphql|resolvers?|mutations?)/',
    job: '(^|/)(jobs?|workers?|sidekiq)/',
    consumer: '(^|/)(consumers?|subscribers?|webhooks?)/',
    middleware: '(^|/)(middleware|rack)/',
    task: '(^|/)(lib/tasks|tasks/maintenance)/',
    route: '(^|/)routes?/',
    handler: '(^|/)handlers?/',
    command: '(^|/)(server|host)/(src/)?(commands?|handlers?|routes?)/',
  },
  lifecycleTests: [
    '(^|/)(spec|test)/(requests?|controllers?|integration|system|jobs?|consumers?|e2e)/',
    '(^|/)e2e/',
    '\\.(e2e|integration)\\.(test|spec)\\.[jt]sx?$',
    '(^|/)(host|server)/test/',
  ],
  notRequest: ['(^|/)(test|tests|spec|specs|__tests__|scripts?|bin|tools?|support)/', '\\.(test|spec)\\.[jt]sx?$', '_(test|spec)\\.rb$'],
  sensitive: ['money', 'price', 'amount', 'tax', 'payment', 'charge', 'refund', 'auth', 'password', 'token', 'secret', 'session', 'permission', 'tenant', 'account'],
  signals: {
    write:
      '\\.(update|update!|update_all|update_columns?|save|save!|create|create!|insert_all|upsert_all|delete_all|destroy|destroy!|destroy_all|increment!|decrement!|touch)\\b|\\b(INSERT\\s+INTO|UPDATE\\s+\\w+\\s+SET|DELETE\\s+FROM)\\b|\\.(insert|upsert|writeFile|writeFileSync|appendFile|appendFileSync|setItem|remove|unlink)\\(',
    enqueue: '\\.(perform_later|perform_async|perform_in|deliver_later|enqueue|publish)\\b|\\b(enqueue|publish|emit)\\(',
    cache_key: '(cache_key|Rails\\.cache\\.|\\.cache\\.(fetch|write|read)|memoize|cacheKey|cache\\.(set|get|delete))',
    serialization: '\\b(as_json|to_json|serialize|Marshal\\.|to_msgpack|GlobalID|JSON\\.(dump|generate|stringify)|toJSON|structuredClone)\\b',
  },
  ungateable: {
    migration: '(^|/)db/(migrate|data)/',
    schema: '(^|/)(db/schema\\.rb|db/structure\\.sql)$',
    config: '(^|/)config/|\\.(ya?ml|toml|env)$',
    dependency: '(^|/)(Gemfile(\\.lock)?|package(-lock)?\\.json|pnpm-lock\\.yaml|yarn\\.lock)$',
  },
  migration: {
    additive: '\\b(create_table|add_column|add_index|add_reference|add_timestamps|add_foreign_key|add_check_constraint)\\b',
    destructive:
      '\\b(drop_table|remove_column|remove_columns|rename_column|rename_table|change_column|change_column_null|change_column_default|remove_index|remove_reference|execute|update_all|delete_all)\\b|null:\\s*false',
  },
}

const compiled = new Map<string, RegExp>()

/** A pattern as a regular expression, kept so each one is built once. */
export function rx(pattern: string): RegExp {
  let found = compiled.get(pattern)
  if (!found) {
    found = new RegExp(pattern)
    compiled.set(pattern, found)
  }
  return found
}

const anyMatch = (patterns: Iterable<string>, text: string): boolean => [...patterns].some((p) => rx(p).test(text))

/** The path is where a request, job, consumer or command enters. */
export function isEntryPath(path: string, config: ReviewConfig = DEFAULT_CONFIG): boolean {
  return anyMatch(Object.values(config.entry), path)
}

/** The path is a test that goes through the request life cycle, not a unit test. */
export function isLifecycleTestPath(path: string, config: ReviewConfig = DEFAULT_CONFIG): boolean {
  return anyMatch(config.lifecycleTests, path)
}

/** The path is code that does not run in a request: tests, scripts, tooling. */
export function isNotRequestPath(path: string, config: ReviewConfig = DEFAULT_CONFIG): boolean {
  return anyMatch(config.notRequest, path)
}

/** The sensitive words found in a name or a path, sorted. They order units; they never set a level. */
export function sensitiveOf(symbol: string, path: string, config: ReviewConfig = DEFAULT_CONFIG): string[] {
  const text = `${symbol} ${path}`.toLowerCase()
  return config.sensitive.filter((word) => text.includes(word)).sort()
}
