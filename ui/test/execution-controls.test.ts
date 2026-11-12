import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { executionFeedbackRows, executionKey, executionTargets, confirmExecution, latestMainExecutionResult, receiptText } from '../src/features/work/actions.ts'
import { initialHostState, type HostState } from '../src/lib/host/state.ts'
import type { StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'

const row = { kind: 'main' as const, runId: 'turn:1', parentId: null, rootId: 'turn:1', label: 'hobkin', canStop: true, canForce: true }
const state = (): HostState => ({ ...initialHostState, home: '/isolated', link: 'open' as const, owner: { state: 'live' as const, limits: { images: 4, imageBytes: 1 } }, snapshot: { busy: false, stopControls: { home: '/isolated', epoch: 'host:1', targets: [row] } } })
const receipt = (args: StopExecutionArgs): StopExecutionReceipt => ({ ...args, stop: { status: 'unknown' }, closure: { status: 'unknown' }, descendants: { status: 'unknown', agents: [], cleanupScope: 'captured-rpc-children', detachedCleanup: 'unknown' }, queueRecovery: { status: 'unknown' } })

test('retained live controls authorize exact UUID/root rows, not busy or observations', () => {
  const host = state()
  host.snapshot.stopControls!.targets.push(...Array.from({ length: 5 }, (_, n) => ({ ...row, kind: 'agent' as const, agentId: `uuid:${n}`, parentId: n ? `uuid:${n - 1}` : row.runId, label: 'duplicate' })))
  assert.equal(executionTargets(host).length, 6)
  assert.equal(executionTargets({ ...host, link: 'lost' }).length, 0)
  assert.equal(executionTargets({ ...host, owner: null }).length, 0)
  assert.equal(executionTargets({ ...host, home: '/replacement' }).length, 0)
  const target = executionTargets(host)[5]!
  const sent: unknown[] = []
  const answer = confirmExecution(target, () => executionTargets(host), () => sent.push(target))
  answer(true); answer(true)
  assert.deepEqual(sent, [target])
  const stale = confirmExecution(target, () => executionTargets(host), () => { sent.push(target) })
  host.snapshot.stopControls!.epoch = 'host:2'
  stale(true)
  assert.equal(sent.length, 1)
})

test('closed execution feedback is retained once without live authority', () => {
  const target = { ...executionTargets(state())[0]!, kind: 'agent' as const, agentId: 'nested:uuid:7', parentId: 'uuid:6' }
  const args = { target: { home: target.home, epoch: target.epoch, kind: target.kind, runId: target.runId, agentId: target.agentId }, mode: 'stop' as const, attemptId: 'closed' }
  const result = { target, text: 'Stop: confirmed', receipt: receipt(args), order: 1 }
  const results = { [executionKey(target)]: result }
  assert.deepEqual(executionFeedbackRows([], results).map(({ active, result }) => [active, result]), [[false, result]])
  assert.deepEqual(executionFeedbackRows([target], results).map(({ active, result: current }) => [active, current]), [[true, result]])
  const error = { target, text: 'Not stopped', order: 2 }
  assert.equal(executionFeedbackRows([], { [executionKey(target)]: error })[0]?.result, error)
})

test('main feedback selects the latest explicit execution order', () => {
  const [base] = executionTargets(state())
  const a = { ...base!, runId: 'turn:A' }
  const b = { ...base!, runId: 'turn:B' }
  const results = { [executionKey(a)]: { target: a, text: 'A', order: 1 }, [executionKey(b)]: { target: b, text: 'B', order: 2 } }
  assert.equal(latestMainExecutionResult(undefined, results)?.target.runId, 'turn:B')
  assert.equal(latestMainExecutionResult(a, results)?.target.runId, 'turn:A')
})

test('Force runs independently of pending Stop; echoes and old epochs cannot publish', { timeout: 2000 }, async t => {
  const aliases = registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) } })
  globalThis.requestAnimationFrame = () => 0
  try {
    const { runExecution, useExecution } = await import('../src/features/work/store.ts')
    const { hostStore } = await import('../src/lib/host/client.ts')
    const { HostConnection } = await import('../src/lib/host/connection.ts')
    hostStore.setState(state(), true)
    const target = executionTargets(hostStore.getState())[0]!
    const calls: StopExecutionArgs[] = []
    let finish!: (r: StopExecutionReceipt) => void
    t.mock.method(HostConnection.prototype, 'command', (_name: string, args: StopExecutionArgs) => {
      calls.push(args)
      return args.mode === 'stop' ? new Promise(resolve => { finish = resolve }) : Promise.resolve(receipt(args))
    })
    const stop = runExecution(target, 'stop')
    await runExecution(target, 'stop')
    await runExecution(target, 'force')
    assert.deepEqual(calls.map(c => c.mode), ['stop', 'force'])
    assert.equal(useExecution.getState().pending[executionKey(target, 'stop')], true)
    assert.match(useExecution.getState().results[executionKey(target)]!.text, /closure unknown.*detached.*unknown/i)
    assert.ok(useExecution.getState().results[executionKey(target)]!.order > 0)
    finish(receipt(calls[0]!)); await stop
    assert.equal(useExecution.getState().results[executionKey(target)]!.receipt?.mode, 'force', 'late Stop cannot downgrade the newer Force feedback')
    const old = runExecution(target, 'stop')
    hostStore.setState({ epoch: 2 })
    finish(receipt(calls[2]!)); await old
    assert.deepEqual(useExecution.getState().results, {})
    hostStore.setState(state(), true)
    t.mock.method(HostConnection.prototype, 'command', async (_name: string, args: StopExecutionArgs) => receipt({ ...args, attemptId: 'wrong' }))
    await assert.rejects(runExecution(target, 'force'), /receipt.*match/i)
    hostStore.setState({ snapshot: { ...hostStore.getState().snapshot, stopControls: { ...hostStore.getState().snapshot.stopControls!, targets: [] } } })
    assert.equal(executionFeedbackRows([], useExecution.getState().results)[0]?.result?.target.runId, target.runId, 'an error remains tied to its closed target')
    const nestedHost = state()
    nestedHost.snapshot.stopControls!.targets.push({ ...row, kind: 'agent', agentId: 'owned:uuid:5', parentId: 'owned:uuid:4', label: 'duplicate' })
    hostStore.setState(nestedHost, true)
    const nested = executionTargets(hostStore.getState())[1]!
    let sent: StopExecutionArgs | undefined
    t.mock.method(HostConnection.prototype, 'command', async (_name: string, args: StopExecutionArgs) => { sent = args; return receipt(args) })
    await runExecution(nested, 'force', 'not-approved')
    hostStore.setState({ snapshot: { ...hostStore.getState().snapshot, stopControls: { ...nestedHost.snapshot.stopControls!, targets: [nestedHost.snapshot.stopControls!.targets[0]!] } } })
    assert.equal(executionFeedbackRows(executionTargets(hostStore.getState()), useExecution.getState().results).find(({ target }) => target.agentId === nested.agentId)?.active, false)
    assert.deepEqual(sent!.target, { home: '/isolated', epoch: 'host:1', kind: 'agent', runId: 'turn:1', agentId: 'owned:uuid:5' })
    assert.equal(sent!.how, undefined)
    hostStore.setState(initialHostState, true)
  } finally { aliases.deregister() }
})

test('main recovery applies once after closure, preserving later draft and newly sent entries', { timeout: 2000 }, async t => {
  const aliases = registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) } })
  globalThis.requestAnimationFrame = () => 0
  try {
    const { useChat } = await import('../src/features/chat/chat-store.ts')
    const { useExecution } = await import('../src/features/work/store.ts')
    const { hostStore } = await import('../src/lib/host/client.ts')
    const { HostConnection } = await import('../src/lib/host/connection.ts')
    hostStore.setState(state(), true)
    const entry = { id: 1, text: 'queued', images: 0, at: 1, accepted: false }
    useChat.setState({ draft: { ...useChat.getState().draft, text: 'later draft' }, outbox: { ...useChat.getState().outbox, entries: [entry] } })
    let finish!: () => void
    t.mock.method(HostConnection.prototype, 'command', (_name: string, args: StopExecutionArgs) => new Promise(resolve => { finish = () => resolve({ ...receipt(args), queueRecovery: { status: 'confirmed', unsent: ['queued'] } }) }))
    useChat.getState().stop()
    useChat.setState({ outbox: { ...useChat.getState().outbox, entries: [entry, { ...entry, id: 2 }] } })
    hostStore.setState({ snapshot: { stopControls: { ...state().snapshot.stopControls!, targets: [] } } })
    finish(); await new Promise<void>(done => setImmediate(done))
    assert.equal(executionFeedbackRows([], useExecution.getState().results)[0]?.active, false, 'feedback remains after the main target closes before its receipt')
    assert.match(useChat.getState().draft.text, /queued/)
    assert.match(useChat.getState().draft.text, /later draft/)
    assert.deepEqual(useChat.getState().outbox.entries.map(e => e.id), [2])
    hostStore.setState({ snapshot: state().snapshot })
    useChat.getState().stop(); finish(); await new Promise<void>(done => setImmediate(done))
    assert.equal(useChat.getState().draft.text.match(/queued/g)?.length, 1)
    t.mock.method(HostConnection.prototype, 'command', async (_name: string, args: StopExecutionArgs) => ({ ...receipt(args), queueRecovery: { status: 'confirmed', unsent: ['duplicate'], alreadyReturned: true } }))
    useChat.getState().stop(); await new Promise<void>(done => setImmediate(done))
    assert.doesNotMatch(useChat.getState().draft.text, /duplicate/)
    hostStore.setState(initialHostState, true)
  } finally { aliases.deregister() }
})

test('unknown or rejected main recovery permits explicit Force without restoring twice or after disconnect', { timeout: 2000 }, async t => {
  const aliases = registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) } })
  try {
    const { useChat } = await import('../src/features/chat/chat-store.ts')
    const { useExecution } = await import('../src/features/work/store.ts')
    const { hostStore } = await import('../src/lib/host/client.ts')
    const { HostConnection } = await import('../src/lib/host/connection.ts')
    const host = state(); host.snapshot.stopControls!.targets[0] = { ...row, runId: 'turn:2', rootId: 'turn:2' }
    hostStore.setState(host, true)
    const target = executionTargets(host)[0]!
    const settle = () => new Promise<void>(done => setImmediate(done))
    useChat.setState({ draft: { ...useChat.getState().draft, text: 'keep me' }, problem: null })
    let reject!: (error: Error) => void
    t.mock.method(HostConnection.prototype, 'command', (_name: string, args: StopExecutionArgs) => args.mode === 'stop' ? new Promise((_yes, no) => { reject = no }) : Promise.resolve({ ...receipt(args), queueRecovery: { status: 'unknown' } }))
    useChat.getState().stop()
    useChat.getState().stop('force', target); await settle()
    assert.equal(useChat.getState().draft.text, 'keep me')
    assert.equal(useExecution.getState().pending[executionKey(target, 'stop')], true)
    reject(Error('Superseded Stop rejection')); await settle()
    assert.equal(useChat.getState().problem, null, 'an older Stop error cannot replace the newer Force receipt')
    useChat.getState().stop()
    hostStore.setState({ link: 'lost' })
    reject(Error('Old rejected stop')); await settle()
    assert.equal(useChat.getState().problem, null)
    hostStore.setState({ link: 'open' })
    assert.deepEqual(executionTargets(hostStore.getState()), [], 'hello/open alone cannot resurrect old authority')
    hostStore.setState({ epoch: host.epoch + 1 })
    assert.equal(executionTargets(hostStore.getState()).length, 1)
    t.mock.method(HostConnection.prototype, 'command', async (_name: string, args: StopExecutionArgs) => ({ ...receipt(args), queueRecovery: { status: 'confirmed', unsent: ['already returned'], alreadyReturned: true } }))
    useChat.getState().stop('force', target); await settle()
    assert.equal(useChat.getState().draft.text, 'keep me')
    t.mock.method(HostConnection.prototype, 'command', async (_name: string, args: StopExecutionArgs) => ({ ...receipt(args), queueRecovery: { status: 'confirmed', unsent: ['once'] } }))
    useChat.getState().stop('force', target); await settle()
    assert.match(useChat.getState().draft.text, /once/)
    hostStore.setState(initialHostState, true)
  } finally { aliases.deregister() }
})

test('receipt publication cannot restore a draft after a same-counter home replacement', { timeout: 2000 }, async t => {
  const aliases = registerHooks({ resolve(specifier, context, next) { return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) } })
  try {
    const { useChat } = await import('../src/features/chat/chat-store.ts')
    const { useExecution } = await import('../src/features/work/store.ts')
    const { hostStore } = await import('../src/lib/host/client.ts')
    const { HostConnection } = await import('../src/lib/host/connection.ts')
    const host = state(); host.snapshot.stopControls!.targets[0] = { ...row, runId: 'turn:3', rootId: 'turn:3' }
    hostStore.setState(host, true)
    useChat.setState({ draft: { ...useChat.getState().draft, text: 'new home draft' } })
    t.mock.method(HostConnection.prototype, 'command', async (_name: string, args: StopExecutionArgs) => ({ ...receipt(args), queueRecovery: { status: 'confirmed', unsent: ['old home queue'] } }))
    const unsubscribe = useExecution.subscribe(current => { if (Object.keys(current.results).length) hostStore.setState({ home: '/replacement' }) })
    try {
      useChat.getState().stop(); await new Promise<void>(done => setImmediate(done))
      assert.equal(useChat.getState().draft.text, 'new home draft')
      assert.deepEqual(useExecution.getState().results, {})
    } finally { unsubscribe(); hostStore.setState(initialHostState, true) }
  } finally { aliases.deregister() }
})

test('receipt feedback keeps cancellation, closure and detached cleanup separate', () => {
  const args = { target: { home: '/isolated', epoch: 'host:1', kind: 'main' as const, runId: 'turn:1' }, mode: 'force' as const, attemptId: 'attempt' }
  assert.match(receiptText({ ...receipt(args), closure: { status: 'unsupported' } }), /unsupported/)
  assert.match(receiptText({ ...receipt(args), stop: { status: 'confirmed' }, closure: { status: 'confirmed' } }), /detached.*unknown/i)
})
