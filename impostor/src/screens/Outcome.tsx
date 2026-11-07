import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Button, Mask, Screen, cx } from '../components/ui'
import { feedback } from '../lib/feedback'
import { POINTS, tally, type Player, type Round, type Stats, type Winner } from '../lib/game'

const nameIn = (players: Player[]) => (id: string) => players.find((p) => p.id === id)?.name ?? '?'

/** Visar röstresultatet och avslöjar den utröstade spelaren med en kort spänningspaus. */
export function Elimination({
  players,
  votes,
  eliminatedId,
  isImpostor,
  remaining,
  lastGuess,
  onContinue,
}: {
  players: Player[]
  votes: Record<string, string>
  eliminatedId: string
  isImpostor: boolean
  remaining: number
  lastGuess: boolean
  onContinue: () => void
}) {
  const [revealed, setRevealed] = useState(false)
  const name = nameIn(players)
  const t = tally(votes)
  const max = Math.max(...Object.values(t))
  const rows = Object.entries(t).sort((a, b) => b[1] - a[1])

  useEffect(() => {
    const id = window.setTimeout(() => {
      setRevealed(true)
      feedback(isImpostor ? 'win' : 'impostor')
    }, 1800)
    return () => window.clearTimeout(id)
  }, [isImpostor])

  const next = !isImpostor
    ? 'Se resultatet'
    : lastGuess
      ? `${name(eliminatedId)} får gissa ordet`
      : remaining > 0
        ? 'Nytt varv med ledtrådar'
        : 'Se resultatet'

  return (
    <Screen>
      <section className="mt-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-mute uppercase">Röstresultat</p>
        <div className="mt-3 space-y-2">
          {rows.map(([id, n], i) => (
            <div key={id} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-sm">{name(id)}</span>
              <div className="h-7 flex-1 overflow-hidden rounded-lg bg-panel">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(n / max) * 100}%` }}
                  transition={{ delay: 0.1 + i * 0.08, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
                  className={cx('h-full rounded-lg', id === eliminatedId ? 'bg-signal' : 'bg-line')}
                />
              </div>
              <span className="w-6 text-right font-display font-bold tabular-nums">{n}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center py-10 text-center">
        <p className="text-mute">Ni röstade ut</p>
        <h1 className="mt-1 font-display text-5xl font-extrabold tracking-tight">{name(eliminatedId)}</h1>
        <div className="mt-8 h-40 [perspective:900px]">
          {!revealed ? (
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 0.6, repeat: Infinity }}
              className="grid size-28 place-items-center rounded-full bg-panel"
            >
              <span className="font-display text-4xl text-mute">?</span>
            </motion.div>
          ) : (
            <motion.div
              initial={{ rotateX: -90, opacity: 0, scale: 0.8 }}
              animate={{ rotateX: 0, opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 220, damping: 16 }}
              className="flex flex-col items-center"
            >
              {isImpostor ? (
                <>
                  <Mask className="size-20 text-signal" />
                  <span className="mt-2 font-display text-3xl font-extrabold text-signal">var impostor!</span>
                </>
              ) : (
                <>
                  <span className="grid size-20 place-items-center rounded-full bg-brass/15 font-display text-4xl text-brass">✕</span>
                  <span className="mt-2 font-display text-3xl font-extrabold text-brass">var oskyldig</span>
                </>
              )}
            </motion.div>
          )}
        </div>
        {revealed && isImpostor && remaining > 0 && !lastGuess && (
          <p className="text-mute">Det finns {remaining === 1 ? 'en impostor' : `${remaining} impostors`} kvar.</p>
        )}
      </section>

      <Button variant="primary" className="h-16 w-full text-lg" disabled={!revealed} onClick={onContinue}>
        {revealed ? next : 'Avslöjar…'}
      </Button>
    </Screen>
  )
}

/** Sista chansen: impostorn säger sin gissning högt och gruppen avgör. */
export function LastGuess({
  impostorName,
  word,
  onDecide,
}: {
  impostorName: string
  word: string
  onDecide: (correct: boolean) => void
}) {
  const [shown, setShown] = useState(false)
  return (
    <Screen>
      <section className="flex flex-1 flex-col items-center justify-center text-center">
        <p className="text-xs font-semibold tracking-[0.14em] text-signal uppercase">Sista chansen</p>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight text-balance">{impostorName}, vilket är ordet?</h1>
        <p className="mt-3 max-w-sm text-mute">Säg din gissning högt. Gissar du rätt vinner impostorerna ändå.</p>
        {!shown ? (
          <Button className="mt-10 h-14 w-full max-w-sm" onClick={() => setShown(true)}>
            Gissningen är sagd – visa ordet
          </Button>
        ) : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-10 w-full max-w-sm">
            <p className="text-sm text-mute">Ordet var</p>
            <p className="mt-1 font-display text-4xl font-extrabold text-brass">{word}</p>
            <p className="mt-6 text-sm text-mute">Var gissningen rätt?</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button className="h-14" onClick={() => onDecide(false)}>
                Fel
              </Button>
              <Button variant="primary" className="h-14" onClick={() => onDecide(true)}>
                Rätt
              </Button>
            </div>
          </motion.div>
        )}
      </section>
    </Screen>
  )
}

export function Result({
  round,
  players,
  winner,
  reason,
  stats,
  onNext,
  onHome,
}: {
  round: Round
  players: Player[]
  winner: Winner
  reason: string
  stats: Stats
  onNext: () => void
  onHome: () => void
}) {
  const name = nameIn(players)
  const crewWon = winner === 'crew'
  useEffect(() => feedback(crewWon ? 'win' : 'lose'), [crewWon])
  const standings = [...players].sort((a, b) => (stats[b.name]?.points ?? 0) - (stats[a.name]?.points ?? 0))

  return (
    <Screen>
      <section className="relative mt-4 overflow-hidden rounded-[32px] border border-line bg-panel p-6 text-center">
        <Confetti color={crewWon ? 'var(--color-brass)' : 'var(--color-signal)'} />
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={cx('text-xs font-semibold tracking-[0.2em] uppercase', crewWon ? 'text-brass' : 'text-signal')}
        >
          {reason}
        </motion.p>
        <motion.h1
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
          className={cx('mt-2 font-display text-5xl font-extrabold tracking-tight', crewWon ? 'text-ivory' : 'text-signal')}
        >
          {crewWon ? 'Gruppen vinner' : round.impostorIds.length > 1 ? 'Impostorerna vinner' : 'Impostorn vinner'}
        </motion.h1>

        <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
          <div className="rounded-2xl bg-ink/50 p-4">
            <div className="text-xs tracking-[0.14em] text-mute uppercase">Ordet</div>
            <div className="mt-1 font-display text-2xl font-bold text-brass">{round.word}</div>
            <div className="text-sm text-mute">{round.categoryName}</div>
          </div>
          <div className="rounded-2xl bg-ink/50 p-4">
            <div className="text-xs tracking-[0.14em] text-mute uppercase">{round.impostorIds.length > 1 ? 'Impostors' : 'Impostor'}</div>
            {round.impostorIds.map((id) => (
              <div key={id} className="mt-1">
                <span className="font-display text-2xl font-bold text-signal">{name(id)}</span>
                <span className="ml-2 text-sm text-mute">{round.hints[id] ? `ledtråd: ${round.hints[id]}` : 'ingen ledtråd'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-mute uppercase">Poängställning</h2>
          <span className="text-sm text-mute">
            +{crewWon ? POINTS.crewWin : POINTS.impostorWin} till {crewWon ? 'gruppen' : 'impostorn'}
          </span>
        </div>
        <ol className="space-y-1.5">
          {standings.map((p, i) => {
            const won = round.impostorIds.includes(p.id) !== crewWon
            return (
              <motion.li
                key={p.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.04 }}
                className="flex items-center gap-3 rounded-2xl bg-panel px-4 py-2.5"
              >
                <span className="w-5 text-sm text-mute tabular-nums">{i + 1}</span>
                <span className="flex-1 truncate font-medium">
                  {p.name}
                  {round.impostorIds.includes(p.id) && <Mask className="ml-1.5 inline size-4 align-[-2px] text-signal" />}
                </span>
                {won && <span className="text-sm text-ok">+{round.impostorIds.includes(p.id) ? POINTS.impostorWin : POINTS.crewWin}</span>}
                <span className="w-8 text-right font-display text-lg font-bold tabular-nums">{stats[p.name]?.points ?? 0}</span>
              </motion.li>
            )
          })}
        </ol>
      </section>

      <div className="mt-8 grid grid-cols-[auto_1fr] gap-2">
        <Button className="h-16" onClick={onHome}>
          Ändra
        </Button>
        <Button variant="primary" className="h-16 text-lg" onClick={onNext}>
          Ny runda
        </Button>
      </div>
    </Screen>
  )
}

function Confetti({ color }: { color: string }) {
  const bits = Array.from({ length: 18 }, (_, i) => i)
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {bits.map((i) => (
        <motion.span
          key={i}
          className="absolute top-0 h-3 w-1.5 rounded-sm"
          style={{ left: `${(i * 53) % 100}%`, background: i % 3 === 0 ? 'var(--color-ivory)' : color }}
          initial={{ y: -20, rotate: 0, opacity: 0 }}
          animate={{ y: 420, rotate: (i % 2 ? 1 : -1) * 360, opacity: [0, 1, 1, 0] }}
          transition={{ duration: 2.2 + (i % 5) * 0.3, delay: (i % 6) * 0.08, ease: 'easeIn' }}
        />
      ))}
    </div>
  )
}
