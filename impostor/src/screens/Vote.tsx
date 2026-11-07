import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Button, Screen, cx } from '../components/ui'
import type { Player, VoteMode } from '../lib/game'

/**
 * Röstning. Resultatet lämnas som röster (väljare → mål) så att samma logik
 * avgör både gemensam och hemlig röstning. Vid gemensam röstning räknar gruppen
 * händer och fyller i antal röster per spelare.
 */
export function Vote({
  mode,
  voters,
  candidates,
  isRunoff,
  onResult,
  onBack,
}: {
  mode: VoteMode
  voters: Player[]
  candidates: Player[]
  isRunoff: boolean
  onResult: (votes: Record<string, string>) => void
  onBack: () => void
}) {
  return mode === 'manual' ? (
    <ManualVote voters={voters} candidates={candidates} isRunoff={isRunoff} onResult={onResult} onBack={onBack} />
  ) : (
    <SecretVote voters={voters} candidates={candidates} isRunoff={isRunoff} onResult={onResult} onBack={onBack} />
  )
}

function Title({ isRunoff, sub }: { isRunoff: boolean; sub: string }) {
  return (
    <section className="mt-6">
      <p className="text-xs font-semibold tracking-[0.14em] text-signal uppercase">{isRunoff ? 'Utslagsomröstning' : 'Röstning'}</p>
      <h1 className="mt-1 font-display text-4xl font-extrabold tracking-tight">Vem är impostorn?</h1>
      <p className="mt-2 text-mute">{sub}</p>
    </section>
  )
}

function ManualVote({
  voters,
  candidates,
  isRunoff,
  onResult,
  onBack,
}: {
  voters: Player[]
  candidates: Player[]
  isRunoff: boolean
  onResult: (votes: Record<string, string>) => void
  onBack: () => void
}) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const set = (id: string, d: number) =>
    setCounts((c) => {
      const v = Math.max(0, (c[id] ?? 0) + d)
      if (d > 0 && total >= voters.length) return c
      return { ...c, [id]: v }
    })

  const submit = () => {
    // Gör om antal till anonyma röster.
    const votes: Record<string, string> = {}
    let n = 0
    for (const [id, k] of Object.entries(counts)) for (let i = 0; i < k; i++) votes[`hand-${n++}`] = id
    onResult(votes)
  }

  return (
    <Screen>
      <header>
        <button onClick={onBack} className="text-sm text-mute hover:text-ivory">
          ← Tillbaka
        </button>
      </header>
      <Title isRunoff={isRunoff} sub="Peka samtidigt på 3, 2, 1. Tryck på en spelare för varje röst den fick." />
      <div className="mt-5 grid grid-cols-2 gap-2">
        {candidates.map((p) => {
          const k = counts[p.id] ?? 0
          return (
            <div
              key={p.id}
              className={cx('relative rounded-2xl border transition-colors', k ? 'border-signal/60 bg-signal/10' : 'border-line bg-panel')}
            >
              <button onClick={() => set(p.id, 1)} className="flex w-full flex-col items-start p-4 text-left">
                <span className="w-full truncate text-lg font-semibold">{p.name}</span>
                <span className="mt-1 text-sm text-mute">{k === 1 ? '1 röst' : `${k} röster`}</span>
              </button>
              <AnimatePresence>
                {k > 0 && (
                  <motion.button
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    aria-label={`Ta bort en röst från ${p.name}`}
                    onClick={() => set(p.id, -1)}
                    className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-ink/70 text-mute hover:text-ivory"
                  >
                    −
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-sm text-mute tabular-nums">
        {total} av {voters.length} röster
      </p>
      <div className="flex-1" />
      <Button variant="primary" className="mt-8 h-16 w-full text-lg" disabled={total === 0} onClick={submit}>
        Avslöja
      </Button>
    </Screen>
  )
}

function SecretVote({
  voters,
  candidates,
  isRunoff,
  onResult,
  onBack,
}: {
  voters: Player[]
  candidates: Player[]
  isRunoff: boolean
  onResult: (votes: Record<string, string>) => void
  onBack: () => void
}) {
  const [i, setI] = useState(0)
  const [stage, setStage] = useState<'pass' | 'choose'>('pass')
  const [choice, setChoice] = useState<string | null>(null)
  const [votes, setVotes] = useState<Record<string, string>>({})
  const voter = voters[i]
  const options = candidates.filter((c) => c.id !== voter.id)

  const confirm = () => {
    if (!choice) return
    const next = { ...votes, [voter.id]: choice }
    setChoice(null)
    if (i + 1 >= voters.length) onResult(next)
    else {
      setVotes(next)
      setI(i + 1)
      setStage('pass')
    }
  }

  return (
    <Screen className="no-select">
      <header className="flex items-center justify-between">
        <button onClick={onBack} className="text-sm text-mute hover:text-ivory">
          ← Tillbaka
        </button>
        <span className="text-sm text-mute tabular-nums">
          Röst {i + 1}/{voters.length}
        </span>
      </header>
      <AnimatePresence mode="wait">
        {stage === 'pass' ? (
          <motion.section
            key={`p${i}`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            className="flex flex-1 flex-col items-center justify-center text-center"
          >
            <p className="text-xs font-semibold tracking-[0.14em] text-signal uppercase">{isRunoff ? 'Utslagsomröstning' : 'Hemlig röstning'}</p>
            <p className="mt-4 text-mute">Skicka mobilen till</p>
            <h1 className="mt-1 font-display text-5xl font-extrabold tracking-tight">{voter.name}</h1>
            <Button variant="primary" className="mt-10 h-16 w-full max-w-sm text-lg" onClick={() => setStage('choose')}>
              Jag är {voter.name}
            </Button>
          </motion.section>
        ) : (
          <motion.section key={`c${i}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col">
            <Title isRunoff={isRunoff} sub={`${voter.name}, välj i hemlighet. Ingen annan ser din röst.`} />
            <div className="mt-5 grid grid-cols-2 gap-2">
              {options.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setChoice(p.id)}
                  aria-pressed={choice === p.id}
                  className={cx(
                    'rounded-2xl border p-4 text-left text-lg font-semibold transition-colors',
                    choice === p.id ? 'border-signal bg-signal/15' : 'border-line bg-panel hover:border-mute',
                  )}
                >
                  <span className="block truncate">{p.name}</span>
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <Button variant="primary" className="mt-8 h-16 w-full text-lg" disabled={!choice} onClick={confirm}>
              Lägg rösten
            </Button>
          </motion.section>
        )}
      </AnimatePresence>
    </Screen>
  )
}
