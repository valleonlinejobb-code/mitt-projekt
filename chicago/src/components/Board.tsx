import { leaders, roundDeltas, totals, type Game, type Player } from '../lib/game'
import { cx, fmt } from './ui'

export function Board({
  game,
  canUndo,
  onPick,
  onUndo,
  onNextRound,
  onOpenHistory,
  onOpenRules,
  onNewGame,
}: {
  game: Game
  canUndo: boolean
  onPick: (p: Player) => void
  onUndo: () => void
  onNextRound: () => void
  onOpenHistory: () => void
  onOpenRules: () => void
  onNewGame: () => void
}) {
  const t = totals(game)
  const deltas = roundDeltas(game, game.round)
  const lead = new Set(leaders(game))
  const ranked = [...game.players].sort((a, b) => t[b.id] - t[a.id])
  const rank = (id: string) => ranked.findIndex((p) => t[p.id] === t[id]) + 1
  const roundHasEntries = game.entries.some((e) => e.round === game.round)
  const many = game.players.length > 4

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="text-2xl font-bold tracking-tight">Giv {game.round}</div>
          <div className="text-sm text-muted">Vinst vid {game.rules.winLimit} poäng</div>
        </div>
        <div className="flex gap-1">
          <IconButton label="Historik" onClick={onOpenHistory}>
            <path d="M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" strokeLinecap="round" strokeLinejoin="round" />
          </IconButton>
          <IconButton label="Regler" onClick={onOpenRules}>
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" strokeLinecap="round" />
            <circle cx="16" cy="6" r="2" />
            <circle cx="10" cy="12" r="2" />
            <circle cx="18" cy="18" r="2" />
          </IconButton>
          <IconButton label="Nytt spel" onClick={onNewGame}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </IconButton>
        </div>
      </header>

      <div className={cx('grid gap-3', 'grid-cols-2', game.players.length === 3 ? 'sm:grid-cols-3' : many ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {game.players.map((p) => {
          const total = t[p.id]
          const d = deltas[p.id]
          const isLead = lead.has(p.id)
          const progress = Math.max(0, Math.min(1, total / game.rules.winLimit))
          return (
            <button
              key={p.id}
              onClick={() => onPick(p)}
              className={cx(
                'group relative flex flex-col overflow-hidden rounded-3xl border p-4 text-left transition active:scale-[0.97]',
                many ? 'min-h-32' : 'min-h-40',
                isLead ? 'border-gold/50 bg-gold/[0.06]' : 'border-line bg-surface hover:border-muted/40',
              )}
              aria-label={`${p.name}, ${total} poäng. Tryck för att registrera poäng.`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">{p.name}</span>
                {isLead && (
                  <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-gold" fill="currentColor" aria-label="Leder">
                    <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
                  </svg>
                )}
                <span className="ml-auto text-xs text-muted tabular-nums">#{rank(p.id)}</span>
              </div>

              <div className="mt-auto flex items-end justify-between gap-2 pt-3">
                <span
                  key={total}
                  className={cx(
                    'inline-block animate-pop font-bold tracking-tight tabular-nums',
                    many ? 'text-4xl' : 'text-5xl',
                    total < 0 && 'text-danger',
                    isLead && 'text-gold',
                  )}
                >
                  {total < 0 ? `−${Math.abs(total)}` : total}
                </span>
                {d !== 0 && (
                  <span
                    key={`d${d}`}
                    className={cx(
                      'mb-1 animate-fade-in rounded-full px-2 py-0.5 text-sm font-semibold tabular-nums',
                      d > 0 ? 'bg-accent/15 text-accent' : 'bg-danger/15 text-danger',
                    )}
                  >
                    {fmt(d)}
                  </span>
                )}
              </div>

              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/5">
                <div
                  className={cx('h-full rounded-full transition-[width] duration-500', isLead ? 'bg-gold' : 'bg-accent/70')}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </button>
          )
        })}
      </div>

      {game.entries.length === 0 && (
        <p className="mt-6 text-center text-sm text-muted">Tryck på en spelare för att ge poäng.</p>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-[auto_1fr] gap-3">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="flex h-14 items-center gap-2 rounded-2xl bg-surface-2 px-5 font-medium transition active:scale-[0.97] disabled:opacity-35"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Ångra
          </button>
          <button
            onClick={onNextRound}
            className={cx(
              'h-14 rounded-2xl font-semibold transition active:scale-[0.98]',
              roundHasEntries ? 'bg-accent text-black shadow-lg shadow-accent/20' : 'bg-surface-2 text-muted',
            )}
          >
            Nästa giv →
          </button>
        </div>
      </nav>
    </main>
  )
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-12 place-items-center rounded-2xl text-muted transition hover:bg-surface hover:text-white active:scale-95"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        {children}
      </svg>
    </button>
  )
}
