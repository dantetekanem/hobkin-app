/** Whether a process is still there. Signal 0 checks without sending anything. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it is there, but another user owns it.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Tells `gone` once the process that started this host has gone, looking every `every` milliseconds.
 * A shell killed without stopping its host, as `tauri dev` does when it rebuilds the app, would otherwise leave the
 * host running on the home and the port, and the next shell would find it there and keep it.
 */
export function watchParent(pid: number, gone: () => void, { alive = processAlive, every = 2000 }: { alive?: (pid: number) => boolean; every?: number } = {}): () => void {
  const timer = setInterval(() => {
    if (alive(pid)) return
    clearInterval(timer)
    gone()
  }, every)
  // The watch alone never keeps the host running.
  timer.unref()
  return () => clearInterval(timer)
}
