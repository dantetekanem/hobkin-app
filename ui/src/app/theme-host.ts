import type { BuiltInTheme } from '#shared/protocol/appearance.ts'

/**
 * The host shows the custom theme on now again each time it starts. So when the user picks Light, Dark or Follow the
 * Mac themselves, the host is told the way hobkin tells it (`appearance.use`), and starts on that base instead. The
 * custom theme stays in its kept list for Custom to bring back. Choosing Custom keeps what the host has. Without a
 * host there is nobody to tell, and a host that refuses never undoes the choice the window already shows.
 */
export function tellHostTheme(
  choice: BuiltInTheme | 'custom',
  host: { connected: boolean; run: (name: 'appearance.use', args: { theme: BuiltInTheme }) => Promise<unknown> },
): void {
  if (choice === 'custom' || !host.connected) return
  void host.run('appearance.use', { theme: choice }).catch(() => {})
}
