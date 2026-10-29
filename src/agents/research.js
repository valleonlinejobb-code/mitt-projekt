// Researchagenten: studerar hur andra företag gör sina annonser och annonsvideor.
import { db, now, log } from "../db.js";
import { askClaude } from "../claude.js";

const EVERY_DAYS = Number(process.env.RESEARCH_EVERY_DAYS || 3);

export function latestResearch(productId) {
  return db.prepare("SELECT * FROM research WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(productId);
}

export function researchDue(product) {
  const last = latestResearch(product.id);
  return !last || Date.now() - new Date(last.created_at).getTime() > EVERY_DAYS * 86_400_000;
}

// Kvalitet före mängd: allt researchagenten lämnar vidare ska gå att lita på.
// Först söker den på webben och citerar källor, sedan granskar en faktakontroll rapporten
// och stryker allt som saknar källa innan den skickas till promptagenten.
export async function runResearch(product) {
  log(product.id, "research", "Undersöker andra företags annonser…");
  const previous = latestResearch(product.id);
  const draft = await askClaude({
    webSearch: true,
    maxSearches: 10,
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

Produkten är ett kit: tasstvätt (kopp med mjuka silikonborst) plus mikrofiberhandduk med tassmönster. Ägaren vill göra annonser som visar hur kitet används som bäst, och som har chans att gå viralt. Sök och skriv en rapport med:
1. Så används kitet bäst: rätt vattentemperatur och mängd, hur man för in och vrider tassen, hur handduken används för att torka (mellan trampdynor och klor), hur man vänjer en ovan hund, rengöring av kopp och handduk, val av storlek. Ta det från tillverkares bruksanvisningar, veterinärer och djurbutiker – med källa.
2. Konkurrenternas bästa annonser: hitta konkreta annonser och korta videor för tasstvättar och liknande hundprodukter (t.ex. i Metas annonsbibliotek, TikTok och Instagram) som gått bra – med siffror som visningar, gillningar eller hur länge annonsen körts, och källa.
2b. Massagekänslan: ägaren säger att silikonborsten känns som massage för hunden. Sök vad tillverkare, veterinärer och hundägare säger om det (t.ex. att hunden slappnar av), och om det finns belägg för några effekter. Skriv bara det som källorna stöder.
3. Varför just de gick bra för just de företagen: krok, format (demo, före/efter, UGC, ASMR, humor), känsla, ljud, längd, målgrupp och timing. Skilj på vad källan säger och din bedömning.
4. Vad som får hundägare att köpa (pris, erbjudanden, känslor, säsong – just nu är det ${new Date().toLocaleDateString("sv-SE", { month: "long" })} i Sverige).
5. Tre videoidéer på 10 sekunder för oss, i stående format. Minst en ska visa hur kitet används bäst, med både tasstvätten och handduken.
6. Saker att undvika (även sådant plattformarnas regler förbjuder i annonser).
${previous ? `\nFörra rapporten (bygg vidare, upprepa inte):\n${previous.notes.slice(0, 4000)}` : ""}`,
  });

  log(product.id, "research", `Faktakollar rapporten (${draft.sources.length} källor)…`);
  const notes = await askClaude({
    webSearch: true,
    maxSearches: 4,
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
## Så används kitet bäst
Steg och tips, varje punkt med (källa: URL).
## Annonser som gått bra och varför
Varje annons med företag, vad den visar, resultat (siffror) och (källa: URL). Varför den gick bra märks som fakta med källa eller som "Bedömning:".
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
}
