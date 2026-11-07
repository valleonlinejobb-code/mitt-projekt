import { useCallback, useEffect, useRef, useState } from 'react'
import { Board } from './components/Board'
import { History } from './components/History'
import { RulesPanel } from './components/RulesPanel'
import { ScoreSheet, type ScoreInput } from './components/ScoreSheet'
import { Setup } from './components/Setup'
import { Confirm, fmt, Toast } from './components/ui'
import { WinnerModal } from './components/WinnerModal'
import { createGame, lastUndoLabel, reducer, winner, type Action, type Game, type Player } from './lib/game'
import type { Rules } from './lib/rules'
import { loadGame, loadNames, loadRules, saveGame, saveNames, saveRules } from './lib/storage'

type Panel = { kind: 'score'; player: Player } | { kind: 'history' } | { kind: 'rules' } | { kind: 'confirmNew' } | null
type ToastState = { id: number; text: string; undo: boolean } | null

export default function App() {
  const [game, setGame] = useState<Game | null>(() => loadGame())
  const [setupRules, setSetupRules] = useState<Rules>(() => loadRules())
  const [panel, setPanel] = useState<Panel>(null)
  const [toast, setToast] = useState<ToastState>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  useEffect(() => saveGame(game), [game])

  const showToast = useCallback((text: string, undo = true) => {
    window.clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), text, undo })
    toastTimer.current = window.setTimeout(() => setToast(null), 3500)
  }, [])

  const dispatch = useCallback((a: Action) => setGame((g) => (g ? reducer(g, a) : g)), [])

  const startGame = (names: string[]) => {
    saveNames(names.map((n) => n.trim()))
    setGame(createGame(names, setupRules))
    setPanel(null)
  }

  const newGame = () => {
    setGame(null)
    setPanel(null)
    setToast(null)
  }

  const undo = () => {
    if (!game) return
    const label = lastUndoLabel(game)
    if (!label) return
    dispatch({ type: 'undo' })
    showToast(`Ångrade: ${label}`, false)
  }

  const saveRulesFromPanel = (r: Rules) => {
    saveRules(r)
    setSetupRules(r)
    if (game) dispatch({ type: 'setRules', rules: r })
    setPanel(null)
  }

  if (!game) {
    return (
      <>
        <Setup
          initialNames={loadNames()}
          rules={setupRules}
          onOpenRules={() => setPanel({ kind: 'rules' })}
          onStart={startGame}
        />
        {panel?.kind === 'rules' && (
          <RulesPanel rules={setupRules} onSave={saveRulesFromPanel} onClose={() => setPanel(null)} />
        )}
      </>
    )
  }

  const w = winner(game)
  const score = (player: Player, s: ScoreInput) => {
    dispatch({ type: 'score', playerId: player.id, ...s })
    setPanel(null)
    showToast(`${player.name} ${fmt(s.points)} · ${s.label}`)
  }

  return (
    <>
      <Board
        game={game}
        canUndo={game.undoStack.length > 0}
        onPick={(player) => setPanel({ kind: 'score', player })}
        onUndo={undo}
        onNextRound={() => {
          dispatch({ type: 'nextRound' })
          showToast(`Giv ${game.round + 1} startad`)
        }}
        onOpenHistory={() => setPanel({ kind: 'history' })}
        onOpenRules={() => setPanel({ kind: 'rules' })}
        onNewGame={() => setPanel({ kind: 'confirmNew' })}
      />

      {panel?.kind === 'score' && (
        <ScoreSheet game={game} player={panel.player} onScore={(s) => score(panel.player, s)} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'history' && (
        <History
          game={game}
          onEdit={(entryId, points) => {
            dispatch({ type: 'editEntry', entryId, points })
            showToast('Poäng rättad')
          }}
          onDelete={(entryId) => {
            dispatch({ type: 'deleteEntry', entryId })
            showToast('Post borttagen')
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel?.kind === 'rules' && (
        <RulesPanel rules={game.rules} onSave={saveRulesFromPanel} onClose={() => setPanel(null)} />
      )}
      {panel?.kind === 'confirmNew' && (
        <Confirm
          title="Starta nytt spel?"
          text="Det pågående spelet och dess historik raderas. Detta går inte att ångra."
          confirmLabel="Nytt spel"
          danger
          onConfirm={newGame}
          onCancel={() => setPanel(null)}
        />
      )}

      {w && !game.continueAfterWin && (
        <WinnerModal
          game={game}
          winner={w}
          onContinue={() => dispatch({ type: 'continueAfterWin' })}
          onUndo={undo}
          onNewGame={() => setPanel({ kind: 'confirmNew' })}
        />
      )}

      {toast && !(w && !game.continueAfterWin) && (
        <Toast
          key={toast.id}
          text={toast.text}
          actionLabel={toast.undo ? 'Ångra' : undefined}
          onAction={() => {
            undo()
          }}
        />
      )}
    </>
  )
}
