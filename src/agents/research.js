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

export async function runResearch(product) {
  log(product.id, "research", "Undersöker andra företags annonser…");
  const previous = latestResearch(product.id);
  const notes = await askClaude({
    webSearch: true,
    effort: "medium",
    system:
      "Du är researchagent för Agent UF, ett svenskt UF-företag. Du studerar hur andra företag marknadsför liknande " +
      "produkter med korta videor på TikTok, Instagram Reels och Facebook, och tar fram fakta som gör nästa annonsvideo bättre. " +
      "Var konkret och skriv på svenska. Hitta inte på siffror; säg när något är din bedömning.",
    prompt: `Produkt: ${product.name} (${product.price})
Beskrivning: ${product.description}
Målgrupp: ${product.audience}

Sök efter hur konkurrenter och liknande varumärken (t.ex. tasstvättar, hundtillbehör, djurbutiker i Sverige och utomlands) gör sina annonser och korta videor just nu. Skriv en rapport med:
1. Vilka krokar (första 2 sekunderna) som verkar fungera, med exempel.
2. Vanliga format (före/efter, problem-lösning, UGC, ASMR, humor) och vilka som passar vår produkt.
3. Vad som får folk att köpa (pris, erbjudanden, känslor, säsong – just nu är det ${new Date().toLocaleDateString("sv-SE", { month: "long" })}).
4. Fem konkreta videoidéer på 10 sekunder för oss, i stående format.
5. Saker att undvika.
${previous ? `\nFörra rapporten (bygg vidare, upprepa inte):\n${previous.notes.slice(0, 4000)}` : ""}`,
  });
  db.prepare("INSERT INTO research (product_id, created_at, notes) VALUES (?, ?, ?)").run(product.id, now(), notes);
  log(product.id, "research", "Ny research klar och skickad till promptagenten.");
}
