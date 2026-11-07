import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { configureFeedback } from './lib/feedback'
import {
  applyResult,
  BUILTIN_CATEGORIES,
  clampSettings,
  createRound,
  decideVote,
  eliminate,
  mergeExtraWords,
  rememberWord,
  type Player,
  type Round,
  type Winner,
} from './lib/game'
import { load, save, type Saved } from './lib/storage'
import { Elimination, LastGuess, Result } from './screens/Outcome'
import { CategoriesPanel, RulesPanel, SettingsPanel, StatsPanel } from './screens/Panels'
import { Play } from './screens/Play'
import { Reveal } from './screens/Reveal'
import { Setup } from './screens/Setup'
import { Vote } from './screens/Vote'

type Phase =
  | { kind: 'reveal' }
  | { kind: 'play' }
  | { kind: 'vote'; runoff: string[] | null }
  | { kind: 'elimination'; votes: Record<string, string>; target: string; remaining: string[] }
  | { kind: 'guess'; target: string; remaining: string[] }
  | { kind: 'result'; winner: Winner; reason: string }

type Session = {
  round: Round
  players: Player[]
  eliminated: string[]
  clueRound: number
  phase: Phase
}

type Panel = 'categories' | 'settings' | 'rules' | 'stats' | null

export default function App() {
  const [data, setData] = useState<Saved>(() => load())
  const [session, setSession] = useState<Session | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => save(data), [data])
  useEffect(() => configureFeedback(data.settings), [data.settings])

  const categories = useMemo(
    () => mergeExtraWords([...BUILTIN_CATEGORIES, ...data.customCategories], data.extraWords),
    [data.customCategories, data.extraWords],
  )
  const settings = clampSettings(data.settings, data.players.length)
  const update = (patch: Partial<Saved>) => setData((d) => ({ ...d, ...patch }))

  const startRound = () => {
    const players = data.players.map((p, i) => ({ ...p, name: p.name.trim() || `Spelare ${i + 1}` }))
    const round = createRound({
      players,
      settings,
      categories,
      recentWords: data.recentWords,
      number: data.roundsPlayed + 1,
    })
    if ('error' in round) {
      setError(round.error)
      return
    }
    setError(null)
    update({ players, recentWords: rememberWord(data.recentWords, round.word), roundsPlayed: data.roundsPlayed + 1 })
    setSession({ round, players, eliminated: [], clueRound: 1, phase: { kind: 'reveal' } })
  }

  const setPhase = (phase: Phase, patch: Partial<Session> = {}) => setSession((s) => (s ? { ...s, ...patch, phase } : s))

  const finish = (winner: Winner, reason: string) => {
    if (!session) return
    setData((d) => ({ ...d, stats: applyResult(d.stats, session.players, session.round, winner) }))
    setPhase({ kind: 'result', winner, reason })
  }

  const onVotes = (votes: Record<string, string>, runoff: string[] | null) => {
    if (!session) return
    const decision = decideVote(votes, settings.tieRule, runoff !== null)
    if (decision.kind === 'runoff') return setPhase({ kind: 'vote', runoff: decision.candidates })
    if (decision.kind === 'impostorsWinTie') return finish('impostors', 'Omröstningen blev oavgjord')
    const outcome = eliminate(session.round, session.eliminated, decision.playerId)
    setPhase(
      {
        kind: 'elimination',
        votes,
        target: decision.playerId,
        remaining: outcome.kind === 'impostorCaught' ? outcome.remainingImpostors : [],
      },
      { eliminated: [...session.eliminated, decision.playerId] },
    )
  }

  const afterElimination = (target: string, remaining: string[]) => {
    if (!session) return
    if (!session.round.impostorIds.includes(target)) return finish('impostors', 'En oskyldig blev utröstad')
    if (settings.lastGuess) return setPhase({ kind: 'guess', target, remaining })
    afterGuess(false, remaining)
  }

  const afterGuess = (correct: boolean, remaining: string[]) => {
    if (!session) return
    if (correct) return finish('impostors', 'Impostorn gissade rätt ord')
    if (remaining.length === 0)
      return finish('crew', session.round.impostorIds.length > 1 ? 'Alla impostors avslöjade' : 'Impostorn avslöjad')
    setPhase({ kind: 'play' }, { clueRound: session.clueRound + 1 })
  }

  const exit = () => {
    setSession(null)
    setPanel(null)
  }

  const s = session
  const active = s ? s.players.filter((p) => !s.eliminated.includes(p.id)) : []
  const nameOf = (id: string) => s?.players.find((p) => p.id === id)?.name ?? '?'
  const phaseKey = s ? `${s.phase.kind}-${s.clueRound}-${s.phase.kind === 'vote' ? (s.phase.runoff?.join() ?? 'v') : ''}` : 'setup'

  return (
    <>
      <AnimatePresence mode="wait">
        {!s && (
          <Setup
            key="setup"
            players={data.players}
            settings={settings}
            categories={categories}
            error={error}
            onPlayers={(players) => update({ players })}
            onSettings={(s2) => update({ settings: s2 })}
            onStart={startRound}
            open={setPanel}
          />
        )}
        {s?.phase.kind === 'reveal' && (
          <Reveal key={phaseKey} round={s.round} players={s.players} settings={settings} onDone={() => setPhase({ kind: 'play' })} onAbort={exit} />
        )}
        {s?.phase.kind === 'play' && (
          <Play
            key={phaseKey}
            round={s.round}
            players={s.players}
            eliminated={s.eliminated}
            clueRound={s.clueRound}
            timerSeconds={settings.timerSeconds}
            onVote={() => setPhase({ kind: 'vote', runoff: null })}
            onAbort={exit}
          />
        )}
        {s?.phase.kind === 'vote' &&
          (() => {
            const runoff = s.phase.runoff
            return (
              <Vote
                key={phaseKey}
                mode={settings.voteMode}
                voters={active}
                candidates={runoff ? active.filter((p) => runoff.includes(p.id)) : active}
                isRunoff={runoff !== null}
                onResult={(v) => onVotes(v, runoff)}
                onBack={() => setPhase({ kind: 'play' })}
              />
            )
          })()}
        {s?.phase.kind === 'elimination' &&
          (() => {
            const ph = s.phase
            return (
              <Elimination
                key={phaseKey}
                players={s.players}
                votes={ph.votes}
                eliminatedId={ph.target}
                isImpostor={s.round.impostorIds.includes(ph.target)}
                remaining={ph.remaining.length}
                lastGuess={settings.lastGuess}
                onContinue={() => afterElimination(ph.target, ph.remaining)}
              />
            )
          })()}
        {s?.phase.kind === 'guess' &&
          (() => {
            const ph = s.phase
            return <LastGuess key={phaseKey} impostorName={nameOf(ph.target)} word={s.round.word} onDecide={(c) => afterGuess(c, ph.remaining)} />
          })()}
        {s?.phase.kind === 'result' && (
          <Result
            key={phaseKey}
            round={s.round}
            players={s.players}
            winner={s.phase.winner}
            reason={s.phase.reason}
            stats={data.stats}
            onNext={startRound}
            onHome={exit}
          />
        )}
      </AnimatePresence>

      <CategoriesPanel
        open={panel === 'categories'}
        onClose={() => setPanel(null)}
        categories={categories}
        settings={settings}
        onSettings={(s2) => update({ settings: s2 })}
        extraWords={data.extraWords}
        onExtraWords={(extraWords) => update({ extraWords })}
        onCustom={(merged) =>
          setData((d) => ({
            ...d,
            // Egna ord sparas separat, så de tas bort ur kategorin här.
            customCategories: merged.map((c) => ({ ...c, words: c.words.filter((w) => !w.own) })),
            extraWords: Object.fromEntries(
              Object.entries(d.extraWords).filter(
                ([id]) => BUILTIN_CATEGORIES.some((c) => c.id === id) || merged.some((c) => c.id === id),
              ),
            ),
            settings: {
              ...d.settings,
              categoryIds: d.settings.categoryIds.filter(
                (id) => BUILTIN_CATEGORIES.some((c) => c.id === id) || merged.some((c) => c.id === id),
              ),
            },
          }))
        }
      />
      <SettingsPanel
        open={panel === 'settings'}
        onClose={() => setPanel(null)}
        settings={settings}
        players={data.players}
        onSettings={(s2) => update({ settings: s2 })}
      />
      <RulesPanel open={panel === 'rules'} onClose={() => setPanel(null)} />
      <StatsPanel open={panel === 'stats'} onClose={() => setPanel(null)} stats={data.stats} players={data.players} onReset={() => update({ stats: {} })} />
    </>
  )
}
