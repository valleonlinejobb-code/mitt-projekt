// Poängregler för Chicago. Allt här är justerbart i appen, eftersom
// husreglerna skiljer sig mellan sällskap.

export type HandRule = { id: string; label: string; points: number; enabled: boolean }

export type Rules = {
  /** Poäng som krävs för att vinna. */
  winLimit: number
  /** Pokerhänder och deras poäng. */
  hands: HandRule[]
  /** Poäng för att ta sista sticket. */
  lastTrick: number
  /** Poäng för att ta sista sticket med en tvåa (0 = används inte). */
  lastTrickWithTwo: number
  /** Poäng för lyckad Chicago. */
  chicagoWin: number
  /** Poäng för misslyckad Chicago (anges som positivt tal, dras av). */
  chicagoLoss: number
  /**
   * Spärr för pokerpoäng: från denna poäng får en spelare inte längre
   * poäng för pokerhänder. null = ingen spärr.
   */
  pokerStopAt: number | null
}

export const DEFAULT_HANDS: HandRule[] = [
  { id: 'par', label: 'Par', points: 1, enabled: true },
  { id: 'tvapar', label: 'Två par', points: 2, enabled: true },
  { id: 'triss', label: 'Triss', points: 3, enabled: true },
  { id: 'stege', label: 'Stege', points: 4, enabled: true },
  { id: 'farg', label: 'Färg', points: 5, enabled: true },
  { id: 'kak', label: 'Kåk', points: 6, enabled: true },
  { id: 'fyrtal', label: 'Fyrtal', points: 7, enabled: true },
  { id: 'fargstege', label: 'Färgstege', points: 8, enabled: true },
  { id: 'royal', label: 'Royal straight flush', points: 52, enabled: true },
]

export const DEFAULT_RULES: Rules = {
  winLimit: 52,
  hands: DEFAULT_HANDS,
  lastTrick: 5,
  lastTrickWithTwo: 10,
  chicagoWin: 15,
  chicagoLoss: 15,
  pokerStopAt: null,
}

export function cloneRules(r: Rules): Rules {
  return { ...r, hands: r.hands.map((h) => ({ ...h })) }
}
