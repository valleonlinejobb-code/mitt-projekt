import { useState } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS } from '../lib/game'
import type { Rules } from '../lib/rules'
import { cx } from './ui'

export function Setup({
  initialNames,
  rules,
  onOpenRules,
  onStart,
}: {
  initialNames: string[]
  rules: Rules
  onOpenRules: () => void
  onStart: (names: string[]) => void
}) {
  const [count, setCount] = useState(Math.min(MAX_PLAYERS, Math.max(initialNames.length || 4, MIN_PLAYERS)))
  const [names, setNames] = useState<string[]>(() =>
    Array.from({ length: MAX_PLAYERS }, (_, i) => initialNames[i] ?? ''),
  )

  const setName = (i: number, v: string) => setNames((n) => n.map((x, j) => (j === i ? v : x)))

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="mb-8">
        <p className="text-sm font-medium tracking-wide text-accent uppercase">Poängräknare</p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Chicago</h1>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted">Antal spelare</h2>
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
            <button
              key={n}
              onClick={() => setCount(n)}
              className={cx(
                'h-14 rounded-2xl text-lg font-semibold transition active:scale-95',
                n === count ? 'bg-accent text-black' : 'bg-surface text-muted hover:text-white',
              )}
              aria-pressed={n === count}
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-muted">Namn</h2>
        <div className="space-y-2">
          {Array.from({ length: count }, (_, i) => (
            <input
              key={i}
              value={names[i]}
              onChange={(e) => setName(i, e.target.value)}
              placeholder={`Spelare ${i + 1}`}
              maxLength={20}
              autoCapitalize="words"
              enterKeyHint={i === count - 1 ? 'go' : 'next'}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const next = (e.currentTarget.parentElement?.children[i + 1] as HTMLInputElement | undefined)
                if (next) next.focus()
                else onStart(names.slice(0, count))
              }}
              className="h-14 w-full rounded-2xl border border-line bg-surface px-4 text-lg outline-none transition placeholder:text-muted/60 focus:border-accent"
            />
          ))}
        </div>
      </section>

      <button
        onClick={onOpenRules}
        className="mt-8 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-4 text-left transition hover:border-muted/50"
      >
        <span>
          <span className="block font-medium">Regler</span>
          <span className="block text-sm text-muted">
            Vinst vid {rules.winLimit} · Sista stick {rules.lastTrick} · Chicago ±{rules.chicagoWin}
            {rules.pokerStopAt !== null && ` · Pokerspärr ${rules.pokerStopAt}`}
          </span>
        </span>
        <span className="text-muted">Ändra</span>
      </button>

      <div className="flex-1" />

      <button
        onClick={() => onStart(names.slice(0, count))}
        className="mt-8 h-16 rounded-2xl bg-accent text-lg font-semibold text-black shadow-lg shadow-accent/20 transition active:scale-[0.98]"
      >
        Starta spel
      </button>
    </main>
  )
}
