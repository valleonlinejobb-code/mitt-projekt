// Researchagenten: studerar hur andra företag gör sina annonser och annonsvideor.
import { db, now, log } from "../db.js";
import { askClaude } from "../claude.js";
import { newRun } from "../costs.js";
import * as progress from "../progress.js";

// Researchen sparas per produkt och återanvänds för alla videor tills den är äldre än så här.
// Researchen är mest sökning och sammanfattning, så den körs med den billigare Sonnet-modellen (ägarens val 2026-10-29).
const RESEARCH_MODEL = process.env.RESEARCH_MODEL || "claude-sonnet-5-5";

export const RESEARCH_EVERY_DAYS = Number(process.env.RESEARCH_EVERY_DAYS || 3);

export function latestResearch(productId) {
  return db.prepare("SELECT * FROM research WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(productId);
}

export function researchDue(product) {
  const last = latestResearch(product.id);
  return !last || Date.now() - new Date(last.created_at).getTime() > RESEARCH_EVERY_DAYS * 86_400_000;
}

// Kvalitet före mängd: allt researchagenten lämnar vidare ska gå att lita på.
// Först söker den på webben och citerar källor, sedan granskar en faktakontroll rapporten
// och stryker allt som saknar källa innan den skickas till promptagenten.
export async function runResearch(product) {
  log(product.id, "research", "Undersöker andra företags annonser…");
  progress.stage(product.id, "research", "search");
  const previous = latestResearch(product.id);
  const cost = { agent: "research", task: "research", run: newRun(), productId: product.id, model: RESEARCH_MODEL };
  const draft = await askClaude({
    ...cost,
    webSearch: true,
    maxSearches: 15,
    effort: "high",
    withSources: true,
    system:
      "Du är researchagent för Vardagshoppen, ett svenskt UF-företag. Du studerar hur andra företag marknadsför liknande " +
      "produkter med korta videor på TikTok, Instagram Reels och Facebook, och tar fram fakta som gör nästa annonsvideo bättre. " +
      "Ägaren vill hellre ha 3 riktigt bra annonser än 20 dåliga, så felaktig information är värre än ingen information. " +
      "Regler: Varje fakta-påstående och varje siffra ska ha en källa (länk) som du faktiskt har läst i en sökning. " +
      "Hitta aldrig på siffror, kampanjer, företag eller exempel. Det du själv drar för slutsatser märker du med \"Bedömning:\". " +
      "Hellre färre punkter som stämmer än många som är osäkra. Skriv på svenska.",
    prompt: `Produkt: ${product.name} (${product.price})
Beskrivning: ${product.description}
Målgrupp: ${product.audience}

${product.focus ? `Ägarens instruktioner för just den här produkten:\n${product.focus}\n` : ""}
Ägaren vill göra annonser som visar hur produkten används som bäst, och som har chans att gå viralt. Sök och skriv en rapport med:
1. Så används produkten bäst: steg, tips och vanliga misstag, från tillverkare, experter och butiker – med källa.
2. Konkurrenternas bästa annonser: hitta konkreta annonser och korta videor för den här typen av produkt som gått bra – med siffror som visningar, gillningar eller hur länge annonsen körts (en annons som körts länge i Metas annonsbibliotek tjänar oftast pengar), och källa. Sök på flera ställen: Metas annonsbibliotek, TikTok Creative Center (Top Ads), TikTok, Instagram och YouTube Shorts. Leta både efter stora märken för produkttypen och efter svenska och nordiska butiker för husdjur, och efter små e-handlare som säljer samma typ av produkt. Börja med de märken som gjort tasstvättare kända med korta videor, till exempel Dexas MudBuster och Paw Plunger: sök deras annonser i Metas annonsbibliotek och deras mest sedda videor på TikTok, Instagram och YouTube, och beskriv exakt hur de första 2 sekunderna ser ut. De får vara förebilder (format, krok, tempo), men vi kopierar aldrig deras video eller påstår något om vår produkt som bara gäller deras.
3. Så gör konkurrenterna sina annonser, steg för steg: hur de visar problemet (före) och resultatet (efter), när och hur de visar märke och logga, hur och när de visar pris och rabatt (i bild, i rösten, i slutet), om de har berättarröst eller text (och vilken ton), hur de slutar (uppmaning, slutbild), hur lång videon är, om annonsen ser ut som ett vanligt inlägg eller som reklam, vilken sorts krok de använder (nöjsam start, känslosam berättelse, sketch, FOMO, problem–lösning), om produkten används av en människa, och vilka förtroendesignaler de visar (garanti, betyg, recensioner, certifiering, leverans).
4. Varför just de gick bra för just de företagen: krok, format (demo, före/efter, UGC, ASMR, humor), känsla, ljud, längd, målgrupp och timing. Skilj på vad källan säger och din bedömning.
5. Vilka grupper inom målgruppen konkurrenterna riktar sig till och vilka ord de använder om dem (t.ex. hundras, storlek, boende, golv, bil), och hur annonsen matchar sidan man kommer till.
6. Vad som får målgruppen att köpa (pris, erbjudanden, känslor, säsong – just nu är det ${new Date().toLocaleDateString("sv-SE", { month: "long" })} i Sverige).
7. Tre videoidéer på 10 sekunder för oss, i stående format, med före/efter. Minst en ska visa hur produkten används bäst.
8. Saker att undvika (även sådant plattformarnas regler förbjuder i annonser).
${previous ? `\nFörra rapporten (bygg vidare, upprepa inte):\n${previous.notes.slice(0, 4000)}` : ""}`,
  });

  log(product.id, "research", `Faktakollar rapporten (${draft.sources.length} källor)…`);
  progress.stage(product.id, "research", "check", `${draft.sources.length} källor`);
  const notes = await askClaude({
    ...cost,
    webSearch: true,
    maxSearches: 5,
    effort: "high",
    system:
      "Du är faktagranskare för Vardagshoppen. Du får ett researchutkast och listan med källor som faktiskt lästes. " +
      "Din uppgift är att bara släppa igenom det som går att lita på. Stryk varje påstående och siffra som saknar en källa ur listan, " +
      "som källan inte säger, eller som verkar föråldrat. Du får göra några egna sökningar för att dubbelkolla de viktigaste siffrorna. " +
      "Lägg aldrig till nya fakta utan källa. Skriv på svenska.",
    prompt: `Researchutkast:
${draft.text}

Källor som lästes:
${draft.sources.map((s) => `- ${s.title}: ${s.url}`).join("\n") || "(inga)"}

Skriv den slutliga rapporten till promptagenten med exakt dessa rubriker:
## Så används produkten bäst
Steg och tips, varje punkt med (källa: URL).
## Annonser som gått bra och varför
Varje annons med företag, vad den visar, resultat (siffror) och (källa: URL). Varför den gick bra märks som fakta med källa eller som "Bedömning:".
## Så gör konkurrenterna sina annonser
Före/efter, logga, pris och rabatt, röst eller text, slut och uppmaning, längd, och om den ser ut som ett vanligt inlägg. Fakta med (källa: URL), resten som "Bedömning:".
## Grupper och ord
Vilka grupper konkurrenterna riktar sig till och vilka ord de använder, med källa eller som "Bedömning:".
## Verifierade fakta
Övriga fakta. Varje punkt slutar med (källa: URL). Bara sådant som källan stöder.
## Bedömningar
Slutsatser och råd som inte är fakta. Varje punkt börjar med "Bedömning:".
## Videoidéer
De bästa idéerna (högst tre), justerade så att de bara bygger på verifierade fakta.
## Undvik
## Struket
Kort lista över vad du tog bort och varför, så att ägaren kan se att granskningen gjordes.`,
  });
  db.prepare("INSERT INTO research (product_id, created_at, notes) VALUES (?, ?, ?)").run(product.id, now(), notes);
  log(product.id, "research", "Ny faktakollad research klar och skickad till promptagenten.");
  progress.done(product.id, "research");
}
