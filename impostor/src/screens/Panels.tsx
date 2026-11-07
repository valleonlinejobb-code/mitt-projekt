import { useMemo, useState } from 'react'
import { Button, Label, Row, Segmented, Sheet, Toggle, cx } from '../components/ui'
import { GROUPS } from '../data/words'
import { newId, normalize, type Category, type Player, type Settings, type Stats } from '../lib/game'

// ---------------- Kategorier ----------------

export function CategoriesPanel({
  open,
  onClose,
  categories,
  settings,
  onSettings,
  onCustom,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  settings: Settings
  onSettings: (s: Settings) => void
  onCustom: (cats: Category[]) => void
}) {
  const [creating, setCreating] = useState(false)
  const allIds = categories.map((c) => c.id)
  const selected = new Set(settings.categoryIds.length ? settings.categoryIds : allIds)
  const setSelected = (ids: Set<string>) =>
    onSettings({ ...settings, categoryIds: ids.size === allIds.length ? [] : allIds.filter((id) => ids.has(id)) })

  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    if (next.size > 0) setSelected(next)
  }
  const groups = [...GROUPS, 'Egna'].map((g) => ({ g, cats: categories.filter((c) => (c.custom ? 'Egna' : c.group) === g) }))
  const custom = categories.filter((c) => c.custom)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Kategorier"
      footer={
        <div className="flex gap-2">
          <Button onClick={() => setSelected(new Set(allIds))} className="flex-1">
            Alla
          </Button>
          <Button onClick={() => setCreating(true)} className="flex-1">
            + Egen
          </Button>
          <Button variant="primary" onClick={onClose} className="flex-1">
            Klar
          </Button>
        </div>
      }
    >
      <p className="text-sm text-mute">
        {selected.size} av {allIds.length} valda. Ordet slumpas från alla valda kategorier.
      </p>
      {groups
        .filter((x) => x.cats.length)
        .map(({ g, cats }) => {
          const allOn = cats.every((c) => selected.has(c.id))
          return (
            <div key={g}>
              <div className="mt-5 mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-[0.14em] text-mute uppercase">{g}</h3>
                <button
                  className="text-sm text-mute hover:text-ivory"
                  onClick={() => {
                    const next = new Set(selected)
                    cats.forEach((c) => (allOn ? next.delete(c.id) : next.add(c.id)))
                    if (next.size > 0) setSelected(next)
                  }}
                >
                  {allOn ? 'Välj bort' : 'Välj alla'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {cats.map((c) => {
                  const on = selected.has(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      aria-pressed={on}
                      className={cx(
                        'min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors',
                        on ? 'border-ivory bg-ivory text-ink' : 'border-line text-mute hover:text-ivory',
                      )}
                    >
                      {c.name}
                      <span className={cx('ml-1.5 tabular-nums', on ? 'text-ink/55' : 'text-mute/60')}>{c.words.length}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}

      {custom.length > 0 && (
        <div className="mt-6 space-y-2">
          <Label>Hantera egna</Label>
          {custom.map((c) => (
            <div key={c.id} className="flex items-center justify-between rounded-2xl bg-panel-2 px-4 py-2">
              <span>
                {c.name} <span className="text-sm text-mute">· {c.words.length} ord</span>
              </span>
              <Button variant="danger" className="min-h-9 px-3 text-sm" onClick={() => onCustom(custom.filter((x) => x.id !== c.id))}>
                Ta bort
              </Button>
            </div>
          ))}
        </div>
      )}

      <CustomCategoryForm
        open={creating}
        existing={categories}
        onClose={() => setCreating(false)}
        onSave={(c) => {
          onCustom([...custom, c])
          setCreating(false)
        }}
      />
    </Sheet>
  )
}

function CustomCategoryForm({
  open,
  existing,
  onClose,
  onSave,
}: {
  open: boolean
  existing: Category[]
  onClose: () => void
  onSave: (c: Category) => void
}) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const parsed = useMemo(() => {
    const seen = new Set<string>()
    return text
      .split('\n')
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter(([w]) => w && !seen.has(normalize(w)) && seen.add(normalize(w)))
      .map(([word, ...hints]) => ({ word, hints: hints.filter(Boolean).slice(0, 2), difficulty: 'medium' as const }))
  }, [text])
  const nameTaken = existing.some((c) => normalize(c.name) === normalize(name))
  const valid = name.trim().length > 0 && !nameTaken && parsed.length >= 3

  return (
    <Sheet open={open} onClose={onClose} title="Egen kategori">
      <label className="block text-sm text-mute" htmlFor="cc-name">
        Namn
      </label>
      <input
        id="cc-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={30}
        placeholder="Till exempel: Vår klass"
        className="mt-1 h-12 w-full rounded-2xl border border-line bg-panel-2 px-4 outline-none focus:border-mute"
      />
      {nameTaken && <p className="mt-1 text-sm text-signal">Det finns redan en kategori med det namnet.</p>}
      <label className="mt-4 block text-sm text-mute" htmlFor="cc-words">
        Ord, ett per rad. Lägg till ledtrådar efter ett streck om du vill: <span className="text-ivory">Ord | ledtråd | ledtråd</span>
      </label>
      <textarea
        id="cc-words"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder={'Tågresan till Malmö | Resa | Skåne\nMattelärarens slips\nFesten hos Ella'}
        className="mt-1 w-full rounded-2xl border border-line bg-panel-2 p-4 outline-none focus:border-mute"
      />
      <p className="mt-1 text-sm text-mute">{parsed.length} ord. Minst 3 behövs.</p>
      <Button
        variant="primary"
        disabled={!valid}
        className="mt-4 w-full"
        onClick={() => {
          onSave({ id: `egen-${newId()}`, name: name.trim(), group: 'Egna', custom: true, words: parsed })
          setName('')
          setText('')
        }}
      >
        Spara kategori
      </Button>
    </Sheet>
  )
}

// ---------------- Inställningar ----------------

export function SettingsPanel({
  open,
  onClose,
  settings,
  players,
  onSettings,
}: {
  open: boolean
  onClose: () => void
  settings: Settings
  players: Player[]
  onSettings: (s: Settings) => void
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onSettings({ ...settings, [k]: v })
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Inställningar"
      footer={
        <Button variant="primary" onClick={onClose} className="w-full">
          Klar
        </Button>
      }
    >
      <Label>Impostorns information</Label>
      <Segmented
        label="Spelläge"
        value={settings.mode}
        onChange={(v) => set('mode', v)}
        options={[
          { value: 'classic', label: 'Classic' },
          { value: 'hint', label: 'Hint' },
          { value: 'random', label: 'Random' },
        ]}
      />
      <p className="mt-2 text-sm text-mute">
        {settings.mode === 'classic' && 'Impostorn ser bara kategorin.'}
        {settings.mode === 'hint' && 'Impostorn ser kategorin och en vag ledtråd.'}
        {settings.mode === 'random' && 'Varje runda slumpas om impostorn får en ledtråd.'}
      </p>
      {settings.mode === 'random' && (
        <div className="mt-3">
          <div className="mb-1 text-sm">Chans för ledtråd</div>
          <Segmented
            label="Chans för ledtråd"
            value={settings.hintChance}
            onChange={(v) => set('hintChance', v)}
            options={[0, 25, 50, 75, 100].map((n) => ({ value: n, label: `${n} %` }))}
          />
        </div>
      )}
      {settings.mode !== 'classic' && (
        <Row label="Samma ledtråd till alla impostors" hint="Av = varje impostor får en egen ledtråd">
          <Toggle label="Samma ledtråd till alla impostors" on={settings.sameHint} onChange={(v) => set('sameHint', v)} />
        </Row>
      )}

      <Label>Svårighet</Label>
      <Segmented
        label="Svårighet"
        value={settings.difficulty}
        onChange={(v) => set('difficulty', v)}
        options={[
          { value: 'easy', label: 'Lätt' },
          { value: 'medium', label: 'Medel' },
          { value: 'hard', label: 'Svår' },
        ]}
      />

      <Label>Runda</Label>
      <Row label="Startspelare">
        <select
          value={players.some((p) => p.id === settings.startPlayer) ? settings.startPlayer : 'random'}
          onChange={(e) => set('startPlayer', e.target.value)}
          aria-label="Startspelare"
          className="h-11 max-w-[60%] rounded-xl border border-line bg-panel-2 px-3 outline-none"
        >
          <option value="random">Slumpa</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Impostor får börja" hint="Gäller när startspelaren slumpas">
        <Toggle label="Impostor får börja" on={settings.impostorMayStart} onChange={(v) => set('impostorMayStart', v)} />
      </Row>
      <div className="py-2">
        <div className="mb-1 font-medium">Timer för diskussion</div>
        <Segmented
          label="Timer"
          value={settings.timerSeconds}
          onChange={(v) => set('timerSeconds', v)}
          options={[
            { value: 0, label: 'Av' },
            { value: 60, label: '1 min' },
            { value: 120, label: '2 min' },
            { value: 180, label: '3 min' },
            { value: 300, label: '5 min' },
          ]}
        />
      </div>
      <Row label="Rollvisning" hint={settings.revealStyle === 'hold' ? 'Håll fingret på kortet för att se' : 'Tryck för att visa, tryck för att dölja'}>
        <Segmented
          label="Rollvisning"
          value={settings.revealStyle}
          onChange={(v) => set('revealStyle', v)}
          options={[
            { value: 'hold', label: 'Håll' },
            { value: 'tap', label: 'Tryck' },
          ]}
        />
      </Row>

      <Label>Röstning</Label>
      <Segmented
        label="Röstning"
        value={settings.voteMode}
        onChange={(v) => set('voteMode', v)}
        options={[
          { value: 'manual', label: 'Gemensam' },
          { value: 'individual', label: 'Hemlig, en i taget' },
        ]}
      />
      <Row label="Oavgjort" hint={settings.tieRule === 'runoff' ? 'Ny omröstning mellan de som har lika många röster' : 'Lika röster räknas som vinst för impostorerna'}>
        <Segmented
          label="Oavgjort"
          value={settings.tieRule}
          onChange={(v) => set('tieRule', v)}
          options={[
            { value: 'runoff', label: 'Omröstning' },
            { value: 'impostors', label: 'Impostor vinner' },
          ]}
        />
      </Row>

      <Label>Husregler</Label>
      <Row label="Sista chansen" hint="En avslöjad impostor får gissa ordet. Rätt gissning ger vinst.">
        <Toggle label="Sista chansen" on={settings.lastGuess} onChange={(v) => set('lastGuess', v)} />
      </Row>
      <Row label="Impostors känner varandra" hint="Gäller med fler än en impostor">
        <Toggle label="Impostors känner varandra" on={settings.impostorsKnow} onChange={(v) => set('impostorsKnow', v)} />
      </Row>

      <Label>Ljud och känsla</Label>
      <Row label="Ljud">
        <Toggle label="Ljud" on={settings.sound} onChange={(v) => set('sound', v)} />
      </Row>
      <Row label="Vibration" hint="På mobiler som stöder det">
        <Toggle label="Vibration" on={settings.vibration} onChange={(v) => set('vibration', v)} />
      </Row>
    </Sheet>
  )
}

// ---------------- Regler ----------------

export function RulesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Så spelar ni">
      <ol className="space-y-3">
        {[
          ['Lägg in spelarna', 'Sitt i samma ordning som i listan, så blir turordningen rätt.'],
          ['Se din roll i hemlighet', 'Mobilen skickas runt. Alla utom impostorn ser samma hemliga ord. Impostorn ser bara kategorin, och kanske en ledtråd.'],
          ['Ge en ledtråd var', 'Startspelaren börjar. Säg ett ord eller en kort ledtråd om ordet. Inte för tydligt, då listar impostorn ut det. Inte för luddigt, då blir du misstänkt. Kör ett eller två varv.'],
          ['Diskutera och rösta', 'Vem verkar inte veta ordet? Rösta ut en person.'],
          ['Avslöjandet', 'Var det impostorn vinner gruppen. Var det fel person vinner impostorn.'],
        ].map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-signal/15 font-display text-sm font-bold text-signal">
              {i + 1}
            </span>
            <div>
              <div className="font-semibold">{t}</div>
              <div className="text-sm text-mute">{d}</div>
            </div>
          </li>
        ))}
      </ol>

      <Label>Grundregler</Label>
      <ul className="list-disc space-y-1 pl-5 text-sm text-mute">
        <li>Alla vanliga spelare har exakt samma ord.</li>
        <li>Impostorn känner bara till kategorin och ska smälta in.</li>
        <li>Ledtrådar får inte vara själva ordet eller en böjning av det.</li>
        <li>Fler än en impostor vet inte om varandra.</li>
      </ul>

      <Label>Valbara husregler</Label>
      <ul className="list-disc space-y-1 pl-5 text-sm text-mute">
        <li>
          <span className="text-ivory">Hint Mode:</span> impostorn får en vag ledtråd.
        </li>
        <li>
          <span className="text-ivory">Sista chansen:</span> en avslöjad impostor får gissa ordet. Gruppen avgör om gissningen är rätt.
        </li>
        <li>
          <span className="text-ivory">Oavgjort:</span> ny omröstning mellan de som har lika många röster, eller vinst för impostorerna.
        </li>
        <li>
          <span className="text-ivory">Flera impostors:</span> när en åker fast blir det ett nytt ledtrådsvarv tills alla är fast. Röstar ni ut fel person vinner impostorerna.
        </li>
        <li>
          <span className="text-ivory">Impostors känner varandra:</span> impostorerna får se vilka de andra är.
        </li>
      </ul>

      <Label>Poäng</Label>
      <p className="text-sm text-mute">Vinner gruppen får varje vanlig spelare 1 poäng. Vinner impostorerna får varje impostor 2 poäng.</p>
    </Sheet>
  )
}

// ---------------- Statistik ----------------

export function StatsPanel({
  open,
  onClose,
  stats,
  players,
  onReset,
}: {
  open: boolean
  onClose: () => void
  stats: Stats
  players: Player[]
  onReset: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const names = Array.from(new Set([...players.map((p) => p.name), ...Object.keys(stats)]))
  const rows = names
    .map((n) => ({ name: n, s: stats[n] }))
    .filter((r) => r.s)
    .sort((a, b) => b.s.points - a.s.points || b.s.wins - a.s.wins)

  return (
    <Sheet open={open} onClose={() => (setConfirm(false), onClose())} title="Statistik">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-mute">Spela en runda så dyker statistiken upp här.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs tracking-wider text-mute uppercase">
              <tr>
                <th className="py-2 font-semibold">Spelare</th>
                <th className="py-2 text-right font-semibold">Poäng</th>
                <th className="py-2 text-right font-semibold">Vinster</th>
                <th className="py-2 text-right font-semibold">Impostor</th>
                <th className="py-2 text-right font-semibold">Lurade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ name, s }, i) => (
                <tr key={name} className="border-t border-line">
                  <td className="py-2.5 pr-2">
                    <span className={cx('font-medium', i === 0 && 'text-brass')}>{name}</span>
                  </td>
                  <td className="py-2.5 text-right font-display text-base font-bold">{s.points}</td>
                  <td className="py-2.5 text-right">
                    {s.wins}/{s.rounds}
                  </td>
                  <td className="py-2.5 text-right">{s.impostor}</td>
                  <td className="py-2.5 text-right">{s.impostorWins}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-mute">Impostor = antal rundor som impostor. Lurade = vinster som impostor.</p>
        </div>
      )}
      <div className="mt-6">
        {confirm ? (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => setConfirm(false)}>
              Avbryt
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={() => {
                onReset()
                setConfirm(false)
              }}
            >
              Ja, nollställ
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="w-full" disabled={rows.length === 0} onClick={() => setConfirm(true)}>
            Nollställ statistik
          </Button>
        )}
      </div>
    </Sheet>
  )
}
