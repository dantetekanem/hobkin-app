import type { BuiltInTheme } from '#shared/protocol/appearance.ts'

/**
 * The host keeps the last custom theme and shows it again each time it starts. So when the user picks Light, Dark or
 * Follow the Mac themselves, the host is told the way hobkin tells it (`appearance.use`), and forgets the custom one.
 * Choosing Custom keeps what the host has. Without a host there is nobody to tell, and a host that refuses never
 * undoes the choice the window already shows.
 */
export function tellHostTheme(
  choice: BuiltInTheme | 'custom',
  host: { connected: boolean; run: (name: 'appearance.use', args: { theme: BuiltInTheme }) => Promise<unknown> },
): void {
  if (choice === 'custom' || !host.connected) return
  void host.run('appearance.use', { theme: choice }).catch(() => {})
}
