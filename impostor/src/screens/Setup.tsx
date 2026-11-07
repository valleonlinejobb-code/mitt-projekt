import { AnimatePresence, motion, Reorder } from 'motion/react'
import { useState } from 'react'
import { Button, Mask, Screen, Stepper, cx } from '../components/ui'
import { MAX_PLAYERS, maxImpostors, MIN_PLAYERS, newId, type Category, type Player, type Settings } from '../lib/game'

const MODE_LABEL: Record<Settings['mode'], string> = { classic: 'Classic', hint: 'Hint', random: 'Random' }
const DIFF_LABEL: Record<Settings['difficulty'], string> = { easy: 'Lätt', medium: 'Medel', hard: 'Svår' }

export function Setup({
  players,
  settings,
  categories,
  error,
  onPlayers,
  onSettings,
  onStart,
  open,
}: {
  players: Player[]
  settings: Settings
  categories: Category[]
  error: string | null
  onPlayers: (p: Player[]) => void
  onSettings: (s: Settings) => void
  onStart: () => void
  open: (panel: 'categories' | 'settings' | 'rules' | 'stats') => void
}) {
  const [newName, setNewName] = useState('')
  const maxImp = maxImpostors(players.length)
  const selected = settings.categoryIds.length ? settings.categoryIds.filter((id) => categories.some((c) => c.id === id)).length : categories.length

  const add = () => {
    if (players.length >= MAX_PLAYERS) return
    const name = newName.trim() || `Spelare ${players.length + 1}`
    onPlayers([...players, { id: newId(), name }])
    setNewName('')
  }
  const rename = (id: string, name: string) => onPlayers(players.map((p) => (p.id === id ? { ...p, name } : p)))
  const remove = (id: string) => {
    if (players.length <= MIN_PLAYERS) return
    const next = players.filter((p) => p.id !== id)
    onPlayers(next)
    if (settings.startPlayer === id) onSettings({ ...settings, startPlayer: 'random' })
  }

  const names = players.map((p) => p.name.trim().toLowerCase())
  const dupNames = names.some((n, i) => n && names.indexOf(n) !== i)

  return (
    <Screen>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Mask className="size-9 text-signal" />
          <span className="font-display text-2xl font-extrabold tracking-tight">Impostor</span>
        </div>
        <nav className="flex gap-1">
          <IconBtn label="Regler" onClick={() => open('rules')}>
            <path d="M12 17v.01M12 13.5a2.5 2.5 0 1 0-2.5-2.5" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" />
          </IconBtn>
          <IconBtn label="Statistik" onClick={() => open('stats')}>
            <path d="M5 20V10M12 20V4M19 20v-7" strokeLinecap="round" />
          </IconBtn>
          <IconBtn label="Inställningar" onClick={() => open('settings')}>
            <path d="M4 7h10M18 7h2M4 17h4M12 17h8" strokeLinecap="round" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="10" cy="17" r="2" />
          </IconBtn>
        </nav>
      </header>

      <section className="mt-7">
        <h1 className="font-display text-[2.6rem] leading-[0.95] font-extrabold tracking-tight text-balance">
          Vem av er <span className="text-signal">ljuger</span>?
        </h1>
        <p className="mt-2 text-mute">Alla får samma hemliga ord. Utom impostorn.</p>
      </section>

      <section className="mt-7">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-mute uppercase">Spelare</h2>
          <span className="text-sm text-mute tabular-nums">
            {players.length} av {MAX_PLAYERS}
          </span>
        </div>
        <Reorder.Group axis="y" values={players} onReorder={onPlayers} className="space-y-2">
          <AnimatePresence initial={false}>
            {players.map((p, i) => (
              <Reorder.Item
                key={p.id}
                value={p}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 rounded-2xl border border-line bg-panel pr-1.5 pl-2"
              >
                <span className="grid h-12 w-7 shrink-0 cursor-grab place-items-center text-mute/60 active:cursor-grabbing" aria-hidden>
                  <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
                    <circle cx="9" cy="7" r="1.5" />
                    <circle cx="15" cy="7" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="17" r="1.5" />
                    <circle cx="15" cy="17" r="1.5" />
                  </svg>
                </span>
                <span className="w-5 text-sm text-mute tabular-nums">{i + 1}</span>
                <input
                  value={p.name}
                  onChange={(e) => rename(p.id, e.target.value)}
                  onBlur={(e) => !e.target.value.trim() && rename(p.id, `Spelare ${i + 1}`)}
                  maxLength={18}
                  aria-label={`Namn för spelare ${i + 1}`}
                  className="h-12 min-w-0 flex-1 bg-transparent text-lg outline-none"
                />
                <button
                  onClick={() => remove(p.id)}
                  disabled={players.length <= MIN_PLAYERS}
                  aria-label={`Ta bort ${p.name}`}
                  className="grid size-10 place-items-center rounded-xl text-mute transition hover:bg-panel-2 hover:text-signal disabled:opacity-20"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                  </svg>
                </button>
              </Reorder.Item>
            ))}
          </AnimatePresence>
        </Reorder.Group>

        {players.length < MAX_PLAYERS && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              add()
            }}
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Lägg till spelare"
              maxLength={18}
              aria-label="Namn på ny spelare"
              className="h-12 min-w-0 flex-1 rounded-2xl border border-dashed border-line bg-transparent px-4 outline-none placeholder:text-mute/70 focus:border-mute"
            />
            <Button type="submit" ariaLabel="Lägg till spelare" className="w-12 px-0">
              <svg viewBox="0 0 24 24" className="size-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </Button>
          </form>
        )}
        {dupNames && <p className="mt-2 text-sm text-brass">Två spelare har samma namn. Byt gärna så att ni inte blandar ihop dem.</p>}
      </section>

      <section className="mt-6 divide-y divide-line rounded-3xl border border-line bg-panel px-4">
        <div className="flex items-center justify-between gap-3 py-3">
          <div>
            <div className="font-medium">Impostors</div>
            <div className="text-sm text-mute">Högst {maxImp} med {players.length} spelare</div>
          </div>
          <Stepper
            label="antal impostors"
            value={Math.min(settings.impostorCount, maxImp)}
            min={1}
            max={maxImp}
            onChange={(n) => onSettings({ ...settings, impostorCount: n })}
          />
        </div>
        <SummaryRow label="Kategorier" value={`${selected} valda`} onClick={() => open('categories')} />
        <SummaryRow
          label="Läge"
          value={`${MODE_LABEL[settings.mode]}${settings.mode === 'random' ? ` · ${settings.hintChance} %` : ''} · ${DIFF_LABEL[settings.difficulty]}`}
          onClick={() => open('settings')}
        />
        <SummaryRow
          label="Startspelare"
          value={settings.startPlayer === 'random' ? 'Slumpas' : (players.find((p) => p.id === settings.startPlayer)?.name ?? 'Slumpas')}
          onClick={() => open('settings')}
        />
      </section>

      <div className="flex-1" />

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            role="alert"
            className="mt-5 rounded-2xl bg-signal/10 px-4 py-3 text-sm text-signal"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <Button variant="primary" onClick={onStart} className="mt-6 h-16 w-full text-lg">
        Starta runda
      </Button>
    </Screen>
  )
}

function SummaryRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between gap-3 py-4 text-left">
      <span className="font-medium">{label}</span>
      <span className={cx('flex min-w-0 items-center gap-1 text-mute')}>
        <span className="truncate">{value}</span>
        <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-2xl text-mute transition hover:bg-panel hover:text-ivory"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        {children}
      </svg>
    </button>
  )
}
