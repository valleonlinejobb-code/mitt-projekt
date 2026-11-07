import type { Game } from './game'
import { DEFAULT_RULES, cloneRules, type Rules } from './rules'

export const GAME_KEY = 'chicago.game.v1'
export const RULES_KEY = 'chicago.rules.v1'

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* privat läge eller full lagring – spelet fungerar ändå */
  }
}

function isGame(v: unknown): v is Game {
  if (!v || typeof v !== 'object') return false
  const g = v as Partial<Game>
  return (
    g.version === 1 &&
    Array.isArray(g.players) &&
    Array.isArray(g.entries) &&
    typeof g.round === 'number' &&
    !!g.rules &&
    typeof g.rules.winLimit === 'number' &&
    Array.isArray(g.rules.hands)
  )
}

export function loadGame(): Game | null {
  const raw = safeGet(GAME_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isGame(parsed)) return null
    return { ...parsed, undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [] }
  } catch {
    return null
  }
}

export function saveGame(game: Game | null): void {
  safeSet(GAME_KEY, game ? JSON.stringify(game) : null)
}

/** Senast använda regler, så att nästa spel startar med samma husregler. */
export function loadRules(): Rules {
  const raw = safeGet(RULES_KEY)
  if (!raw) return cloneRules(DEFAULT_RULES)
  try {
    const r = JSON.parse(raw) as Rules
    if (typeof r.winLimit !== 'number' || !Array.isArray(r.hands)) return cloneRules(DEFAULT_RULES)
    return { ...cloneRules(DEFAULT_RULES), ...r, hands: r.hands.map((h) => ({ ...h })) }
  } catch {
    return cloneRules(DEFAULT_RULES)
  }
}

export function saveRules(rules: Rules): void {
  safeSet(RULES_KEY, JSON.stringify(rules))
}

export function loadNames(): string[] {
  try {
    const raw = safeGet('chicago.names.v1')
    const n = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(n) ? n.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function saveNames(names: string[]): void {
  safeSet('chicago.names.v1', JSON.stringify(names))
}
