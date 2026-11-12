import { randomUUID } from 'node:crypto'
import type { ThemeOperation } from '#shared/commands/registry.ts'
import type { HomeOwner } from './owner.ts'
import type { Appearance } from './appearance.ts'

async function bounded<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('Theme cleanup is unconfirmed.')), ms)
    })
    return await Promise.race([work, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** One Settings request, bound to the installed application; never a main-chat capability. */
export function appearanceSession(owner: Pick<HomeOwner, 'captureExecution'>, appearance: Appearance, deadlineMs = 120_000) {
  let receipt: ThemeOperation | null = null
  let finished = Promise.resolve()
  let closed = false
  let stop = () => {}

  return {
    start(request: string): ThemeOperation {
      if (closed || (receipt && receipt.cleanup !== 'confirmed')) {
        throw Error('A theme operation is active or its cleanup is unknown.')
      }

      const captured = owner.captureExecution()
      const app = captured?.app
      const main = app?.runtime.main
      const sessionId = (main as { sessionId?: unknown } | null)?.sessionId
      if (!app || !captured || !main || typeof sessionId !== 'string' || !sessionId || !app.runtime.ownedLifecycle) {
        throw Error('Theme authority is unavailable.')
      }

      if (app.config.launcher !== undefined) throw Error('Configured launchers cannot customize themes.')

      const { epoch, home } = captured
      const { cwd, model, effort } = app.config.main
      if (!model || !request.trim() || request.length > 4000) throw Error('Theme authority or request is invalid.')

      const operation: ThemeOperation = {
        id: randomUUID(),
        request,
        status: 'running',
        appearanceId: null,
        error: null,
        cleanup: 'pending',
        child: null,
      }
      let cancel!: (error: Error) => void
      const cancelled = new Promise<never>((_, reject) => {
        cancel = reject
      })
      const expires = Date.now() + deadlineMs
      let active = true
      let attempted = false
      let uncertain = false

      const current = () => {
        const currentExecution = owner.captureExecution()
        return (
          active &&
          !closed &&
          Date.now() < expires &&
          currentExecution?.app === app &&
          currentExecution.epoch === epoch &&
          currentExecution.home === home &&
          app.runtime.main === main &&
          (main as { sessionId?: unknown }).sessionId === sessionId &&
          app.config.launcher === undefined &&
          app.config.main.cwd === cwd &&
          app.config.main.model === model &&
          app.config.main.effort === effort
        )
      }

      const root = app.runtime.ownedLifecycle.register({
        id: operation.id,
        binding: { cwd, prompt: request, model, effort, role: 'theme', parentRole: 'theme' },
        allowHelpers: true,
        beforeSpawn: current,
        customStyle: async (request, signal) => {
          if (!current() || signal.aborted) throw Error('Theme authority expired or was cancelled.')
          if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('Invalid style operation.')

          const args = request as Record<string, unknown>
          const keys = Object.keys(args).sort().join(',')
          if (args.op === 'read' && keys === 'op') return appearance.readStyle()
          if (
            args.op !== 'replace' ||
            keys !== 'css,op' ||
            typeof args.css !== 'string' ||
            args.css.length > 16384
          ) {
            throw Error('Only fixed-file read or replace is allowed.')
          }
          if (attempted) throw Error('A replacement was already attempted; do not retry.')

          attempted = true
          if (!current() || signal.aborted) throw Error('Theme authority expired or was cancelled.')

          try {
            const saved = appearance.replaceStyle({ content: args.css })
            operation.appearanceId = saved.appearanceId
            return saved
          } catch (error) {
            uncertain = true
            operation.error = 'Theme save outcome is unknown; do not retry.'
            throw error
          }
        },
      })

      receipt = operation
      stop = () => {
        if (active) {
          active = false
          cancel(Error('Theme operation cancelled or its deadline expired.'))
        }
      }
      const timer = setTimeout(stop, deadlineMs)

      finished = (async () => {
        try {
          root.request({ action: 'spawn', name: 'Custom theme', allowHelpers: false })
          const childCompletion = root.join()
          await Promise.race([childCompletion, cancelled])
          operation.child = app.runtime.ownedLifecycle.snapshot(operation.id)?.[0]?.status ?? 'unknown'
          if (operation.child !== 'completed' || operation.appearanceId === null) {
            throw Error('The theme child did not complete a confirmed save.')
          }
        } catch (error) {
          operation.error ??= (error instanceof Error ? error.message : String(error)).slice(0, 500)
        } finally {
          active = false
          clearTimeout(timer)

          try {
            operation.cleanup = (await bounded(root.cancel(), 2000)).confirmed === true ? 'confirmed' : 'unknown'
          } catch {
            operation.cleanup = 'unknown'
          }

          operation.status = uncertain || operation.cleanup === 'unknown'
            ? 'unknown'
            : operation.error
              ? 'failed'
              : 'completed'
        }
      })()

      return { ...operation }
    },
    status(id?: string): ThemeOperation | null {
      return receipt && (!id || receipt.id === id) ? { ...receipt } : null
    },
    settled: () => finished,
    close() {
      closed = true
      stop()
      return finished
    },
  }
}
