import { useState } from 'react'
import { roundDeltas, roundsWithEntries, type Entry, type Game } from '../lib/game'
import { cx, fmt, NumberStepper, Sheet } from './ui'

export function History({
  game,
  onEdit,
  onDelete,
  onClose,
}: {
  game: Game
  onEdit: (entryId: string, points: number) => void
  onDelete: (entryId: string) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const rounds = roundsWithEntries(game)
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?'

  return (
    <Sheet title="Historik" onClose={onClose}>
      {rounds.length === 0 && <p className="py-8 text-center text-muted">Inga poäng registrerade än.</p>}
      <p className={cx('mb-3 text-sm text-muted', rounds.length === 0 && 'hidden')}>
        Tryck på en rad för att rätta eller ta bort den.
      </p>
      <div className="space-y-4">
        {rounds.map((round) => {
          const deltas = roundDeltas(game, round)
          const entries = game.entries.filter((e) => e.round === round)
          return (
            <section key={round} className="rounded-2xl border border-line bg-bg/40">
              <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
                <span className="font-semibold">Giv {round}</span>
                <span className="flex flex-wrap gap-x-3 text-sm text-muted">
                  {game.players
                    .filter((p) => deltas[p.id] !== 0)
                    .map((p) => (
                      <span key={p.id}>
                        {p.name}{' '}
                        <span className={cx('tabular-nums', deltas[p.id] < 0 ? 'text-danger' : 'text-accent')}>
                          {fmt(deltas[p.id])}
                        </span>
                      </span>
                    ))}
                </span>
              </header>
              <ul>
                {entries.map((e) => (
                  <Row
                    key={e.id}
                    entry={e}
                    playerName={name(e.playerId)}
                    editing={editing === e.id}
                    onToggle={() => setEditing(editing === e.id ? null : e.id)}
                    onSave={(p) => {
                      onEdit(e.id, p)
                      setEditing(null)
                    }}
                    onDelete={() => {
                      onDelete(e.id)
                      setEditing(null)
                    }}
                  />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}

function Row({
  entry,
  playerName,
  editing,
  onToggle,
  onSave,
  onDelete,
}: {
  entry: Entry
  playerName: string
  editing: boolean
  onToggle: () => void
  onSave: (points: number) => void
  onDelete: () => void
}) {
  const [value, setValue] = useState(entry.points)
  return (
    <li className="border-b border-line/60 last:border-0">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02]">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{playerName}</span>
          <span className="block text-sm text-muted">{entry.label}</span>
        </span>
        <span className={cx('text-lg font-semibold tabular-nums', entry.points < 0 ? 'text-danger' : 'text-accent')}>
          {fmt(entry.points)}
        </span>
      </button>
      {editing && (
        <div className="flex animate-fade-in flex-wrap items-center gap-2 px-4 pb-3">
          <NumberStepper label="Rättad poäng" value={value} onChange={setValue} min={-999} max={999} />
          <button
            onClick={() => onSave(value)}
            className="h-13 flex-1 rounded-2xl bg-accent px-4 font-semibold text-black transition active:scale-[0.98]"
          >
            Spara
          </button>
          <button
            onClick={onDelete}
            className="h-13 rounded-2xl bg-danger/15 px-4 font-medium text-danger transition active:scale-[0.98]"
          >
            Ta bort
          </button>
        </div>
      )}
    </li>
  )
}
