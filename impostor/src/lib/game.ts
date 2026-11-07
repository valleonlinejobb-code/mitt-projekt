import { CATEGORIES, type Difficulty } from '../data/words'

// ---------- Typer ----------

export type Player = { id: string; name: string }

export type WordEntry = { word: string; hints: string[]; difficulty: Difficulty; /** Tillagt av spelarna själva. */ own?: boolean }
/** Egna ord per kategori-id, även för inbyggda kategorier. */
export type ExtraWords = Record<string, WordEntry[]>
export type Category = { id: string; name: string; group: string; custom?: boolean; words: WordEntry[] }

export type Mode = 'classic' | 'hint' | 'random'
export type VoteMode = 'manual' | 'individual'
export type TieRule = 'runoff' | 'impostors'

export type Settings = {
  impostorCount: number
  mode: Mode
  /** Sannolikhet i procent att impostorn får en ledtråd i Random Mode. */
  hintChance: number
  /** Vid flera impostors: samma ledtråd till alla eller olika. */
  sameHint: boolean
  difficulty: Difficulty
  /** Valda kategorier. Tom lista = alla. */
  categoryIds: string[]
  voteMode: VoteMode
  /** Timer för diskussionen i sekunder, 0 = av. */
  timerSeconds: number
  /** Avslöjad impostor får gissa ordet. Rätt gissning = impostorerna vinner. */
  lastGuess: boolean
  tieRule: TieRule
  /** Impostorerna får veta vilka de andra impostorerna är. */
  impostorsKnow: boolean
  /** Får en impostor börja rundan när startspelaren slumpas? */
  impostorMayStart: boolean
  /** 'random' eller ett spelar-id. */
  startPlayer: string
  revealStyle: 'hold' | 'tap'
  sound: boolean
  vibration: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  impostorCount: 1,
  mode: 'classic',
  hintChance: 50,
  sameHint: true,
  difficulty: 'medium',
  categoryIds: [],
  voteMode: 'manual',
  timerSeconds: 0,
  lastGuess: true,
  tieRule: 'runoff',
  impostorsKnow: false,
  impostorMayStart: false,
  startPlayer: 'random',
  revealStyle: 'hold',
  sound: true,
  vibration: true,
}

export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 20
export const MAX_IMPOSTORS = 5

/** Högst så många impostors att de alltid är i klar minoritet. */
export function maxImpostors(playerCount: number): number {
  return Math.max(1, Math.min(MAX_IMPOSTORS, Math.floor((playerCount - 1) / 2)))
}

export function clampSettings(s: Settings, playerCount: number): Settings {
  const hintChance = [0, 25, 50, 75, 100].includes(s.hintChance) ? s.hintChance : 50
  return {
    ...s,
    impostorCount: Math.min(Math.max(1, Math.round(s.impostorCount) || 1), maxImpostors(playerCount)),
    hintChance,
    timerSeconds: Math.min(900, Math.max(0, Math.round(s.timerSeconds) || 0)),
  }
}

// ---------- Slump ----------

export type Rng = () => number

export const cryptoRng: Rng = () => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] / 2 ** 32
}

export function shuffle<T>(arr: readonly T[], rng: Rng): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)]
}

// ---------- Kategorier ----------

export function parseCategories(): Category[] {
  return CATEGORIES.map((c) => ({
    id: c.id,
    name: c.name,
    group: c.group,
    words: (['easy', 'medium', 'hard'] as Difficulty[]).flatMap((d) =>
      c.words[d].map((line) => {
        const [word, ...hints] = line.split('|').map((x) => x.trim())
        return { word, hints: hints.filter(Boolean), difficulty: d }
      }),
    ),
  }))
}

export const BUILTIN_CATEGORIES = parseCategories()

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function allowedDifficulties(d: Difficulty): Difficulty[] {
  if (d === 'easy') return ['easy']
  if (d === 'hard') return ['medium', 'hard']
  return ['easy', 'medium', 'hard']
}

/** Ord som kan väljas för valda kategorier och svårighet. */
export function wordPool(categories: Category[], settings: Pick<Settings, 'categoryIds' | 'difficulty'>) {
  const chosen = settings.categoryIds.length
    ? categories.filter((c) => settings.categoryIds.includes(c.id))
    : categories
  const diffs = allowedDifficulties(settings.difficulty)
  return chosen
    .map((c) => ({
      category: c,
      // Egna ord saknar svårighetsgrad i praktiken och används alltid.
      words: c.words.filter((w) => c.custom || w.own || diffs.includes(w.difficulty)),
    }))
    .filter((x) => x.words.length > 0)
}

/** Lägger in egna ord i sina kategorier. Ord som redan finns i kategorin hoppas över. */
export function mergeExtraWords(categories: Category[], extras: ExtraWords): Category[] {
  return categories.map((c) => {
    const add = extras[c.id]
    if (!add?.length) return c
    const seen = new Set(c.words.map((w) => normalize(w.word)))
    const fresh = add.filter((w) => {
      const k = normalize(w.word)
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    return { ...c, words: [...c.words, ...fresh.map((w) => ({ ...w, own: true }))] }
  })
}

/** Tolkar rader i formatet "Ord | ledtråd | ledtråd". Tomma rader och dubbletter tas bort. */
export function parseWordLines(text: string): WordEntry[] {
  const seen = new Set<string>()
  const out: WordEntry[] = []
  for (const line of text.split('\n')) {
    const [word, ...hints] = line.split('|').map((x) => x.trim())
    const k = normalize(word ?? '')
    if (!word || !k || seen.has(k)) continue
    seen.add(k)
    out.push({ word: word.slice(0, 60), hints: hints.filter(Boolean).slice(0, 2).map((h) => h.slice(0, 40)), difficulty: 'medium' })
  }
  return out
}

// ---------- Runda ----------

export type Round = {
  number: number
  categoryId: string
  categoryName: string
  word: string
  impostorIds: string[]
  /** Ledtråd per impostor, null = ingen ledtråd. */
  hints: Record<string, string | null>
  /** Turordning, börjar med startspelaren. */
  order: string[]
}

export type RoundError = { error: string }

export function createRound(input: {
  players: Player[]
  settings: Settings
  categories: Category[]
  recentWords: string[]
  number: number
  rng?: Rng
}): Round | RoundError {
  const { players, categories, recentWords, number } = input
  const rng = input.rng ?? cryptoRng
  if (players.length < MIN_PLAYERS) return { error: `Minst ${MIN_PLAYERS} spelare behövs.` }
  if (players.length > MAX_PLAYERS) return { error: `Högst ${MAX_PLAYERS} spelare.` }
  const settings = clampSettings(input.settings, players.length)

  const pool = wordPool(categories, settings)
  if (pool.length === 0) return { error: 'Det finns inga ord i de valda kategorierna. Välj fler kategorier.' }

  // Undvik nyligen spelade ord. Om allt är spelat nyligen: tillåt igen.
  const recent = new Set(recentWords.map(normalize))
  const fresh = pool
    .map((p) => ({ ...p, words: p.words.filter((w) => !recent.has(normalize(w.word))) }))
    .filter((p) => p.words.length > 0)
  const source = fresh.length ? fresh : pool

  const { category, words } = pick(source, rng)
  const entry = pick(words, rng)

  // Rättvis lottning: blanda alla och ta de första.
  const impostorIds = shuffle(players.map((p) => p.id), rng).slice(0, settings.impostorCount)

  const giveHint =
    settings.mode === 'hint' ? true : settings.mode === 'random' ? rng() * 100 < settings.hintChance : false
  const hints: Record<string, string | null> = {}
  const available = shuffle(entry.hints, rng)
  impostorIds.forEach((id, i) => {
    if (!giveHint || available.length === 0) hints[id] = null
    else hints[id] = settings.sameHint ? available[0] : available[i % available.length]
  })

  // Startspelare
  let starterIdx: number
  const fixed = players.findIndex((p) => p.id === settings.startPlayer)
  if (fixed >= 0) starterIdx = fixed
  else {
    const candidates = players
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => settings.impostorMayStart || !impostorIds.includes(p.id))
    starterIdx = pick(candidates, rng).i
  }
  const order = [...players.slice(starterIdx), ...players.slice(0, starterIdx)].map((p) => p.id)

  return { number, categoryId: category.id, categoryName: category.name, word: entry.word, impostorIds, hints, order }
}

export type Role =
  | { kind: 'crew'; word: string; category: string }
  | { kind: 'impostor'; category: string; hint: string | null; partners: string[] }

export function roleFor(round: Round, playerId: string, impostorsKnow: boolean): Role {
  if (round.impostorIds.includes(playerId)) {
    return {
      kind: 'impostor',
      category: round.categoryName,
      hint: round.hints[playerId] ?? null,
      partners: impostorsKnow ? round.impostorIds.filter((id) => id !== playerId) : [],
    }
  }
  return { kind: 'crew', word: round.word, category: round.categoryName }
}

// ---------- Röstning ----------

export function tally(votes: Record<string, string>): Record<string, number> {
  const t: Record<string, number> = {}
  for (const target of Object.values(votes)) t[target] = (t[target] ?? 0) + 1
  return t
}

export function topVoted(votes: Record<string, string>): string[] {
  const t = tally(votes)
  const max = Math.max(0, ...Object.values(t))
  if (max === 0) return []
  return Object.keys(t).filter((id) => t[id] === max)
}

export type VoteDecision =
  | { kind: 'eliminate'; playerId: string }
  | { kind: 'runoff'; candidates: string[] }
  | { kind: 'impostorsWinTie'; candidates: string[] }

/** Avgör en omröstning. `isRunoff` = det var redan en utslagsomröstning. */
export function decideVote(votes: Record<string, string>, tieRule: TieRule, isRunoff: boolean): VoteDecision {
  const top = topVoted(votes)
  if (top.length === 1) return { kind: 'eliminate', playerId: top[0] }
  if (tieRule === 'runoff' && !isRunoff) return { kind: 'runoff', candidates: top }
  return { kind: 'impostorsWinTie', candidates: top }
}

export type Winner = 'crew' | 'impostors'

export type EliminationOutcome =
  | { kind: 'impostorCaught'; remainingImpostors: string[] }
  | { kind: 'crewEliminated' }

export function eliminate(round: Round, eliminated: string[], playerId: string): EliminationOutcome {
  if (!round.impostorIds.includes(playerId)) return { kind: 'crewEliminated' }
  const out = new Set([...eliminated, playerId])
  return { kind: 'impostorCaught', remainingImpostors: round.impostorIds.filter((id) => !out.has(id)) }
}

// ---------- Poäng och statistik ----------

export type PlayerStats = { rounds: number; wins: number; impostor: number; impostorWins: number; points: number }
export type Stats = Record<string, PlayerStats>

export const POINTS = { crewWin: 1, impostorWin: 2 }

export function emptyStats(): PlayerStats {
  return { rounds: 0, wins: 0, impostor: 0, impostorWins: 0, points: 0 }
}

/** Uppdaterar statistik/poäng (nycklar = spelarnamn, så de följer med mellan omgångar). */
export function applyResult(stats: Stats, players: Player[], round: Round, winner: Winner): Stats {
  const next: Stats = { ...stats }
  for (const p of players) {
    const s = { ...(next[p.name] ?? emptyStats()) }
    const isImp = round.impostorIds.includes(p.id)
    s.rounds += 1
    if (isImp) s.impostor += 1
    const won = (winner === 'impostors') === isImp
    if (won) {
      s.wins += 1
      if (isImp) s.impostorWins += 1
      s.points += isImp ? POINTS.impostorWin : POINTS.crewWin
    }
    next[p.name] = s
  }
  return next
}

export function rememberWord(recent: string[], word: string, limit = 80): string[] {
  return [word, ...recent.filter((w) => normalize(w) !== normalize(word))].slice(0, limit)
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}
