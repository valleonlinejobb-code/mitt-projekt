import { beforeEach, describe, expect, it } from 'vitest'
import { checkScore, createGame, leaders, reducer, roundDeltas, totals, winner, type Game } from './game'
import { DEFAULT_RULES } from './rules'
import { GAME_KEY, loadGame, loadRules, saveGame, saveRules } from './storage'

function score(g: Game, idx: number, points: number, kind: Parameters<typeof checkScore>[2] = 'hand') {
  return reducer(g, { type: 'score', playerId: g.players[idx].id, kind, label: 'x', points })
}

describe('createGame', () => {
  it('skapar 2–6 spelare och fyller tomma namn', () => {
    const g = createGame(['Anna', '', 'Cesar'])
    expect(g.players.map((p) => p.name)).toEqual(['Anna', 'Spelare 2', 'Cesar'])
    expect(g.round).toBe(1)
  })
  it('kräver minst två spelare och kapar vid sex', () => {
    expect(() => createGame(['Ensam'])).toThrow()
    expect(createGame(['1', '2', '3', '4', '5', '6', '7']).players).toHaveLength(6)
  })
  it('kopierar reglerna så att standardreglerna inte ändras', () => {
    const g = createGame(['A', 'B'])
    g.rules.hands[0].points = 99
    expect(DEFAULT_RULES.hands[0].points).toBe(1)
  })
})

describe('poängberäkning', () => {
  it('summerar totalpoäng och poäng per giv', () => {
    let g = createGame(['A', 'B', 'C'])
    g = score(g, 0, 3) // triss
    g = score(g, 1, 5, 'lastTrick')
    g = reducer(g, { type: 'nextRound' })
    g = score(g, 0, 2)
    g = score(g, 2, -15, 'chicagoLoss')
    const [a, b, c] = g.players.map((p) => p.id)
    expect(totals(g)).toEqual({ [a]: 5, [b]: 5, [c]: -15 })
    expect(roundDeltas(g, 1)).toEqual({ [a]: 3, [b]: 5, [c]: 0 })
    expect(roundDeltas(g, 2)).toEqual({ [a]: 2, [b]: 0, [c]: -15 })
  })

  it('ignorerar 0 poäng och okända spelare', () => {
    const g = createGame(['A', 'B'])
    expect(score(g, 0, 0)).toBe(g)
    expect(reducer(g, { type: 'score', playerId: 'finns-ej', kind: 'hand', label: 'x', points: 2 })).toBe(g)
  })

  it('markerar ledare, även vid delad ledning', () => {
    let g = createGame(['A', 'B', 'C'])
    expect(leaders(g)).toEqual([])
    g = score(g, 1, 4)
    expect(leaders(g)).toEqual([g.players[1].id])
    g = score(g, 2, 4)
    expect(leaders(g)).toEqual([g.players[1].id, g.players[2].id])
  })
})

describe('vinst', () => {
  it('utser vinnare vid vinstgränsen och tillåter fortsatt spel', () => {
    let g = createGame(['A', 'B'])
    g = score(g, 0, 50)
    expect(winner(g)).toBeNull()
    g = score(g, 0, 2)
    expect(winner(g)?.name).toBe('A')
    g = reducer(g, { type: 'continueAfterWin' })
    expect(g.continueAfterWin).toBe(true)
    g = score(g, 1, 5)
    expect(totals(g)[g.players[1].id]).toBe(5)
  })
  it('högst poäng vinner om flera passerar gränsen, oavgjort ger ingen vinnare', () => {
    let g = createGame(['A', 'B'])
    g = score(g, 0, 53)
    g = score(g, 1, 55)
    expect(winner(g)?.name).toBe('B')
    g = score(g, 0, 2)
    expect(winner(g)).toBeNull()
  })
  it('följer en ändrad vinstgräns', () => {
    let g = createGame(['A', 'B'])
    g = reducer(g, { type: 'setRules', rules: { ...g.rules, winLimit: 10 } })
    g = score(g, 1, 10)
    expect(winner(g)?.name).toBe('B')
  })
})

describe('husregel: spärr för pokerpoäng', () => {
  it('stoppar pokerhänder men inte stick eller Chicago', () => {
    let g = createGame(['A', 'B'])
    g = reducer(g, { type: 'setRules', rules: { ...g.rules, pokerStopAt: 46 } })
    g = score(g, 0, 46, 'manual')
    expect(checkScore(g, g.players[0].id, 'hand').ok).toBe(false)
    expect(score(g, 0, 3)).toBe(g)
    g = score(g, 0, 5, 'lastTrick')
    expect(totals(g)[g.players[0].id]).toBe(51)
  })
})

describe('ångra och rättning', () => {
  it('ångrar poäng, ny giv och rättningar i rätt ordning', () => {
    let g = createGame(['A', 'B'])
    g = score(g, 0, 3)
    g = reducer(g, { type: 'nextRound' })
    g = score(g, 1, 5)
    const entryId = g.entries[0].id
    g = reducer(g, { type: 'editEntry', entryId, points: 6 })
    expect(totals(g)[g.players[0].id]).toBe(6)

    g = reducer(g, { type: 'undo' }) // rättning
    expect(totals(g)[g.players[0].id]).toBe(3)
    g = reducer(g, { type: 'undo' }) // B +5
    expect(g.entries).toHaveLength(1)
    expect(g.round).toBe(2)
    g = reducer(g, { type: 'undo' }) // ny giv
    expect(g.round).toBe(1)
    g = reducer(g, { type: 'undo' }) // A +3
    expect(g.entries).toHaveLength(0)
    expect(reducer(g, { type: 'undo' })).toBe(g) // inget kvar
  })

  it('tar bort en tidigare post och kan ångra borttagningen', () => {
    let g = createGame(['A', 'B'])
    g = score(g, 0, 2)
    g = score(g, 0, 4)
    g = reducer(g, { type: 'deleteEntry', entryId: g.entries[0].id })
    expect(totals(g)[g.players[0].id]).toBe(4)
    g = reducer(g, { type: 'undo' })
    expect(totals(g)[g.players[0].id]).toBe(6)
  })

  it('rättning till 0 tar bort posten', () => {
    let g = createGame(['A', 'B'])
    g = score(g, 0, 2)
    g = reducer(g, { type: 'editEntry', entryId: g.entries[0].id, points: 0 })
    expect(g.entries).toHaveLength(0)
  })
})

describe('sparning', () => {
  beforeEach(() => localStorage.clear())

  it('sparar och läser tillbaka hela spelet, inklusive ångra-historik', () => {
    let g = createGame(['A', 'B'])
    g = score(g, 0, 3)
    g = reducer(g, { type: 'nextRound' })
    saveGame(g)
    const loaded = loadGame()
    expect(loaded).toEqual(g)
    const undone = reducer(loaded!, { type: 'undo' })
    expect(undone.round).toBe(1)
  })

  it('tål trasig eller främmande data', () => {
    localStorage.setItem(GAME_KEY, '{inte json')
    expect(loadGame()).toBeNull()
    localStorage.setItem(GAME_KEY, JSON.stringify({ foo: 1 }))
    expect(loadGame()).toBeNull()
  })

  it('rensar sparat spel', () => {
    saveGame(createGame(['A', 'B']))
    saveGame(null)
    expect(loadGame()).toBeNull()
  })

  it('kommer ihåg husregler till nästa spel', () => {
    expect(loadRules()).toEqual(DEFAULT_RULES)
    saveRules({ ...DEFAULT_RULES, winLimit: 100, pokerStopAt: 46 })
    expect(loadRules().winLimit).toBe(100)
    expect(loadRules().pokerStopAt).toBe(46)
  })
})
