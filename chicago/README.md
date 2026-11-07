# Chicago Poängräknare

Digital poängtavla för kortspelet Chicago, 2–6 spelare. React, TypeScript och Tailwind CSS. Allt sparas i webbläsaren (localStorage).

## Kom igång

```bash
cd chicago
npm install
npm run dev      # öppna http://localhost:5173
npm test         # enhetstester för poäng, ångra och sparning
npm run build    # produktionsbygge i dist/
```

## Användning

- Tryck på en spelare och välj händelse (pokerhand, sista stick, Chicago eller egen justering). Poängen registreras direkt.
- **Nästa giv** avslutar given. Den aktuella givens förändring visas på varje spelare.
- **Ångra** backar senaste ändringen (poäng, ny giv, rättning). Historiken låter dig rätta eller ta bort tidigare poäng.
- Alla poängvärden, vinstgränsen och en valfri spärr för pokerpoäng går att ändra under **Regler**.

Standardregler (ändringsbara): par 1, två par 2, triss 3, stege 4, färg 5, kåk 6, fyrtal 7, färgstege 8, royal straight flush 52, sista stick 5, sista stick med tvåa 10, Chicago ±15, vinst vid 52.
