import { useState } from 'react'
import { checkScore, totals, type EntryKind, type Game, type Player } from '../lib/game'
import { cx, fmt, NumberStepper, Sheet } from './ui'

export type ScoreInput = { kind: EntryKind; label: string; points: number }

export function ScoreSheet({
  game,
  player,
  onScore,
  onClose,
}: {
  game: Game
  player: Player
  onScore: (s: ScoreInput) => void
  onClose: () => void
}) {
  const [custom, setCustom] = useState(1)
  const r = game.rules
  const total = totals(game)[player.id]
  const handCheck = checkScore(game, player.id, 'hand')

  return (
    <Sheet
      onClose={onClose}
      title={
        <span className="flex items-baseline gap-2">
          <span className="truncate">{player.name}</span>
          <span className="text-sm font-normal text-muted tabular-nums">{total} p</span>
        </span>
      }
    >
      <Section title="Pokerhand">
        {!handCheck.ok && <p className="mb-2 text-sm text-gold">{handCheck.reason}</p>}
        <div className="grid grid-cols-3 gap-2">
          {r.hands
            .filter((h) => h.enabled)
            .map((h) => (
              <ScoreButton
                key={h.id}
                label={h.label}
                points={h.points}
                disabled={!handCheck.ok}
                onClick={() => onScore({ kind: 'hand', label: h.label, points: h.points })}
              />
            ))}
        </div>
      </Section>

      <Section title="Stick">
        <div className="grid grid-cols-2 gap-2">
          {r.lastTrick !== 0 && (
            <ScoreButton
              label="Sista stick"
              points={r.lastTrick}
              onClick={() => onScore({ kind: 'lastTrick', label: 'Sista stick', points: r.lastTrick })}
            />
          )}
          {r.lastTrickWithTwo !== 0 && (
            <ScoreButton
              label="Sista stick med 2:a"
              points={r.lastTrickWithTwo}
              onClick={() =>
                onScore({ kind: 'lastTrickTwo', label: 'Sista stick med 2:a', points: r.lastTrickWithTwo })
              }
            />
          )}
        </div>
      </Section>

      <Section title="Chicago">
        <div className="grid grid-cols-2 gap-2">
          <ScoreButton
            label="Lyckad"
            points={r.chicagoWin}
            tone="accent"
            onClick={() => onScore({ kind: 'chicagoWin', label: 'Chicago lyckad', points: r.chicagoWin })}
          />
          <ScoreButton
            label="Misslyckad"
            points={-Math.abs(r.chicagoLoss)}
            tone="danger"
            onClick={() =>
              onScore({ kind: 'chicagoLoss', label: 'Chicago misslyckad', points: -Math.abs(r.chicagoLoss) })
            }
          />
        </div>
      </Section>

      <Section title="Egen justering">
        <div className="flex items-center gap-2">
          <NumberStepper label="poäng" value={custom} onChange={setCustom} min={-999} max={999} />
          <button
            disabled={custom === 0}
            onClick={() => onScore({ kind: 'manual', label: 'Justering', points: custom })}
            className="h-13 flex-1 rounded-2xl bg-surface-2 font-semibold transition active:scale-[0.98] disabled:opacity-40"
          >
            Lägg till {fmt(custom)}
          </button>
        </div>
      </Section>
    </Sheet>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-1">
      <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  )
}

function ScoreButton({
  label,
  points,
  onClick,
  disabled,
  tone,
}: {
  label: string
  points: number
  onClick: () => void
  disabled?: boolean
  tone?: 'accent' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex min-h-16 flex-col items-center justify-center rounded-2xl border px-2 py-2 transition active:scale-95 disabled:opacity-30',
        tone === 'accent' && 'border-accent/30 bg-accent/10',
        tone === 'danger' && 'border-danger/30 bg-danger/10',
        !tone && 'border-line bg-surface-2 hover:border-muted/40',
      )}
    >
      <span className="text-center text-sm leading-tight text-white/90">{label}</span>
      <span
        className={cx(
          'mt-0.5 text-lg font-bold tabular-nums',
          points < 0 ? 'text-danger' : tone === 'accent' ? 'text-accent' : 'text-white',
        )}
      >
        {fmt(points)}
      </span>
    </button>
  )
}
