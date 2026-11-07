import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '../data/words'
import {
  applyResult,
  BUILTIN_CATEGORIES,
  clampSettings,
  createRound,
  decideVote,
  DEFAULT_SETTINGS,
  eliminate,
  maxImpostors,
  normalize,
  rememberWord,
  roleFor,
  type Category,
  type Player,
  type Round,
  type Settings,
  wordPool,
} from './game'

/** Deterministisk slumpgenerator för testerna. */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const players = (n: number): Player[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Spelare ${i + 1}` }))

function round(n: number, s: Partial<Settings> = {}, seed = 1, cats: Category[] = BUILTIN_CATEGORIES): Round {
  const r = createRound({
    players: players(n),
    settings: { ...DEFAULT_SETTINGS, ...s },
    categories: cats,
    recentWords: [],
    number: 1,
    rng: seeded(seed),
  })
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('ordbiblioteket', () => {
  const all = BUILTIN_CATEGORIES.flatMap((c) => c.words.map((w) => ({ ...w, cat: c.name })))

  it('har minst 500 unika ord', () => {
    expect(all.length).toBeGreaterThanOrEqual(500)
    const seen = new Map<string, string>()
    const dups: string[] = []
    for (const w of all) {
      const k = normalize(w.word)
      if (seen.has(k)) dups.push(`${w.word} (${seen.get(k)} / ${w.cat})`)
      seen.set(k, w.cat)
    }
    expect(dups).toEqual([])
  })

  it('alla kategorier har ord i varje svårighetsgrad och unika id', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length)
    for (const c of CATEGORIES) {
      for (const d of ['easy', 'medium', 'hard'] as const) expect(c.words[d].length, `${c.name} ${d}`).toBeGreaterThan(0)
    }
  })

  it('varje ord har två ledtrådar som inte avslöjar ordet', () => {
    const bad: string[] = []
    for (const w of all) {
      if (!w.word || w.hints.length !== 2) bad.push(`${w.word}: fel antal ledtrådar`)
      const parts = normalize(w.word).split(' ').filter((p) => p.length > 3)
      for (const h of w.hints) {
        const nh = normalize(h)
        if (nh === normalize(w.word) || parts.some((p) => nh.split(' ').includes(p))) bad.push(`${w.word} → ${h}`)
      }
      if (w.hints[0] && w.hints[0] === w.hints[1]) bad.push(`${w.word}: samma ledtråd två gånger`)
    }
    expect(bad).toEqual([])
  })

  it('hård och lätt nivå ger olika ordmängder, medel blandar alla', () => {
    const count = (difficulty: Settings['difficulty']) =>
      wordPool(BUILTIN_CATEGORIES, { categoryIds: [], difficulty }).reduce((n, p) => n + p.words.length, 0)
    expect(count('medium')).toBe(all.length)
    expect(count('easy')).toBeLessThan(count('hard'))
    expect(count('easy') + count('hard')).toBe(all.length)
  })
})

describe('rollfördelning', () => {
  it('alla vanliga spelare får samma ord och impostorn ser aldrig ordet', () => {
    for (let seed = 1; seed < 200; seed++) {
      const r = round(8, { impostorCount: 2, mode: 'hint' }, seed)
      const roles = players(8).map((p) => roleFor(r, p.id, false))
      const crew = roles.filter((x) => x.kind === 'crew')
      const imps = roles.filter((x) => x.kind === 'impostor')
      expect(crew).toHaveLength(6)
      expect(imps).toHaveLength(2)
      expect(new Set(crew.map((c) => c.kind === 'crew' && c.word))).toEqual(new Set([r.word]))
      for (const i of imps) expect(JSON.stringify(i)).not.toContain(r.word)
    }
  })

  it('kategorin stämmer alltid med ordet', () => {
    for (let seed = 1; seed < 300; seed++) {
      const r = round(5, {}, seed)
      const cat = BUILTIN_CATEGORIES.find((c) => c.id === r.categoryId)!
      expect(cat.name).toBe(r.categoryName)
      expect(cat.words.map((w) => w.word)).toContain(r.word)
    }
  })

  it('respekterar valda kategorier och svårighet', () => {
    for (let seed = 1; seed < 100; seed++) {
      const r = round(4, { categoryIds: ['djur', 'mat'], difficulty: 'easy' }, seed)
      expect(['djur', 'mat']).toContain(r.categoryId)
      const w = BUILTIN_CATEGORIES.find((c) => c.id === r.categoryId)!.words.find((x) => x.word === r.word)!
      expect(w.difficulty).toBe('easy')
    }
  })

  it('lottar impostor rättvist (ungefär lika ofta per spelare)', () => {
    const counts = new Array(5).fill(0)
    const rng = seeded(42)
    for (let i = 0; i < 5000; i++) {
      const r = createRound({ players: players(5), settings: DEFAULT_SETTINGS, categories: BUILTIN_CATEGORIES, recentWords: [], number: 1, rng })
      if ('error' in r) throw new Error()
      counts[Number(r.impostorIds[0].slice(1))]++
    }
    for (const c of counts) expect(c).toBeGreaterThan(900)
    for (const c of counts) expect(c).toBeLessThan(1100)
  })

  it('begränsar antal impostors efter spelarantal', () => {
    expect(maxImpostors(3)).toBe(1)
    expect(maxImpostors(5)).toBe(2)
    expect(maxImpostors(11)).toBe(5)
    expect(maxImpostors(20)).toBe(5)
    expect(clampSettings({ ...DEFAULT_SETTINGS, impostorCount: 5 }, 4).impostorCount).toBe(1)
    expect(clampSettings({ ...DEFAULT_SETTINGS, impostorCount: -3 }, 10).impostorCount).toBe(1)
    expect(round(4, { impostorCount: 5 }).impostorIds).toHaveLength(1)
  })

  it('avvisar för få spelare och tomma kategorier', () => {
    const base = { settings: DEFAULT_SETTINGS, categories: BUILTIN_CATEGORIES, recentWords: [], number: 1 }
    expect(createRound({ ...base, players: players(2) })).toHaveProperty('error')
    expect(createRound({ ...base, players: players(4), settings: { ...DEFAULT_SETTINGS, categoryIds: ['finns-inte'] } })).toHaveProperty('error')
  })

  it('undviker nyligen spelade ord', () => {
    const cats: Category[] = [
      { id: 'x', name: 'X', group: 'Egna', custom: true, words: ['A', 'B', 'C'].map((w) => ({ word: w, hints: [], difficulty: 'medium' })) },
    ]
    let recent: string[] = []
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = createRound({ players: players(3), settings: DEFAULT_SETTINGS, categories: cats, recentWords: recent, number: i + 1, rng: seeded(i + 7) })
      if ('error' in r) throw new Error()
      seen.push(r.word)
      recent = rememberWord(recent, r.word)
    }
    expect(new Set(seen).size).toBe(3)
    // När alla ord har spelats tillåts de igen.
    const again = createRound({ players: players(3), settings: DEFAULT_SETTINGS, categories: cats, recentWords: recent, number: 4 })
    expect(again).not.toHaveProperty('error')
  })

  it('startspelare kan väljas, slumpas och är inte impostor som standard', () => {
    const fixed = round(6, { startPlayer: 'p3' })
    expect(fixed.order[0]).toBe('p3')
    expect(fixed.order).toEqual(['p3', 'p4', 'p5', 'p0', 'p1', 'p2'])
    for (let seed = 1; seed < 200; seed++) {
      const r = round(4, {}, seed)
      expect(r.impostorIds).not.toContain(r.order[0])
      expect(new Set(r.order).size).toBe(4)
    }
  })
})

describe('ledtrådar', () => {
  it('classic ger aldrig ledtråd, hint alltid', () => {
    for (let seed = 1; seed < 50; seed++) {
      const c = round(6, { mode: 'classic', impostorCount: 2 }, seed)
      expect(Object.values(c.hints).every((h) => h === null)).toBe(true)
      const h = round(6, { mode: 'hint', impostorCount: 2 }, seed)
      expect(Object.values(h.hints).every((x) => typeof x === 'string' && x.length > 0)).toBe(true)
    }
  })

  it('ledtråden hör till ordet', () => {
    for (let seed = 1; seed < 100; seed++) {
      const r = round(5, { mode: 'hint' }, seed)
      const w = BUILTIN_CATEGORIES.flatMap((c) => c.words).find((x) => x.word === r.word)!
      expect(w.hints).toContain(r.hints[r.impostorIds[0]])
    }
  })

  it('samma eller olika ledtrådar för flera impostors', () => {
    for (let seed = 1; seed < 50; seed++) {
      const same = round(9, { mode: 'hint', impostorCount: 2, sameHint: true }, seed)
      const [a, b] = same.impostorIds.map((id) => same.hints[id])
      expect(a).toBe(b)
      const diff = round(9, { mode: 'hint', impostorCount: 2, sameHint: false }, seed)
      const [c, d] = diff.impostorIds.map((id) => diff.hints[id])
      expect(c).not.toBe(d)
    }
  })

  it('random mode följer sannolikheten', () => {
    const share = (chance: number) => {
      let n = 0
      for (let seed = 1; seed <= 400; seed++) if (round(4, { mode: 'random', hintChance: chance }, seed).hints[round(4, { mode: 'random', hintChance: chance }, seed).impostorIds[0]]) n++
      return n / 400
    }
    expect(share(0)).toBe(0)
    expect(share(100)).toBe(1)
    expect(share(50)).toBeGreaterThan(0.35)
    expect(share(50)).toBeLessThan(0.65)
  })

  it('impostors kan få veta om varandra', () => {
    const r = round(8, { impostorCount: 2 })
    const [a, b] = r.impostorIds
    expect(roleFor(r, a, true)).toMatchObject({ kind: 'impostor', partners: [b] })
    expect(roleFor(r, a, false)).toMatchObject({ kind: 'impostor', partners: [] })
  })
})

describe('röstning', () => {
  it('flest röster åker ut', () => {
    expect(decideVote({ a: 'x', b: 'x', c: 'y' }, 'runoff', false)).toEqual({ kind: 'eliminate', playerId: 'x' })
  })
  it('oavgjort ger utslagsomröstning, sedan impostorvinst', () => {
    expect(decideVote({ a: 'x', b: 'y' }, 'runoff', false)).toEqual({ kind: 'runoff', candidates: ['x', 'y'] })
    expect(decideVote({ a: 'x', b: 'y' }, 'runoff', true)).toMatchObject({ kind: 'impostorsWinTie' })
    expect(decideVote({ a: 'x', b: 'y' }, 'impostors', false)).toMatchObject({ kind: 'impostorsWinTie' })
  })
  it('hanterar flera impostors', () => {
    const r = round(9, { impostorCount: 2 })
    const [i1, i2] = r.impostorIds
    const crew = r.order.find((id) => !r.impostorIds.includes(id))!
    expect(eliminate(r, [], i1)).toEqual({ kind: 'impostorCaught', remainingImpostors: [i2] })
    expect(eliminate(r, [i1], i2)).toEqual({ kind: 'impostorCaught', remainingImpostors: [] })
    expect(eliminate(r, [], crew)).toEqual({ kind: 'crewEliminated' })
  })
})

describe('poäng och statistik', () => {
  it('ger poäng och räknar impostorrundor', () => {
    const ps = players(4)
    const r = round(4)
    const imp = ps.find((p) => r.impostorIds.includes(p.id))!
    const crew = ps.find((p) => !r.impostorIds.includes(p.id))!
    let s = applyResult({}, ps, r, 'impostors')
    expect(s[imp.name]).toMatchObject({ rounds: 1, impostor: 1, wins: 1, impostorWins: 1, points: 2 })
    expect(s[crew.name]).toMatchObject({ rounds: 1, wins: 0, points: 0 })
    s = applyResult(s, ps, r, 'crew')
    expect(s[crew.name]).toMatchObject({ rounds: 2, wins: 1, points: 1 })
    expect(s[imp.name]).toMatchObject({ rounds: 2, impostor: 2, wins: 1 })
  })
})
