// Promptagenten: skriver videoprompt + texter, beställer videon och väntar in den.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, log, stockholmDate, getSetting, setSetting, MEDIA_DIR } from "../db.js";
import { askClaude } from "../claude.js";
import { startVideo, checkVideo, higgsfieldConfigured } from "../higgsfield.js";
import { latestResearch } from "./research.js";

const MAX_PER_MONTH = Number(process.env.MAX_VIDEOS_PER_MONTH || 35);

// Kvalitet före mängd: ägaren vill hellre ha 3 bra annonser än 20 dåliga.
// Promptagenten skriver tre idéer, en granskare poängsätter dem mot referensvideon och skriver om den bästa.
// Når ingen idé upp till MIN_VIDEO_SCORE beställs ingen video, så att inga pengar går till en dålig annons.
const MIN_SCORE = Number(process.env.MIN_VIDEO_SCORE || 8);
const REFERENCE = fs.readFileSync(new URL("./reference-ad.md", import.meta.url), "utf8");

const CAPTIONS = {
  type: "object",
  additionalProperties: false,
  required: ["instagram", "facebook", "tiktok"],
  properties: { instagram: { type: "string" }, facebook: { type: "string" }, tiktok: { type: "string" } },
};
const CONCEPT = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "hook", "video_prompt", "overlay_text", "captions"],
  properties: {
    idea: { type: "string", description: "Kort beskrivning av idén på svenska" },
    hook: { type: "string", description: "Vad tittaren ser de första 2 sekunderna" },
    video_prompt: { type: "string", description: "Prompt till videomodellen, på engelska" },
    overlay_text: { type: "string", description: "Förslag på text i bild med tider, t.ex. '0–2 s: Leriga tassar?'" },
    captions: CAPTIONS,
  },
};
const CONCEPTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["concepts"],
  properties: { concepts: { type: "array", items: CONCEPT } },
};
const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reviews", "final", "score", "problems"],
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["idea", "score", "problems"],
        properties: { idea: { type: "string" }, score: { type: "integer" }, problems: { type: "string" } },
      },
    },
    final: CONCEPT,
    score: { type: "integer", description: "Betyg 1–10 för den slutliga versionen" },
    problems: { type: "string", description: "Det som fortfarande är svagt i den slutliga versionen" },
  },
};

const RULES = `Regler för en bra annons:
- Stående 9:16, exakt 10 sekunder, högst 3 scener. Kroken syns inom 2 sekunder.
- Produkten ska se ut exakt som på produktbilden (form, färg, storlek). Hitta inte på delar, logotyper eller förpackningar.
- Videoprompten skrivs på engelska och beskriver för varje scen: tid (t.ex. 0–3 s), vad som händer, kameravinkel och rörelse, ljus och miljö. Realistisk stil som en bra mobilvideo, inte reklamfilm i studio.
- Videomodellen klarar inte text, logotyper eller komplicerade handrörelser. Ingen text i bild i videoprompten; text i bild föreslås separat i overlay_text.
- Kitet är tasstvätt + mikrofiberhandduk. Prioritera videor som visar hur kitet används som bäst, i rätt ordning (doppa, vrid, torka med handduken), enligt "Så används kitet bäst" i researchen.
- Ett säljargument ägaren vill ha med: de mjuka silikonborsten känns som en massage för hunden. Visa det snyggt och lugnt (hunden slappnar av, njuter, kanske blundar) och säg det som en känsla ("som en mjuk tassmassage"). Påstå inga hälsoeffekter som inte finns under "Verifierade fakta".
- Låna greppen från "Annonser som gått bra och varför" – krok, format och känsla – men kopiera aldrig någon annans video.
- Hundar ska se naturliga och glada ut. Inget som kan uppfattas som djurplågeri.
- Texterna skrivs på svenska, är korta och slutar med en tydlig uppmaning. TikTok: lekfull, 3–5 hashtags. Instagram: lite längre, hashtags. Facebook: vänlig, få hashtags.
- Alla siffror och påståenden måste vara sanna: pris och innehåll från produktinfon, övriga fakta bara från "Verifierade fakta" i researchen. Annars ingen siffra.`;

// Videor görs bara när du har beställt dem på kontrollsidan. Kön sparas per produkt.
export const queuedVideos = (productId) => getSetting(`video_queue_${productId}`, 0);
export const setQueuedVideos = (productId, count) => setSetting(`video_queue_${productId}`, Math.max(0, count));

/** Nästa video i kön görs först när den förra är klar, så att högst en video skapas åt gången. */
export function videoDue(product) {
  if (queuedVideos(product.id) <= 0) return false;
  return !db.prepare("SELECT 1 FROM videos WHERE product_id = ? AND status = 'generating'").get(product.id);
}

function videosThisMonth() {
  const month = stockholmDate().slice(0, 7);
  return db.prepare("SELECT created_at FROM videos WHERE status != 'failed'").all()
    .filter((v) => stockholmDate(v.created_at).startsWith(month)).length;
}

export async function createVideo(product) {
  // Kolla nyckeln innan Claude anropas, så att inga pengar går åt i onödan.
  if (!higgsfieldConfigured()) throw new Error("HF_API_KEY saknas i Railway");
  if (videosThisMonth() >= MAX_PER_MONTH) {
    setQueuedVideos(product.id, 0);
    log(product.id, "prompt", `Månadens tak på ${MAX_PER_MONTH} videor är nått. Kön är tömd.`);
    return;
  }
  setQueuedVideos(product.id, queuedVideos(product.id) - 1);
  const research = latestResearch(product.id);
  const earlier = db.prepare("SELECT idea, status FROM videos WHERE product_id = ? AND idea IS NOT NULL ORDER BY id DESC LIMIT 10").all(product.id);

  const productInfo = `Produkt: ${product.name}, pris ${product.price}
Beskrivning: ${product.description}
Målgrupp: ${product.audience}
Butik: ${product.shop_url}`;
  const researchText = research?.notes ?? "(ingen research än – använd beprövade grepp: problem–lösning, före/efter, och inga siffror utöver pris)";
  const earlierText = earlier.map((e) => `- [${e.status}] ${e.idea}`).join("\n") || "(inga)";
  const images = product.image_url ? [product.image_url] : [];

  let plan;
  let feedback = "";
  for (let attempt = 1; attempt <= 2 && !plan; attempt++) {
    log(product.id, "prompt", attempt === 1 ? "Skriver tre videoidéer…" : "Försöker igen med granskarens kommentarer…");
    const { concepts } = await askClaude({
      schema: CONCEPTS_SCHEMA,
      effort: "high",
      images,
      system:
        "Du är promptagent för Vardagshoppen och gör korta reklamvideor med en AI-videomodell. Produktbilden skickas med till videomodellen. " +
        "Ägaren vill hellre ha 3 riktigt bra annonser än 20 dåliga, så varje idé ska vara genomtänkt. " +
        "Ägaren har valt en referensvideo som förebild; använd dess grepp.\n\n" + REFERENCE + "\n\n" + RULES,
      prompt: `${productInfo}

Bilden ovan är produktbilden. Titta noga på hur produkten ser ut och beskriv den korrekt i videoprompten.

Research från researchagenten (faktakollad):
${researchText}

Tidigare idéer (upprepa inte; "rejected" betyder att ägaren inte gillade den, "approved" att den gillade den):
${earlierText}
${feedback ? `\nGranskarens kommentarer på förra försöket, rätta till dem:\n${feedback}\n` : ""}
Skriv tre olika idéer.`,
    });

    log(product.id, "prompt", "Granskar idéerna mot referensvideon…");
    const review = await askClaude({
      schema: REVIEW_SCHEMA,
      effort: "high",
      images,
      system:
        "Du är en sträng kvalitetsgranskare av korta reklamvideor för Vardagshoppen. Du jämför idéer med ägarens referensvideo och reglerna, " +
        "och du godkänner bara sådant som verkligen kan bli en bra annons. Betygsätt 1–10 där 8 betyder 'skulle fungera bra som betald annons'. " +
        "Kolla särskilt: stark krok inom 2 s, att produkten beskrivs som på bilden, att videomodellen klarar scenerna, ett tydligt budskap, " +
        "och att varje siffra och påstående i texterna stöds av produktinfon eller av 'Verifierade fakta'. " +
        "Ta den bästa idén och skriv en förbättrad slutversion där alla problem är rättade.\n\n" + REFERENCE + "\n\n" + RULES,
      prompt: `${productInfo}

Research (faktakollad):
${researchText}

Idéer att granska:
${JSON.stringify(concepts, null, 2)}`,
    });
    log(product.id, "prompt", `Bästa idén fick ${review.score}/10${review.problems ? ` (${review.problems.slice(0, 200)})` : ""}.`);
    if (review.score >= MIN_SCORE) plan = { ...review.final, score: review.score };
    else feedback = [review.problems, ...review.reviews.map((r) => `${r.idea}: ${r.problems}`)].join("\n");
  }

  if (!plan) {
    setQueuedVideos(product.id, 0);
    log(product.id, "prompt", `Ingen idé nådde ${MIN_SCORE}/10, så ingen video beställdes och kön är stoppad. Prova igen efter ny research, eller ge feedback genom att godkänna och avvisa videor.`);
    return;
  }
  const idea = `${plan.idea} · Kvalitet ${plan.score}/10 · Text i bild: ${plan.overlay_text}`;

  const { lastInsertRowid } = db.prepare(
    "INSERT INTO videos (product_id, created_at, status, idea, prompt, captions) VALUES (?, ?, 'generating', ?, ?, ?)"
  ).run(product.id, now(), idea, plan.video_prompt, JSON.stringify(plan.captions));
  const videoId = Number(lastInsertRowid);

  try {
    const requestId = await startVideo({
      prompt: plan.video_prompt, imageUrl: product.image_url, idempotencyKey: `agent-uf-video-${videoId}`,
    });
    db.prepare("UPDATE videos SET hf_request_id = ? WHERE id = ?").run(requestId, videoId);
    log(product.id, "prompt", `Video #${videoId} beställd (${plan.score}/10): ${plan.idea}`);
  } catch (err) {
    db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?").run(err.message, videoId);
    throw err;
  }
}

/** Kollar beställda videor. Klara videor sparas och väntar på ditt godkännande. */
export async function pollVideos() {
  const generating = db.prepare("SELECT * FROM videos WHERE status = 'generating' AND hf_request_id IS NOT NULL").all();
  for (const video of generating) {
    const result = await checkVideo(video.hf_request_id);
    if (result.status === "waiting") continue;
    if (result.status === "failed") {
      db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?").run(result.error, video.id);
      log(video.product_id, "prompt", `Video #${video.id} misslyckades och kön är tömd: ${result.error}`);
      setQueuedVideos(video.product_id, 0);
      continue;
    }
    const file = `${crypto.randomBytes(12).toString("hex")}.mp4`;
    const res = await fetch(result.videoUrl);
    if (!res.ok) throw new Error(`Kunde inte ladda ner video #${video.id} (${res.status})`);
    fs.writeFileSync(path.join(MEDIA_DIR, file), Buffer.from(await res.arrayBuffer()));
    db.prepare("UPDATE videos SET status = 'pending', video_url = ?, local_file = ? WHERE id = ?").run(result.videoUrl, file, video.id);
    log(video.product_id, "prompt", `Video #${video.id} är klar och väntar på ditt godkännande.`);
  }
}
