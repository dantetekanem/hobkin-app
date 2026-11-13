import { useNoticePermission } from './permission.ts'
import { permissionLine } from './rules.ts'

/** A plain line for Settings, shown only when the Mac refused hobkin's notifications, with how to turn them on. */
export function NotificationsLine({ className = 'text-[13px] text-muted-foreground' }: { className?: string }) {
  const line = useNoticePermission((state) => permissionLine(state.state))
  return line ? (
    <p role="status" className={className}>
      {line}
    </p>
  ) : null
}
