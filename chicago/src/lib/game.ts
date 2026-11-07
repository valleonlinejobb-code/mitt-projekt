import { cloneRules, DEFAULT_RULES, type Rules } from './rules'

export type Player = { id: string; name: string }

export type EntryKind = 'hand' | 'lastTrick' | 'lastTrickTwo' | 'chicagoWin' | 'chicagoLoss' | 'manual'

export type Entry = {
  id: string
  /** Vilken giv posten hör till (börjar på 1). */
  round: number
  playerId: string
  kind: EntryKind
  label: string
  points: number
}

export type Game = {
  version: 1
  players: Player[]
  entries: Entry[]
  round: number
  rules: Rules
  /** Sätts när någon har vunnit och sällskapet väljer att spela vidare. */
  continueAfterWin: boolean
  /** Snapshots för ångra, senaste sist. */
  undoStack: UndoSnapshot[]
}

type UndoSnapshot = { entries: Entry[]; round: number; continueAfterWin: boolean; label: string }

export const MIN_PLAYERS = 2
export const MAX_PLAYERS = 6
const UNDO_LIMIT = 50

let counter = 0
export function newId(): string {
  counter += 1
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function createGame(names: string[], rules: Rules = DEFAULT_RULES): Game {
  const cleaned = names.slice(0, MAX_PLAYERS).map((n, i) => n.trim() || `Spelare ${i + 1}`)
  if (cleaned.length < MIN_PLAYERS) throw new Error(`Minst ${MIN_PLAYERS} spelare krävs`)
  return {
    version: 1,
    players: cleaned.map((name) => ({ id: newId(), name })),
    entries: [],
    round: 1,
    rules: cloneRules(rules),
    continueAfterWin: false,
    undoStack: [],
  }
}

// ---------- Beräkningar ----------

export function totals(game: Pick<Game, 'players' | 'entries'>): Record<string, number> {
  const t: Record<string, number> = {}
  for (const p of game.players) t[p.id] = 0
  for (const e of game.entries) if (e.playerId in t) t[e.playerId] += e.points
  return t
}

export function roundDeltas(game: Pick<Game, 'players' | 'entries'>, round: number): Record<string, number> {
  const d: Record<string, number> = {}
  for (const p of game.players) d[p.id] = 0
  for (const e of game.entries) if (e.round === round && e.playerId in d) d[e.playerId] += e.points
  return d
}

/** Id:n för spelaren/spelarna med högst poäng (tom lista om alla har 0 och inget registrerats). */
export function leaders(game: Pick<Game, 'players' | 'entries'>): string[] {
  if (game.entries.length === 0) return []
  const t = totals(game)
  const max = Math.max(...Object.values(t))
  return game.players.filter((p) => t[p.id] === max).map((p) => p.id)
}

/** Vinnaren om någon nått vinstgränsen: den med högst poäng av dem som nått den. */
export function winner(game: Game): Player | null {
  const t = totals(game)
  const reached = game.players.filter((p) => t[p.id] >= game.rules.winLimit)
  if (reached.length === 0) return null
  reached.sort((a, b) => t[b.id] - t[a.id])
  // Oavgjort i toppen = ingen tydlig vinnare än.
  if (reached.length > 1 && t[reached[0].id] === t[reached[1].id]) return null
  return reached[0]
}

/** Rundor som har minst en post, nyast först. */
export function roundsWithEntries(game: Game): number[] {
  const set = new Set(game.entries.map((e) => e.round))
  return [...set].sort((a, b) => b - a)
}

// ---------- Åtgärder ----------

export type Action =
  | { type: 'score'; playerId: string; kind: EntryKind; label: string; points: number }
  | { type: 'nextRound' }
  | { type: 'undo' }
  | { type: 'editEntry'; entryId: string; points: number }
  | { type: 'deleteEntry'; entryId: string }
  | { type: 'setRules'; rules: Rules }
  | { type: 'renamePlayer'; playerId: string; name: string }
  | { type: 'continueAfterWin' }

export type ScoreCheck = { ok: true } | { ok: false; reason: string }

/** Kontrollerar husregler innan en post läggs till. */
export function checkScore(game: Game, playerId: string, kind: EntryKind): ScoreCheck {
  const stop = game.rules.pokerStopAt
  if (kind === 'hand' && stop !== null && totals(game)[playerId] >= stop) {
    return { ok: false, reason: `Pokerpoäng ges inte från ${stop} poäng (husregel)` }
  }
  return { ok: true }
}

function snapshot(game: Game, label: string): UndoSnapshot[] {
  const s: UndoSnapshot = {
    entries: game.entries,
    round: game.round,
    continueAfterWin: game.continueAfterWin,
    label,
  }
  return [...game.undoStack, s].slice(-UNDO_LIMIT)
}

export function reducer(game: Game, action: Action): Game {
  switch (action.type) {
    case 'score': {
      if (!game.players.some((p) => p.id === action.playerId)) return game
      if (!Number.isFinite(action.points) || action.points === 0) return game
      if (!checkScore(game, action.playerId, action.kind).ok) return game
      const entry: Entry = {
        id: newId(),
        round: game.round,
        playerId: action.playerId,
        kind: action.kind,
        label: action.label,
        points: Math.round(action.points),
      }
      return { ...game, undoStack: snapshot(game, action.label), entries: [...game.entries, entry] }
    }
    case 'nextRound':
      return { ...game, undoStack: snapshot(game, 'Ny giv'), round: game.round + 1 }
    case 'undo': {
      const last = game.undoStack[game.undoStack.length - 1]
      if (!last) return game
      return {
        ...game,
        entries: last.entries,
        round: last.round,
        continueAfterWin: last.continueAfterWin,
        undoStack: game.undoStack.slice(0, -1),
      }
    }
    case 'editEntry': {
      const points = Math.round(action.points)
      if (!Number.isFinite(points)) return game
      const target = game.entries.find((e) => e.id === action.entryId)
      if (!target || target.points === points) return game
      if (points === 0) return reducer(game, { type: 'deleteEntry', entryId: action.entryId })
      return {
        ...game,
        undoStack: snapshot(game, 'Rättning'),
        entries: game.entries.map((e) => (e.id === action.entryId ? { ...e, points } : e)),
      }
    }
    case 'deleteEntry': {
      if (!game.entries.some((e) => e.id === action.entryId)) return game
      return {
        ...game,
        undoStack: snapshot(game, 'Borttagning'),
        entries: game.entries.filter((e) => e.id !== action.entryId),
      }
    }
    case 'setRules':
      return { ...game, rules: cloneRules(action.rules) }
    case 'renamePlayer': {
      const name = action.name.trim()
      if (!name) return game
      return { ...game, players: game.players.map((p) => (p.id === action.playerId ? { ...p, name } : p)) }
    }
    case 'continueAfterWin':
      return { ...game, undoStack: snapshot(game, 'Spela vidare'), continueAfterWin: true }
  }
}

export function lastUndoLabel(game: Game): string | null {
  return game.undoStack[game.undoStack.length - 1]?.label ?? null
}
