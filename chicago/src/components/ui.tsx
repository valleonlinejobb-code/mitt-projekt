import { useEffect, type ReactNode } from 'react'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

export function fmt(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0'
}

/** Panel som glider upp nerifrån (mobil) eller visas centrerad (dator). */
export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button
        aria-label="Stäng"
        className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative flex max-h-[92dvh] w-full animate-sheet-in flex-col rounded-t-3xl border border-line bg-surface shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
          <div className="min-w-0 text-lg font-semibold">{title}</div>
          <button
            onClick={onClose}
            className="grid size-10 shrink-0 place-items-center rounded-full text-muted transition hover:bg-surface-2 hover:text-white"
            aria-label="Stäng"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export function Confirm({
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string
  text: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <p className="text-muted">{text}</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button onClick={onCancel} className="h-14 rounded-2xl bg-surface-2 font-medium transition active:scale-[0.98]">
          Avbryt
        </button>
        <button
          onClick={onConfirm}
          className={cx(
            'h-14 rounded-2xl font-semibold text-black transition active:scale-[0.98]',
            danger ? 'bg-danger' : 'bg-accent',
          )}
        >
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}

export function Toast({ text, actionLabel, onAction }: { text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div
      role="status"
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex w-[min(92vw,26rem)] -translate-x-1/2 animate-toast-in items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 py-2 pr-2 pl-4 shadow-xl"
    >
      <span className="truncate text-sm">{text}</span>
      {actionLabel && onAction && (
        <button onClick={onAction} className="h-10 shrink-0 rounded-xl px-3 text-sm font-semibold text-accent hover:bg-white/5">
          {actionLabel}
        </button>
      )}
    </div>
  )
}

export function NumberStepper({
  value,
  onChange,
  step = 1,
  min,
  max,
  label,
}: {
  value: number
  onChange: (n: number) => void
  step?: number
  min?: number
  max?: number
  label: string
}) {
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-surface-2 p-1">
      <button
        aria-label={`Minska ${label}`}
        onClick={() => onChange(clamp(value - step))}
        className="grid size-11 place-items-center rounded-xl text-xl text-muted transition hover:bg-white/5 active:scale-95"
      >
        −
      </button>
      <input
        aria-label={label}
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          onChange(Number.isNaN(n) ? 0 : clamp(n))
        }}
        onFocus={(e) => e.target.select()}
        className="w-14 bg-transparent text-center text-lg font-semibold tabular-nums outline-none"
      />
      <button
        aria-label={`Öka ${label}`}
        onClick={() => onChange(clamp(value + step))}
        className="grid size-11 place-items-center rounded-xl text-xl text-muted transition hover:bg-white/5 active:scale-95"
      >
        +
      </button>
    </div>
  )
}
