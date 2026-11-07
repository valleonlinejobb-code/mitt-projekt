# Impostor

Partyspel för 3–20 spelare på en delad mobil, surfplatta eller dator. Alla får samma hemliga ord utom impostorn, som bara ser kategorin (och ibland en ledtråd).

## Starta

```bash
cd impostor
npm install
npm run dev        # http://localhost:5174
npm test           # spellogik, ordbibliotek, röstning, poäng
npm run build      # produktionsbygge i dist/
```

Efter `npm install` fungerar spelet helt utan internet (typsnittet ligger lokalt).

### Spela från mobilen via Wi-Fi
`npm run dev` startar med `--host`, så terminalen visar en adress under **Network**, till exempel `http://192.168.1.23:5174`. Öppna den på en mobil i samma Wi-Fi. Varje enhet kör ett eget spel: en enhet skickas runt bordet. Rollerna skickas aldrig mellan enheter, så ingen kan se någon annans roll från sin egen mobil.

## Struktur

- `src/data/words.ts` – ordbiblioteket (kategorier, svårighet, två vaga ledtrådar per ord)
- `src/lib/game.ts` – all spellogik: lottning, ordval, ledtrådar, röstning, poäng
- `src/lib/storage.ts` – sparar spelare, inställningar, egna kategorier och statistik i localStorage
- `src/lib/feedback.ts` – ljud (Web Audio) och vibration
- `src/screens/` – skärmarna: start, rollvisning, runda, röstning, avslöjande, resultat, paneler
