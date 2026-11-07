import { useState } from 'react'
import { cloneRules, DEFAULT_RULES, type Rules } from '../lib/rules'
import { cx, NumberStepper, Sheet } from './ui'

export function RulesPanel({
  rules,
  onSave,
  onClose,
}: {
  rules: Rules
  onSave: (r: Rules) => void
  onClose: () => void
}) {
  const [r, setR] = useState<Rules>(() => cloneRules(rules))
  const set = <K extends keyof Rules>(k: K, v: Rules[K]) => setR((x) => ({ ...x, [k]: v }))
  const setHand = (i: number, patch: Partial<Rules['hands'][number]>) =>
    setR((x) => ({ ...x, hands: x.hands.map((h, j) => (j === i ? { ...h, ...patch } : h)) }))

  return (
    <Sheet
      title="Regler"
      onClose={onClose}
      footer={
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <button
            onClick={() => setR(cloneRules(DEFAULT_RULES))}
            className="h-14 rounded-2xl bg-surface-2 px-4 text-sm font-medium text-muted transition hover:text-white"
          >
            Standard
          </button>
          <button
            onClick={() => onSave(r)}
            className="h-14 rounded-2xl bg-accent font-semibold text-black transition active:scale-[0.98]"
          >
            Spara regler
          </button>
        </div>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Chicago spelas med olika husregler. Justera poängen så att de stämmer med ert bord.
      </p>

      <Group title="Vinst">
        <Line label="Vinstgräns">
          <NumberStepper label="Vinstgräns" value={r.winLimit} onChange={(v) => set('winLimit', v)} min={1} max={999} />
        </Line>
        <Line
          label="Spärr för pokerpoäng"
          hint={r.pokerStopAt === null ? 'Av' : `Inga pokerpoäng från ${r.pokerStopAt} p`}
        >
          <div className="flex items-center gap-2">
            <Toggle
              on={r.pokerStopAt !== null}
              onChange={(on) => set('pokerStopAt', on ? Math.max(1, r.winLimit - 6) : null)}
              label="Spärr för pokerpoäng"
            />
            {r.pokerStopAt !== null && (
              <NumberStepper
                label="Spärrgräns"
                value={r.pokerStopAt}
                onChange={(v) => set('pokerStopAt', v)}
                min={1}
                max={999}
              />
            )}
          </div>
        </Line>
      </Group>

      <Group title="Pokerhänder">
        {r.hands.map((h, i) => (
          <Line key={h.id} label={h.label} muted={!h.enabled}>
            <div className="flex items-center gap-2">
              <Toggle on={h.enabled} onChange={(on) => setHand(i, { enabled: on })} label={`Använd ${h.label}`} />
              <NumberStepper
                label={`Poäng för ${h.label}`}
                value={h.points}
                onChange={(v) => setHand(i, { points: v })}
                min={0}
                max={999}
              />
            </div>
          </Line>
        ))}
      </Group>

      <Group title="Stick och Chicago">
        <Line label="Sista stick">
          <NumberStepper label="Sista stick" value={r.lastTrick} onChange={(v) => set('lastTrick', v)} min={0} max={999} />
        </Line>
        <Line label="Sista stick med 2:a" hint="0 = används inte">
          <NumberStepper
            label="Sista stick med 2:a"
            value={r.lastTrickWithTwo}
            onChange={(v) => set('lastTrickWithTwo', v)}
            min={0}
            max={999}
          />
        </Line>
        <Line label="Chicago lyckad">
          <NumberStepper label="Chicago lyckad" value={r.chicagoWin} onChange={(v) => set('chicagoWin', v)} min={0} max={999} />
        </Line>
        <Line label="Chicago misslyckad" hint="Dras av">
          <NumberStepper
            label="Chicago misslyckad"
            value={r.chicagoLoss}
            onChange={(v) => set('chicagoLoss', v)}
            min={0}
            max={999}
          />
        </Line>
      </Group>
    </Sheet>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
      <div className="divide-y divide-line/60">{children}</div>
    </section>
  )
}

function Line({ label, hint, muted, children }: { label: string; hint?: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className={cx('min-w-0', muted && 'opacity-50')}>
        <div className="font-medium">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx('relative h-8 w-13 shrink-0 rounded-full transition', on ? 'bg-accent' : 'bg-surface-2')}
    >
      <span
        className={cx(
          'absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform',
          on && 'translate-x-5',
        )}
      />
    </button>
  )
}
