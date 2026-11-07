import { totals, type Game, type Player } from '../lib/game'
import { cx } from './ui'

export function WinnerModal({
  game,
  winner,
  onContinue,
  onUndo,
  onNewGame,
}: {
  game: Game
  winner: Player
  onContinue: () => void
  onUndo: () => void
  onNewGame: () => void
}) {
  const t = totals(game)
  const standings = [...game.players].sort((a, b) => t[b.id] - t[a.id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/75 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm animate-sheet-in rounded-3xl border border-gold/40 bg-surface p-6 text-center shadow-2xl shadow-gold/10">
        <svg viewBox="0 0 24 24" className="mx-auto size-14 animate-pop text-gold" fill="currentColor">
          <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z" />
        </svg>
        <p className="mt-3 text-sm font-medium tracking-wide text-gold uppercase">Vinnare</p>
        <h2 className="mt-1 truncate text-3xl font-bold">{winner.name}</h2>
        <p className="mt-1 text-muted">{t[winner.id]} poäng efter {game.round} giv</p>

        <ol className="mt-5 space-y-1 text-left">
          {standings.map((p, i) => (
            <li
              key={p.id}
              className={cx('flex items-center gap-3 rounded-xl px-3 py-2', p.id === winner.id && 'bg-gold/10')}
            >
              <span className="w-5 text-sm text-muted tabular-nums">{i + 1}</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="font-semibold tabular-nums">{t[p.id]}</span>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid gap-2">
          <button onClick={onNewGame} className="h-14 rounded-2xl bg-accent font-semibold text-black transition active:scale-[0.98]">
            Nytt spel
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onContinue} className="h-12 rounded-2xl bg-surface-2 font-medium transition active:scale-[0.98]">
              Spela vidare
            </button>
            <button onClick={onUndo} className="h-12 rounded-2xl bg-surface-2 font-medium text-muted transition active:scale-[0.98]">
              Ångra senaste
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
