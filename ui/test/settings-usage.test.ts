import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import type { UsageUpload } from '../../shared/protocol/setup.ts'
import { mountView, readViews } from './view-draws.ts'

/** What the host answers, and every command the switch ran. */
let host: Record<string, (args: Record<string, unknown>) => unknown> = {}
const asked: string[] = []

readViews({
  'lib/host/index.ts': {
    useHasHost: () => true,
    runCommand: async (name: string, args: Record<string, unknown> = {}) => {
      asked.push(Object.keys(args).length ? `${name} ${JSON.stringify(args)}` : name)
      const answer = host[name]
      if (!answer) throw Error(`Unexpected command: ${name}`)
      return answer(args)
    },
  },
})
const { usageSwitch, useUsageUpload } = await import('../src/features/settings/usage-upload.ts')

const settled = () => new Promise((resolve) => setImmediate(resolve))

test("on the real home the switch is hobkin's own setting, and elsewhere it stays in the window and says so", () => {
  const realHome: UsageUpload = { upload: true, saves: true }
  const otherHome: UsageUpload = { upload: false, saves: false }

  const onReal = usageSwitch(realHome, false)
  assert.deepEqual([onReal.checked, onReal.onHost], [true, true], "hobkin's value, not the window's")

  const onOther = usageSwitch(otherHome, true)
  assert.deepEqual([onOther.checked, onOther.onHost], [true, false], "the window's own value")
  assert.match(onOther.says, /nothing is sent/)

  const noHost = usageSwitch(null, false)
  assert.deepEqual([noHost.checked, noHost.onHost], [false, false])
  assert.notEqual(noHost.says, onReal.says, "it says the switch is not hobkin's yet")
})

test('the switch reads the setting from the host, changes it there, and says why when the host refuses', async () => {
  let saved = false
  host = {
    'usage.read': () => ({ upload: saved, saves: true }),
    'usage.apply': ({ upload }) => {
      if (upload === 'refuse') throw Error('The host refused.')
      saved = Boolean(upload)
      return { upload: saved, saves: true }
    },
  }
  let seen: ReturnType<typeof useUsageUpload> | null = null
  const Probe = () => {
    seen = useUsageUpload()
    return null
  }

  const view = await mountView(() => createElement(Probe))
  await view.change(settled)
  assert.deepEqual(seen!.host, { upload: false, saves: true })

  await view.change(async () => {
    await seen!.apply(true)
  })
  assert.deepEqual(asked, ['usage.read', 'usage.apply {"upload":true}'])
  assert.deepEqual(seen!.host, { upload: true, saves: true })
  assert.equal(seen!.trouble, null)

  await view.change(async () => {
    await seen!.apply('refuse' as never)
  })
  assert.match(seen!.trouble ?? '', /The host refused\./)
  assert.deepEqual(seen!.host, { upload: true, saves: true }, 'what hobkin has stays shown')
  await view.unmount()
})
