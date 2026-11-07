import { LEGACY_IDS } from '../data/words'
import { DEFAULT_SETTINGS, MAX_PLAYERS, newId, type Category, type ExtraWords, type Player, type Settings, type Stats } from './game'

const KEY = 'impostor.v1'

export type Saved = {
  players: Player[]
  settings: Settings
  customCategories: Category[]
  extraWords: ExtraWords
  stats: Stats
  recentWords: string[]
  roundsPlayed: number
}

export function defaultSaved(): Saved {
  return {
    players: ['Spelare 1', 'Spelare 2', 'Spelare 3', 'Spelare 4'].map((name) => ({ id: newId(), name })),
    settings: { ...DEFAULT_SETTINGS },
    customCategories: [],
    extraWords: {},
    stats: {},
    recentWords: [],
    roundsPlayed: 0,
  }
}

/** Läser sparad data och lagar allt som ser trasigt ut i stället för att krascha. */
export function load(): Saved {
  const base = defaultSaved()
  let raw: unknown
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return base
  }
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Partial<Saved>

  const players = Array.isArray(r.players)
    ? r.players
        .filter((p): p is Player => !!p && typeof p.id === 'string' && typeof p.name === 'string')
        .slice(0, MAX_PLAYERS)
    : base.players

  const settings: Settings = { ...DEFAULT_SETTINGS }
  if (r.settings && typeof r.settings === 'object') {
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = (r.settings as Record<string, unknown>)[k]
      if (Array.isArray(DEFAULT_SETTINGS[k]) ? Array.isArray(v) : typeof v === typeof DEFAULT_SETTINGS[k]) {
        ;(settings as Record<string, unknown>)[k] = v
      }
    }
  }

  const customCategories = Array.isArray(r.customCategories)
    ? r.customCategories.filter(
        (c): c is Category => !!c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.words),
      )
    : []

  const extraWords: ExtraWords = {}
  if (r.extraWords && typeof r.extraWords === 'object') {
    for (const [oldId, list] of Object.entries(r.extraWords)) {
      if (!Array.isArray(list)) continue
      const id = LEGACY_IDS[oldId] ?? oldId
      const ok = list.filter((w) => w && typeof w.word === 'string' && Array.isArray(w.hints))
      if (ok.length)
        extraWords[id] = [
          ...(extraWords[id] ?? []),
          ...ok.map((w) => ({ word: w.word, hints: w.hints.filter((h) => typeof h === 'string'), difficulty: 'medium' as const, own: true })),
        ]
    }
  }

  // Kategorierna slogs ihop till bredare: översätt gamla val.
  settings.categoryIds = Array.from(new Set(settings.categoryIds.map((id) => LEGACY_IDS[id] ?? id)))

  return {
    extraWords,
    players: players.length >= 3 ? players : base.players,
    settings,
    customCategories: customCategories.map((c) => ({ ...c, custom: true, words: c.words.filter((w) => !w.own) })),
    stats: r.stats && typeof r.stats === 'object' ? (r.stats as Stats) : {},
    recentWords: Array.isArray(r.recentWords) ? r.recentWords.filter((w) => typeof w === 'string') : [],
    roundsPlayed: typeof r.roundsPlayed === 'number' ? r.roundsPlayed : 0,
  }
}

export function save(data: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* privat läge eller full lagring: spelet fungerar ändå */
  }
}
