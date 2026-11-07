import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { feedback } from '../lib/feedback'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

type BtnProps = {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  className?: string
  disabled?: boolean
  ariaLabel?: string
  type?: 'button' | 'submit'
}

export function Button({ children, onClick, variant = 'soft', className, disabled, ariaLabel, type = 'button' }: BtnProps) {
  return (
    <motion.button
      type={type}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => {
        feedback('tap')
        onClick?.()
      }}
      className={cx(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 font-semibold transition-colors disabled:opacity-35',
        variant === 'primary' && 'bg-signal text-ink shadow-[0_10px_30px_-10px_rgb(255_79_69/0.7)] hover:brightness-110',
        variant === 'soft' && 'bg-panel-2 text-ivory hover:bg-line',
        variant === 'ghost' && 'text-mute hover:bg-panel-2 hover:text-ivory',
        variant === 'danger' && 'bg-signal/15 text-signal hover:bg-signal/25',
        className,
      )}
    >
      {children}
    </motion.button>
  )
}

/** Gemensam skärmram med mjuk övergång. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
      className={cx(
        'mx-auto flex min-h-dvh w-full max-w-xl flex-col px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {children}
    </motion.main>
  )
}

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
          <motion.button
            aria-label="Stäng"
            className="absolute inset-0 bg-black/65 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="relative flex max-h-[90dvh] w-full flex-col rounded-t-[28px] border border-line bg-panel shadow-2xl sm:max-w-lg sm:rounded-[28px]"
          >
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
              <h2 className="font-display text-xl font-bold">{title}</h2>
              <button
                onClick={onClose}
                aria-label="Stäng"
                className="grid size-10 place-items-center rounded-full text-mute transition hover:bg-panel-2 hover:text-ivory"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div className="border-t border-line px-5 pt-3 pb-[max(0.9rem,env(safe-area-inset-bottom))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

export function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (n: number) => void
  label: string
}) {
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-panel-2 p-1" role="group" aria-label={label}>
      <button
        aria-label={`Minska ${label}`}
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="grid size-10 place-items-center rounded-xl text-xl text-mute transition hover:bg-line hover:text-ivory disabled:opacity-30"
      >
        −
      </button>
      <span className="w-8 text-center font-display text-lg font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        aria-label={`Öka ${label}`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid size-10 place-items-center rounded-xl text-xl text-mute transition hover:bg-line hover:text-ivory disabled:opacity-30"
      >
        +
      </button>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx('relative h-8 w-14 shrink-0 rounded-full transition-colors', on ? 'bg-signal' : 'bg-line')}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className={cx('absolute top-1 size-6 rounded-full bg-ivory shadow', on ? 'right-1' : 'left-1')}
      />
    </button>
  )
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-2xl bg-panel-2 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative min-h-10 flex-1 rounded-xl px-3 text-sm font-semibold transition-colors',
            o.value === value ? 'text-ink' : 'text-mute hover:text-ivory',
          )}
        >
          {o.value === value && (
            <motion.span
              layoutId={`seg-${label}`}
              className="absolute inset-0 rounded-xl bg-ivory"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        {hint && <div className="text-sm text-mute">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <h3 className="mt-5 mb-1 text-xs font-semibold tracking-[0.14em] text-mute uppercase first:mt-0">{children}</h3>
}

export function Mask({ className }: { className?: string }) {
  // Egen symbol: en halv mask med ett öga, spelets logotyp.
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        d="M24 6c9 0 18 4 18 14 0 11-8 22-18 22S6 31 6 20C6 10 15 6 24 6z"
        fill="currentColor"
        opacity="0.18"
      />
      <path d="M24 6c9 0 18 4 18 14 0 11-8 22-18 22z" fill="currentColor" />
      <ellipse cx="32" cy="21" rx="4.2" ry="2.6" fill="var(--color-ink)" />
      <ellipse cx="16" cy="21" rx="4.2" ry="2.6" fill="currentColor" opacity="0.45" />
    </svg>
  )
}
