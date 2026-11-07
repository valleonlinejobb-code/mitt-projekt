import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Button, Mask, Screen, cx } from '../components/ui'
import { feedback } from '../lib/feedback'
import { roleFor, type Player, type Round, type Settings } from '../lib/game'

/**
 * Hemlig rollvisning. Ordet finns bara i DOM:en medan kortet är vänt,
 * och skärmen går alltid via ett neutralt "skicka vidare"-läge mellan spelare.
 */
export function Reveal({
  round,
  players,
  settings,
  onDone,
  onAbort,
}: {
  round: Round
  players: Player[]
  settings: Settings
  onDone: () => void
  onAbort: () => void
}) {
  const [index, setIndex] = useState(0)
  const [stage, setStage] = useState<'pass' | 'card'>('pass')
  const [revealed, setRevealed] = useState(false)
  const [seen, setSeen] = useState(false)
  const player = players[index]

  // Dölj direkt om appen hamnar i bakgrunden.
  useEffect(() => {
    const hide = () => document.hidden && setRevealed(false)
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('blur', hide)
    }
  }, [])

  const show = () => {
    if (revealed) return
    setRevealed(true)
    setSeen(true)
    const role = roleFor(round, player.id, settings.impostorsKnow)
    feedback(role.kind === 'impostor' ? 'impostor' : 'reveal')
  }
  const hide = () => setRevealed(false)

  const next = () => {
    setRevealed(false)
    setSeen(false)
    if (index + 1 >= players.length) onDone()
    else {
      setIndex(index + 1)
      setStage('pass')
    }
  }

  const hold = settings.revealStyle === 'hold'
  const role = revealed ? roleFor(round, player.id, settings.impostorsKnow) : null
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?'

  return (
    <Screen className="no-select">
      <header className="flex items-center justify-between">
        <button onClick={onAbort} className="text-sm text-mute hover:text-ivory">
          Avbryt
        </button>
        <div className="flex gap-1.5" aria-label={`Spelare ${index + 1} av ${players.length}`}>
          {players.map((p, i) => (
            <span key={p.id} className={cx('h-1.5 rounded-full transition-all', i < index ? 'w-3 bg-ivory/60' : i === index ? 'w-6 bg-signal' : 'w-3 bg-line')} />
          ))}
        </div>
        <span className="text-sm text-mute tabular-nums">
          {index + 1}/{players.length}
        </span>
      </header>

      <AnimatePresence mode="wait">
        {stage === 'pass' ? (
          <motion.section
            key={`pass-${index}`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex flex-1 flex-col items-center justify-center text-center"
          >
            <motion.div
              animate={{ rotate: [0, -8, 8, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.5 }}
              className="mb-6 grid size-20 place-items-center rounded-3xl bg-panel"
            >
              <svg viewBox="0 0 24 24" className="size-10 text-brass" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
                <path d="M11 18.5h2" strokeLinecap="round" />
              </svg>
            </motion.div>
            <p className="text-mute">Skicka mobilen till</p>
            <h1 className="mt-1 font-display text-5xl font-extrabold tracking-tight text-balance">{player.name}</h1>
            <p className="mt-3 max-w-xs text-sm text-mute">Se till att ingen annan tittar på skärmen.</p>
            <Button variant="primary" className="mt-10 h-16 w-full max-w-sm text-lg" onClick={() => setStage('card')}>
              Jag är {player.name}
            </Button>
          </motion.section>
        ) : (
          <motion.section
            key={`card-${index}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="flex flex-1 flex-col items-center justify-center"
          >
            <p className="mb-4 text-mute">
              {player.name}, {hold ? 'håll fingret på kortet' : 'tryck på kortet'}
            </p>

            <div className="w-full max-w-sm [perspective:1200px]">
              <motion.button
                aria-label={revealed ? 'Dölj min roll' : 'Visa mitt ord'}
                onContextMenu={(e) => e.preventDefault()}
                {...(hold
                  ? {
                      onPointerDown: (e: React.PointerEvent) => {
                        ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
                        show()
                      },
                      onPointerUp: hide,
                      onPointerCancel: hide,
                      onKeyDown: (e: React.KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && show(),
                      onKeyUp: hide,
                    }
                  : { onClick: () => (revealed ? hide() : show()) })}
                animate={{ rotateY: revealed ? 180 : 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                style={{ transformStyle: 'preserve-3d' }}
                className="relative block aspect-[3/4] w-full touch-none"
              >
                {/* Framsida (dold roll) */}
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center rounded-[32px] border border-line bg-panel shadow-[0_30px_60px_-25px_rgb(0_0_0/0.8)]"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  <div className="absolute inset-3 rounded-[24px] border border-dashed border-line" />
                  <Mask className="size-20 text-ivory/80" />
                  <span className="mt-5 font-display text-xl font-bold">{hold ? 'Håll för att visa' : 'Visa mitt ord'}</span>
                  <span className="mt-1 text-sm text-mute">{hold ? 'Släpp för att dölja' : 'Tryck igen för att dölja'}</span>
                </div>

                {/* Baksida (rollen) – renderas bara när kortet är vänt */}
                <div
                  className={cx(
                    'absolute inset-0 flex flex-col items-center justify-center rounded-[32px] border p-6 text-center',
                    role?.kind === 'impostor' ? 'border-signal/60 bg-[#2a1214]' : 'border-brass/40 bg-[#221d14]',
                  )}
                  style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                >
                  {role?.kind === 'crew' && (
                    <>
                      <span className="text-xs font-semibold tracking-[0.2em] text-brass uppercase">Ditt ord</span>
                      <span className="mt-4 font-display text-4xl leading-tight font-extrabold text-balance break-words">{role.word}</span>
                      <span className="mt-5 rounded-full bg-brass/15 px-3 py-1 text-sm text-brass">{role.category}</span>
                    </>
                  )}
                  {role?.kind === 'impostor' && (
                    <>
                      <Mask className="size-14 text-signal" />
                      <span className="mt-3 font-display text-4xl font-extrabold tracking-tight text-signal">Du är impostor</span>
                      <span className="mt-5 text-xs font-semibold tracking-[0.2em] text-mute uppercase">Kategori</span>
                      <span className="mt-1 font-display text-2xl font-bold">{role.category}</span>
                      {role.hint && (
                        <>
                          <span className="mt-4 text-xs font-semibold tracking-[0.2em] text-mute uppercase">Ledtråd</span>
                          <span className="mt-1 text-xl font-semibold">{role.hint}</span>
                        </>
                      )}
                      {role.partners.length > 0 && (
                        <span className="mt-4 text-sm text-mute">
                          Fler impostors: <span className="text-ivory">{role.partners.map(nameOf).join(', ')}</span>
                        </span>
                      )}
                      <span className="mt-5 text-sm text-mute">Smält in. Lyssna på de andra.</span>
                    </>
                  )}
                </div>
              </motion.button>
            </div>

            <div className="mt-8 h-16 w-full max-w-sm">
              <AnimatePresence>
                {seen && !revealed && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Button variant="primary" className="h-16 w-full text-lg" onClick={next}>
                      {index + 1 >= players.length ? 'Alla har sett – starta' : 'Klar, skicka vidare'}
                    </Button>
                  </motion.div>
                )}
                {revealed && !hold && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <Button className="h-16 w-full text-lg" onClick={hide}>
                      Dölj
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </Screen>
  )
}
