// Promptagenten: skriver videoprompt + texter, beställer videon och väntar in den.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, log, stockholmDate, getSetting, setSetting, currentOffers, MEDIA_DIR } from "../db.js";
import { askClaude } from "../claude.js";
import { newRun } from "../costs.js";
import { startVideo, checkVideo, higgsfieldConfigured } from "../higgsfield.js";
import { latestResearch } from "./research.js";
import * as progress from "../progress.js";
import { workingProductImage } from "../shopify.js";
import { editVideo } from "../editor.js";
import { voiceConfigured, synthesizeVoice } from "../voice.js";
import { refreshStats, performance } from "./stats.js";

// Krok-typerna från Metas Ads Creative Studio. De tre idéerna ska använda olika typer.
export const HOOK_TYPES = ["nöjsam start", "känslosam berättelse", "sketch", "FOMO", "problem–lösning"];

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
  required: ["idea", "hook_type", "variant_of", "audience", "hook", "video_prompt", "overlays", "voiceover", "end_card", "captions"],
  properties: {
    idea: { type: "string", description: "Kort beskrivning av idén på svenska" },
    hook_type: { type: "string", enum: HOOK_TYPES, description: "Vilken sorts krok de första 3 sekunderna" },
    variant_of: { type: "integer", description: "Numret på vinnarvideon om idén är en variant av den, annars 0" },
    audience: { type: "string", description: "Vem annonsen riktar sig till (identitetsordet), t.ex. 'ägare till stora hundar'" },
    hook: { type: "string", description: "Vad tittaren ser de första 2 sekunderna" },
    video_prompt: { type: "string", description: "Prompt till videomodellen, på engelska" },
    overlays: {
      type: "array",
      description: "Text i bild under videon (inte slutbilden), 2–4 st, 1–5 ord var",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "text"],
        properties: { from: { type: "number" }, to: { type: "number" }, text: { type: "string" } },
      },
    },
    voiceover: { type: "string", description: "Berättarrösten på svenska, högst 30 ord, nämner erbjudandet" },
    end_card: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "offer_lines", "cta"],
      properties: {
        headline: { type: "string", description: "Samma löfte som på produktsidan, högst 6 ord" },
        offer_lines: { type: "array", items: { type: "string" }, description: "0–2 korta rader med erbjudandena, exakt kod och procent" },
        cta: { type: "string", description: "Kort uppmaning utan webbadress, t.ex. 'Beställ idag'" },
      },
    },
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

const VIDEO_SECONDS = Number(process.env.VIDEO_SECONDS || 10);

const RULES = `Regler för en bra annons:
- Stående 9:16, exakt ${VIDEO_SECONDS} sekunder från videomodellen, högst 3 scener. Kroken syns inom 2 sekunder.
- Visa varför man ska köpa: först problemet (FÖRE, t.ex. en smutsig, lerig tass och leriga avtryck på golvet), sedan produkten i användning och till sist resultatet (EFTER, ren tass, rent golv, nöjd ägare). Före/efter ska synas tydligt i bild.
- Produkten ska se ut exakt som på produktbilden (form, färg, storlek). Hitta inte på delar, logotyper eller förpackningar.
- Videoprompten skrivs på engelska och beskriver för varje scen: tid (t.ex. 0–3 s), vad som händer, kameravinkel och rörelse, ljus och miljö. Realistisk stil som en vanlig mobilvideo i ett svenskt hem, inte reklamfilm i studio, så att den känns som ett vanligt inlägg och inte som en annons.
- Videomodellen klarar inte text, logotyper eller komplicerade handrörelser. Ingen text, skylt eller logga i videoprompten. Be om naturliga ljud (vatten, tassar) men inget tal och ingen musik, eftersom berättarrösten läggs på efteråt. Håll den sista sekunden lugn.
- Det här läggs på automatiskt efteråt, så du ska inte be videomodellen om det: Vardagshoppens logga och namn uppe till vänster, priset uppe till höger, din text i bild (overlays) och en slutbild på 3 sekunder med logga, rubrik, pris, erbjudanden, uppmaning och webbadress.
- overlays: 2–4 korta texter (1–5 ord) med tider mellan 0 och ${VIDEO_SECONDS} s som följer före → efter, t.ex. "Leriga tassar igen?" och "Ren tass på sekunder". Skriv som en vanlig TikTok-text, inte som en reklamskylt.
- voiceover: en lugn, vänlig kvinnoröst som pratar svenska, högst 30 ord (ca 12 sekunder). Den säger problemet, lösningen, priset och erbjudandet med exakt kod, och avslutar med var man köper (vardagshoppen.com). Skriv koden så att den går att uttala, t.ex. "koden FORSTA10".
- end_card: headline är samma löfte som produktsidan ger (annonsen och sidan ska matcha). offer_lines är 0–2 korta rader med erbjudandena, t.ex. "−5 % med koden VALKOMMEN5". cta är en kort uppmaning utan webbadress.
- Rikta varje idé till en tydlig grupp i målgruppen med ett identitetsord (t.ex. "ägare till stora hundar", "du som bor på landet", "hundägare med ljust golv") och skriv in det i texten i bild eller texterna. Ge de tre idéerna olika grupper.
- De första 2 sekunderna avgör allt. Den starkaste kroken för oss: en riktigt lerig tass på väg in mot en ljus matta eller ett ljust golv, i närbild från hundens höjd. Minst en av de tre idéerna ska börja så, om inte beställningen bestämmer kroken.
- Krokar: ge de tre idéerna olika krok-typer (hook_type): "nöjsam start" (t.ex. lera som sköljs bort i närbild, tillfredsställande att se), "känslosam berättelse" (ägaren och hunden, vardagskänsla), "sketch" (en kort rolig situation, t.ex. hunden springer in lerig precis efter städningen), "FOMO" (bara med ett riktigt erbjudande, t.ex. att FORSTA10 bara gäller de 10 första) eller "problem–lösning".
- Visa produkten i användning av en människa (händer, ägaren med hunden), inte bara produkten på ett bord. Det ger mänsklig kontakt och förtroende.
- Förtroendesignaler gör annonsen trovärdigare, men bara sanna: Vardagshoppen är ett svenskt UF-företag. Andra (garanti, leveranstid, betyg, antal sålda) bara om de står i produktinfon, ägarens instruktioner eller "Verifierade fakta".
- Finns en vinnarvideo under "Resultat" ska en av de tre idéerna vara en variant av den (variant_of = dess nummer): behåll kärnan som fungerade, men byt kroken (de första 3 sekunderna), miljön eller utseendet så att tittaren inte tänker "den här har jag sett förut".
- Prioritera videor som visar hur produkten används som bäst, enligt "Så används produkten bäst" i researchen.
- Låna greppen från "Annonser som gått bra och varför" – krok, format och känsla – men kopiera aldrig någon annans video.
- Hundar ska se naturliga och glada ut. Inget som kan uppfattas som djurplågeri.
- Texterna (captions) skrivs på svenska och slutar med en tydlig uppmaning, priset och erbjudandet. TikTok: lekfull, 3–5 hashtags. Instagram och Facebook: längre, beskriv vem produkten är för och vilket problem den löser (det hjälper annonssystemet att hitta rätt köpare), några hashtags.
- Rabatter och erbjudanden: nämn bara det som står under "Aktuella erbjudanden", med exakt samma procent och kod. Rabatter som står i produktbeskrivningen kan vara gamla och får inte användas. Står det inga erbjudanden nämns ingen rabatt.
- Alla siffror och påståenden måste vara sanna: priset från produktinfon, övriga fakta bara från "Verifierade fakta" i researchen. Annars ingen siffra.`;

/**
 * Kollar med kod (inte med Claude) att annonsen bara nämner rätt pris, rätt rabattkoder och rätt procent.
 * Returnerar en lista med problem. Tom lista betyder att allt stämmer.
 */
export function claimProblems(plan, product, offers, maxWords = 30) {
  const problems = [];
  const texts = [
    ...(plan.overlays ?? []).map((o) => o.text), plan.voiceover,
    plan.end_card?.headline, ...(plan.end_card?.offer_lines ?? []), plan.end_card?.cta,
    ...Object.values(plan.captions ?? {}),
  ].filter(Boolean);
  const all = texts.join("\n");
  const codesInOffers = new Set(offers.match(/\b[A-ZÅÄÖ]{3,}\d+\b/g) ?? []);
  const percentsInOffers = new Set([...offers.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|procent)/gi)].map((m) => m[1]));
  const price = String(product.price).match(/\d+/)?.[0];
  for (const code of new Set(all.match(/\b[A-ZÅÄÖ]{3,}\d+\b/g) ?? [])) {
    if (!codesInOffers.has(code)) problems.push(`Rabattkoden ${code} finns inte under Aktuella erbjudanden.`);
  }
  for (const [, n] of all.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|procent)/gi)) {
    if (!percentsInOffers.has(n)) problems.push(`${n} % finns inte under Aktuella erbjudanden.`);
  }
  for (const [, n] of all.matchAll(/(\d+)\s*(?:kr\b|kronor|:-)/gi)) {
    if (n !== price) problems.push(`Priset ${n} kr stämmer inte med produktens pris (${product.price}).`);
  }
  const words = String(plan.voiceover ?? "").split(/\s+/).filter(Boolean).length;
  if (words > maxWords + 4) problems.push(`Berättarrösten har ${words} ord, högst ${maxWords} får plats.`);
  return [...new Set(problems)];
}

/** Säger till om produkttexten i Shopify lovar en annan procent för en kod än Aktuella erbjudanden. */
export function offerMismatches(description, offers) {
  const percentFor = (text, code) => text.match(new RegExp(`(\\d+)\\s*%[^.!?\\n]{0,80}?\\b${code}\\b`))?.[1];
  const result = [];
  for (const code of new Set(offers.match(/\b[A-ZÅÄÖ]{3,}\d+\b/g) ?? [])) {
    const inOffers = percentFor(offers, code);
    const inDescription = percentFor(description ?? "", code);
    if (inOffers && inDescription && inOffers !== inDescription) {
      result.push(`Produkttexten i Shopify säger ${inDescription} % för ${code}, men Aktuella erbjudanden säger ${inOffers} %. Annonserna använder ${inOffers} %. Ändra den text som är fel.`);
    }
  }
  return result;
}

// Videor görs bara när du har beställt dem på kontrollsidan. Kön sparas per produkt som en lista med jobb:
// { kind: "normal" }, { kind: "ab", group } (en video i ett A/B-test) eller { kind: "variant", of } (variant av en video).
const jobsKey = (productId) => `video_jobs_${productId}`;
export function videoJobs(productId) {
  // Äldre kö (bara ett antal) blir vanliga jobb.
  const legacy = getSetting(`video_queue_${productId}`, 0);
  if (legacy > 0) {
    setSetting(`video_queue_${productId}`, 0);
    setSetting(jobsKey(productId), [...getSetting(jobsKey(productId), []), ...Array.from({ length: legacy }, () => ({ kind: "normal" }))]);
  }
  return getSetting(jobsKey(productId), []);
}
export const setVideoJobs = (productId, jobs) => setSetting(jobsKey(productId), jobs);
export const addVideoJobs = (productId, jobs) => setVideoJobs(productId, [...videoJobs(productId), ...jobs]);
export const queuedVideos = (productId) => videoJobs(productId).length;
/** Sätter kön till så många vanliga videor (0 tömmer den). */
export const setQueuedVideos = (productId, count) => setVideoJobs(productId, Array.from({ length: Math.max(0, count) }, () => ({ kind: "normal" })));

/** Nästa nummer för ett A/B-test, t.ex. "A/B 3". */
export function newAbGroup() {
  const n = getSetting("ab_counter", 0) + 1;
  setSetting("ab_counter", n);
  return `A/B ${n}`;
}

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

/**
 * Vad ett A/B- eller variantjobb kräver av idén: en text till Claude och en kodkoll av slutversionen.
 * A/B-test: samma budskap, men varje video får en egen krok-typ, så att siffrorna visar vilken krok som fungerar.
 */
export function jobInstructions(job) {
  if (job.kind === "ab") {
    const siblings = db.prepare("SELECT id, idea, hook_type FROM videos WHERE ab_group = ? AND status != 'failed' ORDER BY id").all(job.group);
    const used = siblings.map((v) => v.hook_type).filter(Boolean);
    const free = HOOK_TYPES.filter((h) => !used.includes(h));
    const first = siblings[0];
    return {
      text: `Videon ingår i ${job.group}, ett A/B-test med 3 videor. Alla videor i testet har samma budskap, produkt och erbjudande. Bara kroken (de första 3 sekunderna) skiljer sig, så att siffrorna visar vilken krok som fungerar bäst.
${used.length ? `Krok-typer som redan används i testet: ${used.join(", ")}. Välj någon av: ${free.join(", ")}.` : "Det här är testets första video."}${first ? `
Behåll budskapet från video #${first.id}: ${first.idea}` : ""}`,
      check: (plan) => (used.includes(plan.hook_type) ? [`Krok-typen "${plan.hook_type}" används redan i ${job.group}. Välj någon av: ${free.join(", ")}.`] : []),
    };
  }
  if (job.kind === "variant") {
    const target = db.prepare("SELECT id, idea FROM videos WHERE id = ?").get(job.of);
    if (!target) return { text: "", check: () => [] };
    return {
      text: `Ägaren beställde en variant: alla tre idéer ska vara varianter av video #${target.id} (${target.idea}). Behåll kärnan, men byt kroken (de första 3 sekunderna), miljön eller utseendet så att den känns ny. Sätt variant_of = ${target.id}.`,
      check: (plan) => (plan.variant_of === target.id ? [] : [`Idén måste vara en variant av video #${target.id} (variant_of = ${target.id}).`]),
    };
  }
  return { text: "", check: () => [] };
}

export async function createVideo(product) {
  // Kolla nyckeln innan Claude anropas, så att inga pengar går åt i onödan.
  if (!higgsfieldConfigured()) throw new Error("HF_API_KEY saknas i Railway");
  if (videosThisMonth() >= MAX_PER_MONTH) {
    setQueuedVideos(product.id, 0);
    log(product.id, "prompt", `Månadens tak på ${MAX_PER_MONTH} videor är nått. Kön är tömd.`);
    progress.stopped(product.id, "prompt", `Månadens tak på ${MAX_PER_MONTH} videor är nått`);
    return;
  }
  // Bilden kollas innan Claude anropas, så att inga pengar går åt om den inte går att hämta.
  const imageUrl = await workingProductImage(product);
  const [job = { kind: "normal" }, ...rest] = videoJobs(product.id);
  setVideoJobs(product.id, rest);
  const { text: jobText, check: jobCheck } = jobInstructions(job);
  await refreshStats(product.id); // gratis: hur våra publicerade videor har gått
  const results = performance(product.id);
  const research = latestResearch(product.id);
  const earlier = db.prepare("SELECT id, idea, status FROM videos WHERE product_id = ? AND idea IS NOT NULL ORDER BY id DESC LIMIT 10").all(product.id);

  const offers = currentOffers();
  for (const warning of offerMismatches(product.description, offers)) log(product.id, "prompt", `Obs: ${warning}`);
  const productInfo = `Produkt: ${product.name}, pris ${product.price}
Beskrivning: ${product.description}
Målgrupp: ${product.audience}
Butik: Vardagshoppen (vardagshoppen.com), ett svenskt UF-företag. Produktsidan: ${product.shop_url}
Aktuella erbjudanden (de enda rabatterna som får nämnas): ${offers || "(inga)"}${product.focus ? `\nÄgarens instruktioner för just den här produkten (följ dem):\n${product.focus}` : ""}`;
  const researchText = research?.notes ?? "(ingen research än – använd beprövade grepp: problem–lösning, före/efter, och inga siffror utöver pris)";
  const earlierText = earlier.map((e) => `- #${e.id} [${e.status}] ${e.idea}`).join("\n") || "(inga)";
  const resultsText = results.text
    ? `${results.text}\n${results.winner ? `Vinnarvideon just nu: #${results.winner.id} (högst krokgrad). Gör en av idéerna som en variant av den.` : "Ingen video har visats minst 300 gånger än, så det finns ingen vinnare."}`
    : "(inga resultat än – videorna är inte publicerade eller Meta har inte skickat siffror)";
  const images = imageUrl ? [imageUrl] : [];

  let plan;
  let feedback = "";
  const cost = { agent: "prompt", task: "video", run: newRun(), productId: product.id };
  for (let attempt = 1; attempt <= 2 && !plan; attempt++) {
    log(product.id, "prompt", attempt === 1 ? "Skriver tre videoidéer…" : "Försöker igen med granskarens kommentarer…");
    progress.stage(product.id, "prompt", "ideas", attempt === 1 ? "" : "försök 2");
    const { concepts } = await askClaude({
      ...cost,
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

Resultat för våra publicerade videor (krokgrad = andel som tittade minst 3 s av dem som fick se videon):
${resultsText}
${jobText ? `\nDen här beställningen:\n${jobText}\n` : ""}${feedback ? `\nGranskarens kommentarer på förra försöket, rätta till dem:\n${feedback}\n` : ""}
Skriv tre olika idéer.`,
    });

    log(product.id, "prompt", "Granskar idéerna mot referensvideon…");
    progress.stage(product.id, "prompt", "review", attempt === 1 ? "" : "försök 2");
    const review = await askClaude({
      ...cost,
      schema: REVIEW_SCHEMA,
      effort: "high",
      images,
      system:
        "Du är en sträng kvalitetsgranskare av korta reklamvideor för Vardagshoppen. Du jämför idéer med ägarens referensvideo och reglerna, " +
        "och du godkänner bara sådant som verkligen kan bli en bra annons. Betygsätt 1–10 där 8 betyder 'skulle fungera bra som betald annons'. " +
        "Kolla särskilt: stark krok inom 2 s, tydligt före (smutsigt problem) och efter (rent resultat), att produkten beskrivs som på bilden, " +
        "att videomodellen klarar scenerna, att videon känns som ett vanligt inlägg och inte som en annons, ett tydligt identitetsord för målgruppen, " +
        "att rösten och slutbilden säger pris och erbjudande rätt och lockar till köp, att rubriken matchar produktsidan, " +
        "att produkten används av en människa, att förtroendesignaler är sanna, och att idéerna bygger på det som gått bra under 'Resultat'. " +
        "och att varje siffra och påstående i texterna stöds av produktinfon, 'Aktuella erbjudanden' eller 'Verifierade fakta'. " +
        "Ta den bästa idén och skriv en förbättrad slutversion där alla problem är rättade.\n\n" + REFERENCE + "\n\n" + RULES,
      prompt: `${productInfo}

Research (faktakollad):
${researchText}

Resultat för våra publicerade videor:
${resultsText}
${jobText ? `\nDen här beställningen (slutversionen måste följa den):\n${jobText}\n` : ""}
Idéer att granska:
${JSON.stringify(concepts, null, 2)}`,
    });
    log(product.id, "prompt", `Bästa idén fick ${review.score}/10${review.problems ? ` (${review.problems.slice(0, 200)})` : ""}.`);
    // Fel pris, kod eller procent stoppas även om granskaren gav högt betyg.
    const wrong = [...claimProblems(review.final, product, offers), ...jobCheck(review.final)];
    if (wrong.length) log(product.id, "prompt", `Stoppad av faktakollen: ${wrong.join(" ")}`);
    if (review.score >= MIN_SCORE && !wrong.length) plan = { ...review.final, score: review.score };
    else feedback = [...wrong, review.problems, ...review.reviews.map((r) => `${r.idea}: ${r.problems}`)].join("\n");
  }

  if (!plan) {
    setQueuedVideos(product.id, 0);
    log(product.id, "prompt", `Ingen idé nådde ${MIN_SCORE}/10, så ingen video beställdes och kön är stoppad. Prova igen efter ny research, eller ge feedback genom att godkänna och avvisa videor.`);
    progress.stopped(product.id, "prompt", `Ingen idé nådde ${MIN_SCORE}/10, så ingen video beställdes`);
    return;
  }
  const idea = `${plan.idea} · Krok: ${plan.hook_type}${plan.variant_of ? ` (variant av #${plan.variant_of})` : ""} · För: ${plan.audience} · Kvalitet ${plan.score}/10 · Text i bild: ${plan.overlays.map((o) => o.text).join(" / ")} · Röst: "${plan.voiceover}"`;
  const edit = { overlays: plan.overlays, voiceover: plan.voiceover, end_card: plan.end_card };

  const { lastInsertRowid } = db.prepare(`INSERT INTO videos
    (product_id, created_at, status, idea, prompt, captions, edit, hook_type, variant_of, ab_group, source)
    VALUES (?, ?, 'generating', ?, ?, ?, ?, ?, ?, ?, 'ai')`
  ).run(product.id, now(), idea, plan.video_prompt, JSON.stringify(plan.captions), JSON.stringify(edit),
    plan.hook_type, plan.variant_of || null, job.kind === "ab" ? job.group : null);
  const videoId = Number(lastInsertRowid);

  progress.stage(product.id, "prompt", "send", `Video #${videoId}`);
  try {
    const requestId = await startVideo({
      prompt: plan.video_prompt, imageUrl, idempotencyKey: `agent-uf-video-${videoId}`,
    });
    db.prepare("UPDATE videos SET hf_request_id = ? WHERE id = ?").run(requestId, videoId);
    log(product.id, "prompt", `Video #${videoId} beställd (${plan.score}/10): ${plan.idea}`);
    progress.stage(product.id, "prompt", "render", `Video #${videoId}`);
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
    if (result.status === "completed" && !result.videoUrl) Object.assign(result, { status: "failed", error: "Higgsfield skickade ingen videolänk" });
    if (result.status === "failed") {
      db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?").run(result.error, video.id);
      log(video.product_id, "prompt", `Video #${video.id} misslyckades och kön är tömd: ${result.error}`);
      progress.failed(video.product_id, "prompt", result.error);
      setQueuedVideos(video.product_id, 0);
      continue;
    }
    progress.stage(video.product_id, "prompt", "download", `Video #${video.id}`);
    const name = crypto.randomBytes(12).toString("hex");
    const rawFile = `${name}-raw.mp4`;
    const res = await fetch(result.videoUrl);
    if (!res.ok) throw new Error(`Kunde inte ladda ner video #${video.id} (${res.status})`);
    fs.writeFileSync(path.join(MEDIA_DIR, rawFile), Buffer.from(await res.arrayBuffer()));

    progress.stage(video.product_id, "prompt", "edit", `Video #${video.id}`);
    let file = rawFile;
    let note = null;
    try {
      file = await finishAd(video, rawFile, `${name}.mp4`);
    } catch (err) {
      // Hellre en video utan logga än ingen video alls. Felet syns på kontrollsidan.
      note = `Logga, pris och röst kunde inte läggas på: ${err.message}`;
      log(video.product_id, "prompt", `Video #${video.id}: ${note}`);
    }
    db.prepare("UPDATE videos SET status = 'pending', video_url = ?, local_file = ?, raw_file = ?, error = ? WHERE id = ?")
      .run(result.videoUrl, file, rawFile, note, video.id);
    log(video.product_id, "prompt", `Video #${video.id} är klar och väntar på ditt godkännande.`);
    progress.done(video.product_id, "prompt", `Video #${video.id}`);
  }
}

/** Lägger på logga, pris, text i bild, slutbild och berättarröst. Returnerar filnamnet på den färdiga annonsen. */
export async function finishAd(video, rawFile, outFile) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(video.product_id);
  const edit = JSON.parse(video.edit || "{}");
  let voiceFile;
  if (edit.voiceover && voiceConfigured()) {
    voiceFile = path.join(MEDIA_DIR, `${outFile}.voice.mp3`);
    fs.writeFileSync(voiceFile, await synthesizeVoice(edit.voiceover));
  } else if (edit.voiceover) {
    log(video.product_id, "prompt", "GOOGLE_TTS_API_KEY saknas i Railway, så videon görs utan berättarröst.");
  }
  try {
    await editVideo({
      input: path.join(MEDIA_DIR, rawFile),
      output: path.join(MEDIA_DIR, outFile),
      overlays: edit.overlays ?? [],
      price: product?.price ?? "",
      endCard: edit.end_card ?? {},
      voiceFile,
    });
  } finally {
    if (voiceFile) fs.rmSync(voiceFile, { force: true });
  }
  return outFile;
}
