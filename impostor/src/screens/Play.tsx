import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Button, Screen, cx } from '../components/ui'
import { feedback } from '../lib/feedback'
import type { Player, Round } from '../lib/game'

export function Play({
  round,
  players,
  eliminated,
  clueRound,
  timerSeconds,
  onVote,
  onAbort,
}: {
  round: Round
  players: Player[]
  eliminated: string[]
  clueRound: number
  timerSeconds: number
  onVote: () => void
  onAbort: () => void
}) {
  const byId = (id: string) => players.find((p) => p.id === id)!
  const order = round.order.filter((id) => !eliminated.includes(id))
  const [current, setCurrent] = useState(0)

  return (
    <Screen>
      <header className="flex items-center justify-between">
        <button onClick={onAbort} className="text-sm text-mute hover:text-ivory">
          Avsluta
        </button>
        <span className="text-sm text-mute">
          Runda {round.number}
          {clueRound > 1 && ` · varv ${clueRound}`}
        </span>
      </header>

      <section className="mt-6">
        <p className="text-xs font-semibold tracking-[0.14em] text-mute uppercase">Kategori</p>
        <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tight text-balance">{round.categoryName}</h1>
        {clueRound > 1 && (
          <p className="mt-2 rounded-2xl bg-signal/10 px-3 py-2 text-sm text-signal">
            Minst en impostor är kvar. Kör ett nytt varv med ledtrådar.
          </p>
        )}
      </section>

      {timerSeconds > 0 && <Timer seconds={timerSeconds} />}

      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-mute uppercase">Turordning</h2>
          <span className="text-sm text-mute">Tryck för att markera vems tur det är</span>
        </div>
        <ol className="space-y-2">
          {order.map((id, i) => {
            const active = i === current % order.length
            return (
              <motion.li key={id} layout>
                <button
                  onClick={() => setCurrent(i)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
                    active ? 'border-brass/50 bg-brass/10' : 'border-line bg-panel',
                  )}
                >
                  <span className={cx('w-6 font-display font-bold tabular-nums', active ? 'text-brass' : 'text-mute')}>{i + 1}</span>
                  <span className="flex-1 truncate text-lg font-medium">{byId(id).name}</span>
                  {i === 0 && <span className="rounded-full bg-panel-2 px-2.5 py-0.5 text-xs text-mute">Börjar</span>}
                </button>
              </motion.li>
            )
          })}
        </ol>
        <Button className="mt-3 w-full" onClick={() => setCurrent((c) => (c + 1) % order.length)}>
          Nästa spelare
        </Button>
      </section>

      <div className="flex-1" />
      <Button variant="primary" className="mt-8 h-16 w-full text-lg" onClick={onVote}>
        Till röstning
      </Button>
    </Screen>
  )
}

function Timer({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds)
  const [running, setRunning] = useState(false)
  const last = useRef(left)

  useEffect(() => {
    if (!running) return
    const t = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000)
    return () => window.clearInterval(t)
  }, [running])

  useEffect(() => {
    if (left === last.current) return
    last.current = left
    if (left === 0) {
      setRunning(false)
      feedback('alarm')
    } else if (left <= 5 && running) feedback('tick')
  }, [left, running])

  const pct = left / seconds
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, '0')
  const R = 26
  const C = 2 * Math.PI * R

  return (
    <section className="mt-5 flex items-center gap-4 rounded-3xl border border-line bg-panel p-4">
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="var(--color-line)" strokeWidth="6" />
        <motion.circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke={left <= 10 ? 'var(--color-signal)' : 'var(--color-brass)'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={{ duration: 0.9, ease: 'linear' }}
        />
      </svg>
      <div className="flex-1">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={left}
            initial={{ y: -8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={cx('font-display text-3xl font-bold tabular-nums', left <= 10 && 'text-signal')}
          >
            {mm}:{ss}
          </motion.div>
        </AnimatePresence>
        <div className="text-sm text-mute">{left === 0 ? 'Tiden är slut' : 'Diskussion'}</div>
      </div>
      <div className="flex gap-1">
        <Button className="w-20" onClick={() => (left === 0 ? (setLeft(seconds), setRunning(true)) : setRunning(!running))}>
          {running ? 'Paus' : left === seconds ? 'Starta' : left === 0 ? 'Igen' : 'Fortsätt'}
        </Button>
      </div>
    </section>
  )
}
