import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HomeOwner } from '../src/owner.ts'
import type { OwnedLifecycle } from 'hobkin/src/cli/application.mjs'
import { Appearance } from '../src/appearance.ts'
import { AppearanceFile } from '../src/appearance-file.ts'

const css =
  ':root { --hb-bg: #000000; --hb-surface: #111111; ' +
  '--hb-text: #ffffff; --hb-muted: #eeeeee; ' +
  '--hb-accent: #00ff00; --hb-border: #abcdef; }'

function canonical() {
  const root = mkdtempSync(join(tmpdir(), 'theme-'))
  const file = new AppearanceFile(root)
  const publications: number[] = []
  const appearance = new Appearance({
    file,
    onChange: () => {
      assert.equal(readFileSync(join(root, 'client/custom.css'), 'utf8'), file.read({}))
      publications.push(appearance.state!.id)
    },
  })

  return { appearance, publications, file }
}

test('canonical read and replacement return the exact saved publication', () => {
  const { appearance, publications, file } = canonical()

  const saved = appearance.replaceStyle({ content: css })

  assert.equal(saved.appearanceId, publications[0])
  assert.equal(appearance.readStyle(), file.read({}))
})

async function fixture(t: TestContext, options: { cleanup?: boolean | 'pending'; deadlineMs?: number } = {}) {
  const { appearanceSession } = await import('../src/appearance-session.ts')
  const { appearance, publications } = canonical()
  let resolveJoined!: () => void
  const joined = {
    promise: new Promise<void>((resolve) => {
      resolveJoined = resolve
    }),
    resolve: () => resolveJoined(),
  }
  let binding!: Parameters<OwnedLifecycle['register']>[0]
  let cancellations = 0
  let child = 'completed'

  const lifecycle: OwnedLifecycle = {
    register(value) {
      binding = value
      return {
        request(value) {
          assert.deepEqual(value, { action: 'spawn', name: 'Custom theme', allowHelpers: false })
          assert.equal(binding.beforeSpawn(), true)
        },
        join: () => joined.promise,
        cancel: async () => {
          cancellations++
          return options.cleanup === 'pending'
            ? new Promise(() => {})
            : { confirmed: options.cleanup !== false }
        },
      }
    },
    snapshot: () => [{ status: child }],
  }
  const app = {
    config: {
      main: { cwd: '/normal', model: 'provider/model', effort: 'medium' },
      launcher: undefined as unknown,
    },
    runtime: {
      main: { sessionId: 'session' },
      ownedLifecycle: lifecycle,
    },
  }
  let captured: unknown = { app, home: '/home', epoch: 'epoch' }
  const owner = { captureExecution: () => captured } as Pick<HomeOwner, 'captureExecution'>
  const session = appearanceSession(owner, appearance, options.deadlineMs)
  t.after(() => session.close())

  return {
    session,
    appearance,
    publications,
    app,
    joined,
    binding: () => binding,
    cancellations: () => cancellations,
    change: (value: unknown) => {
      captured = value
    },
    child: (value: string) => {
      child = value
    },
  }
}

test('one owned child reads, saves once under overlap, and returns its exact receipt', async (t) => {
  const scenario = await fixture(t)
  const initial = scenario.session.start('green')
  const signal = new AbortController().signal

  assert.throws(() => scenario.session.start('again'), /active|cleanup/i)
  assert.deepEqual(scenario.binding().binding, {
    cwd: '/normal',
    prompt: 'green',
    model: 'provider/model',
    effort: 'medium',
    role: 'theme',
    parentRole: 'theme',
  })
  assert.equal(await scenario.binding().customStyle({ op: 'read' }, signal), null)

  for (const request of [
    { op: 'read', path: '/other' },
    { op: 'other' },
    { op: 'replace', css: 'x'.repeat(16385) },
  ]) {
    await assert.rejects(scenario.binding().customStyle(request, signal))
  }

  const calls = await Promise.allSettled([
    scenario.binding().customStyle({ op: 'replace', css }, signal),
    scenario.binding().customStyle({ op: 'replace', css }, signal),
  ])
  assert.deepEqual(calls.map((call) => call.status), ['fulfilled', 'rejected'])

  scenario.joined.resolve()
  await scenario.session.settled()

  const receipt = scenario.session.status(initial.id)!
  assert.deepEqual(
    [receipt.status, receipt.appearanceId, receipt.cleanup, receipt.child],
    ['completed', scenario.publications[0], 'confirmed', 'completed'],
  )
  assert.equal(scenario.cancellations(), 1)
  assert.deepEqual(
    scenario.appearance.set({
      background: '#000000',
      surface: '#000000',
      text: '#ffffff',
      muted: '#eeeeee',
      accent: '#ff0000',
    }),
    { ok: true },
  )
  assert.equal(scenario.session.status(initial.id)!.appearanceId, receipt.appearanceId)
})

test('missing authority and every configured launcher refuse before registration', async (t) => {
  for (const launcher of [null, false, '', { command: 'pi' }]) {
    const scenario = await fixture(t)
    scenario.app.config.launcher = launcher

    assert.throws(() => scenario.session.start('green'), /authority|launcher/i)
    assert.equal(scenario.binding(), undefined)
  }

  const scenario = await fixture(t)
  scenario.change(null)
  assert.throws(() => scenario.session.start('green'), /authority/i)
})

test('changed authority, cancelled signals, and extra fields cannot reach the canonical writer', async (t) => {
  for (const change of ['owner', 'epoch', 'main', 'session', 'model', 'effort', 'cwd', 'launcher', 'signal', 'path', 'token']) {
    const scenario = await fixture(t)
    scenario.session.start('green')
    const signal = new AbortController()

    if (change === 'owner') scenario.change(null)
    if (change === 'epoch') scenario.change({ app: scenario.app, home: '/home', epoch: 'replacement' })
    if (change === 'main') scenario.app.runtime.main = { sessionId: 'session' }
    if (change === 'launcher') scenario.app.config.launcher = { command: 'pi' }
    if (change === 'model' || change === 'effort' || change === 'cwd') scenario.app.config.main[change] = 'replacement'
    if (change === 'session') scenario.app.runtime.main.sessionId = 'replacement'
    if (change === 'signal') signal.abort()

    if (!['signal', 'path', 'token'].includes(change)) {
      assert.equal(scenario.binding().beforeSpawn(), false)
    }
    if (!['path', 'token'].includes(change)) {
      await assert.rejects(scenario.binding().customStyle({ op: 'read' }, signal.signal))
    }

    await assert.rejects(
      scenario.binding().customStyle(
        change === 'path'
          ? { op: 'replace', css, path: '/elsewhere' }
          : {
              op: 'replace',
              css: change === 'token' ? ':root { width: #000000; }' : css,
            },
        signal.signal,
      ),
    )
    assert.equal(scenario.publications.length, 0)

    scenario.joined.resolve()
    await scenario.session.settled()
  }
})

test('deadline and host close fence late writes; cleanup and save failures remain truthful', async (t) => {
  for (const kind of ['deadline', 'close', 'cleanup', 'cleanup-timeout', 'save', 'child']) {
    const scenario = await fixture(t, {
      cleanup: kind === 'cleanup-timeout' ? 'pending' : kind !== 'cleanup',
      deadlineMs: kind === 'deadline' ? 5 : undefined,
    })
    const initial = scenario.session.start('green')
    const signal = new AbortController().signal

    if (kind === 'save') scenario.appearance.replaceStyle = () => {
      throw Error('ambiguous save')
    }
    if (kind === 'child') scenario.child('failed')
    if (['cleanup', 'cleanup-timeout', 'child'].includes(kind)) {
      await scenario.binding().customStyle({ op: 'replace', css }, signal)
    }
    if (kind === 'save') {
      await assert.rejects(scenario.binding().customStyle({ op: 'replace', css }, signal))
    }

    assert.equal(scenario.session.status(initial.id)!.status, 'running')
    assert.throws(() => scenario.session.start('overlap'), /active|cleanup/i)

    if (kind === 'close') {
      await scenario.session.close()
    } else {
      if (kind !== 'deadline') scenario.joined.resolve()
      await scenario.session.settled()
    }

    const receipt = scenario.session.status(initial.id)!
    assert.equal(receipt.status, ['cleanup', 'cleanup-timeout', 'save'].includes(kind) ? 'unknown' : 'failed')
    assert.equal(receipt.cleanup, kind.startsWith('cleanup') ? 'unknown' : 'confirmed')
    assert.equal(receipt.appearanceId !== null, ['cleanup', 'cleanup-timeout', 'child'].includes(kind))
    await assert.rejects(scenario.binding().customStyle({ op: 'replace', css }, signal))
    assert.equal(scenario.cancellations(), 1)
  }
})
