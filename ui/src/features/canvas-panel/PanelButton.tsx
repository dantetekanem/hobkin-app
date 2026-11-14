import type { ReactNode } from 'react'

/** A round button of the canvas's browser bar, named by its label. */
export function PanelButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors duration-[160ms] hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}
