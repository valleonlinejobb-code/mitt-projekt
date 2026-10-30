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
import { workingProductImage, productImageUrls, productOptions, sizesOf } from "../shopify.js";
import { editVideo } from "../editor.js";
import { voiceConfigured, synthesizeVoice, speakable } from "../voice.js";
import { refreshStats, performance } from "./stats.js";
import { polishEnabled, polishLook, polishSound } from "../polish.js";

// Krok-typerna från Metas Ads Creative Studio. De tre idéerna ska använda olika typer.
export const HOOK_TYPES = ["nöjsam start", "känslosam berättelse", "sketch", "FOMO", "problem–lösning"];

const MAX_PER_MONTH = Number(process.env.MAX_VIDEOS_PER_MONTH || 35);

// Kvalitet före mängd: ägaren vill hellre ha 3 bra annonser än 20 dåliga.
// Promptagenten skriver tre idéer, en granskare poängsätter dem mot referensvideon och skriver om den bästa.
// Når ingen idé upp till MIN_VIDEO_SCORE beställs ingen video, så att inga pengar går till en dålig annons.
const MIN_SCORE = Number(process.env.MIN_VIDEO_SCORE || 8);
// Kroken (första 1–2 sekunderna) avgör om någon tittar alls, så den får ett eget betyg med eget krav (ägarens önskan).
const MIN_HOOK_SCORE = Number(process.env.MIN_HOOK_SCORE || 8);
const REFERENCE = fs.readFileSync(new URL("./reference-ad.md", import.meta.url), "utf8");

// Texten under videon ska vara kort: långa texter läses inte och låter AI-skrivna (ägarens önskan).
const CAPTION = { type: "string", description: "1–2 korta meningar på naturlig svenska (högst 150 tecken utan hashtags), pris och erbjudande, sedan 2–3 hashtags" };
export const CAPTIONS = {
  type: "object",
  additionalProperties: false,
  required: ["instagram", "facebook", "tiktok"],
  properties: { instagram: CAPTION, facebook: CAPTION, tiktok: CAPTION },
};
export const CAPTION_MAX = 150;
// Fraser som får en text att låta AI-skriven eller som reklamklyschor.
const CLICHES = [/upptäck/i, /säg (hej|adjö)/i, /revolution/i, /game.?changer/i, /oavsett om/i, /perfekt för alla/i, /ta .{0,20}till nästa nivå/i, /missa inte/i, /här är hemligheten/i, /din nya bästa vän/i];

/** Kollar med kod att texterna under videon är korta, enkla och inte låter AI-skrivna. */
export function captionProblems(captions = {}) {
  const problems = [];
  for (const [channel, text] of Object.entries(captions)) {
    const t = String(text ?? "");
    const tags = t.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    const body = t.replace(/#[\p{L}\p{N}_]+/gu, "").trim();
    const emojis = t.match(/\p{Extended_Pictographic}/gu) ?? [];
    const sentences = body.replace(/\b[\w-]+\.(com|se)\b/gi, "").split(/[.!?]+/).filter((x) => x.trim().length > 2).length;
    if (body.length > CAPTION_MAX) problems.push(`Texten till ${channel} är ${body.length} tecken, högst ${CAPTION_MAX} (utan hashtags).`);
    if (sentences > 3) problems.push(`Texten till ${channel} har ${sentences} meningar, högst 3 inklusive priset.`);
    if (tags.length > 3) problems.push(`Texten till ${channel} har ${tags.length} hashtags, högst 3.`);
    if (emojis.length > 2) problems.push(`Texten till ${channel} har ${emojis.length} emojis, högst 2.`);
    for (const re of CLICHES) if (re.test(body)) problems.push(`Texten till ${channel} låter AI-skriven ("${body.match(re)[0]}"). Skriv som en människa.`);
  }
  return problems;
}
// Information om butiken och produkten som klipparen visar snyggt i bild (ägaren vill ha en ren, informativ reklam).
export const INFO_BAR = { type: "string", description: "Produktraden längst ner under hela videon, högst 40 tecken, t.ex. 'Tasstvättkit · kopp + handduk · 199 kr'" };
export const END_CARD = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "features", "offer_lines", "cta"],
  properties: {
    headline: { type: "string", description: "Samma löfte som på produktsidan, högst 6 ord" },
    features: { type: "array", items: { type: "string" }, description: "2–3 korta fördelar ur produktinfon, högst 3 ord var, t.ex. 'Mjuka borst', 'Handduk ingår'" },
    offer_lines: { type: "array", items: { type: "string" }, description: "0–2 korta rader med erbjudandena, exakt kod och procent" },
    cta: { type: "string", description: "Kort uppmaning utan webbadress, t.ex. 'Beställ idag'" },
  },
};
const CONCEPT = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "hook_type", "variant_of", "audience", "hook", "video_prompt", "overlays", "voiceover", "info_bar", "end_card", "captions"],
  properties: {
    idea: { type: "string", description: "Kort beskrivning av idén på svenska" },
    hook_type: { type: "string", enum: HOOK_TYPES, description: "Vilken sorts krok de första 3 sekunderna" },
    variant_of: { type: "integer", description: "Numret på vinnarvideon om idén är en variant av den, annars 0" },
    audience: { type: "string", description: "Vem annonsen riktar sig till (identitetsordet), t.ex. 'hundägare med ljust golv'" },
    hook: { type: "string", description: "Vad tittaren ser de första 2 sekunderna" },
    video_prompt: { type: "string", description: "Prompt till videomodellen på engelska, i scener: 'Shot 1 (0-2s): ...' (se Så skriver du videoprompten)" },
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
    info_bar: INFO_BAR,
    end_card: END_CARD,
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
  required: ["reviews", "final", "score", "hook_score", "problems"],
  properties: {
    reviews: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["idea", "score", "hook_score", "problems"],
        properties: { idea: { type: "string" }, score: { type: "integer" }, hook_score: { type: "integer" }, problems: { type: "string" } },
      },
    },
    final: CONCEPT,
    score: { type: "integer", description: "Betyg 1–10 för den slutliga versionen" },
    hook_score: { type: "integer", description: "Eget betyg 1–10 för bara kroken (första 2 sekunderna) i den slutliga versionen" },
    problems: { type: "string", description: "Det som fortfarande är svagt i den slutliga versionen" },
  },
};

const VIDEO_SECONDS = Number(process.env.VIDEO_SECONDS || 10);

// Hur videomodellen (Wan 3.0 via Higgsfield) vill ha prompten. Modellen har ingen negativ prompt och följer det som står
// konkret: scen för scen, med bild, rörelse, ljus och handling uttryckt med verb. Delvis kontrolleras det av videoPromptProblems.
const PROMPT_GUIDE = `Så skriver du videoprompten (det är den som avgör hur bra videon blir):
- Engelska, 100–250 ord, uppdelad i 2–3 scener som börjar exakt så här: "Shot 1 (0-2s): ...", "Shot 2 (2-8s): ...", "Shot 3 (8-${VIDEO_SECONDS}s): ...". Tiderna ska gå från 0 till ${VIDEO_SECONDS} utan glapp.
- Scenen där produkten används är den längsta, minst 4 sekunder, och beskriver rörelsen steg för steg med tydliga verb i rätt ordning (t.ex. "lowers the muddy paw into the cup, pumps the cup up and down three times and twists it, lifts out the clean paw").
- Varje scen beskriver: bildutsnitt och vinkel (t.ex. "close-up at the dog's eye level"), EN kamerarörelse (t.ex. "static", "slow push-in", "gentle handheld"), vad som händer, ljus ("soft natural daylight from a window") och miljö ("bright clean Scandinavian home, light oak floor, white rug").
- Produkten: kalla den "the paw-washing cup from the reference images" (och handduken "the grey microfiber towel from the reference images") och beskriv färg, form och de mjuka borsten inuti exakt som på bilderna.
- Händer och hund: skriv vad varje hand gör ("the owner's left hand gently holds the dog's front leg, the right hand holds the cup"). Beskriv hunden och ägaren på samma sätt i varje scen (ras, färg, storlek, kläder) så att de inte byter utseende.
- Fysik som gör det trovärdigt: lera på tassen, grumligt brunt vatten, droppar, borst som böjer sig, handduken som lindas runt tassen.
- Avsluta med stilen: "Photorealistic vertical smartphone video, sharp focus, natural colors, realistic hand and paw anatomy, no on-screen text."
- Skriv det du vill se, inte det du inte vill se (modellen förstår "inte" dåligt). Ingen text, logga, skylt, tal eller musik i bilden.`;

// Vad som gör en krok bra. Granskaren sätter ett eget krokbetyg, och hookProblems kollar det som går att kolla med kod.
const HOOK_GUIDE = `Så gör du kroken (första 1–2 sekunderna) riktigt bra:
- Första bildrutan är redan mitt i handlingen: något rör sig direkt (en lerig tass som kliver, lera som stänker, en hund som springer in). Ingen etableringsbild, inget långsamt svep, ingen tom miljö, ingen logga eller titel.
- Problemet syns direkt i närbild och är tydligt även utan ljud: mycket lera, en ljus matta eller soffa i fara, ett lerigt avtryck.
- En känsla eller en fråga i huvudet: "nej, inte på mattan!" eller "vad är det där för kopp?". Tittaren ska vilja se nästa sekund.
- Rösten och texten i bild säger samma sak: texten i bild är rösten ordagrant, i korta bitar i samma takt. Därför ska rösten börja med kroken: första meningen högst 5 ord som talar direkt till tittaren, t.ex. "Leriga tassar igen?" eller "Inte på nya mattan!". Den visas från första bildrutan.
- Shot 1 är högst 3 sekunder och börjar med ett verb i rörelse ("A muddy paw steps…", "Mud splashes…").`;

const RULES = `Regler för en bra annons:
- Stående 9:16, exakt ${VIDEO_SECONDS} sekunder från videomodellen, högst 3 scener. Kroken syns inom 2 sekunder.
- Visa varför man ska köpa: först problemet (FÖRE, t.ex. en smutsig, lerig tass och leriga avtryck på golvet), sedan produkten i användning och till sist resultatet (EFTER, ren tass, rent golv, nöjd ägare). Före/efter ska synas tydligt i bild.
- Produkten ska se ut exakt som på produktbilden (form, färg, storlek). Hitta inte på delar, logotyper eller förpackningar.
- Videoprompten skrivs på engelska och beskriver för varje scen: tid (t.ex. 0–3 s), vad som händer, kameravinkel och rörelse, ljus och miljö. Ljus, ren och snygg stil: ett städat svenskt hem i dagsljus (ljust golv, ljus matta), skarp bild, lugn kamera i hundens höjd. Äkta och trovärdig, men välkomponerad som en snygg reklamfilm, inte rörig.
- Videomodellen klarar inte text, logotyper eller komplicerade handrörelser. Ingen text, skylt eller logga i videoprompten. Be om naturliga ljud (vatten, tassar) men inget tal och ingen musik, eftersom berättarrösten läggs på efteråt. Håll den sista sekunden lugn.
- VIKTIGAST: visa tydligt hur produkten används, som i ägarens användningsvideo i referensen. Användningen ska synas i minst 4 sekunder i en följd, i närbild, så att tittaren förstår exakt hur man gör. Se "Ägarens användningsvideo" i referensen och ägarens instruktioner för produkten. En video där produkten bara skymtar eller används fel är underkänd.
- Annonsen ska se ut som en snygg, ren reklam med mycket information om butiken och produkten: info_bar (produktraden längst ner hela videon) och end_card.features (2–3 korta fördelar ur produktinfon) visas av klipparen. Bara sant från produktinfon.
- Det här läggs på automatiskt efteråt, så du ska inte be videomodellen om det: Vardagshoppens logga och namn uppe till vänster, priset uppe till höger, din text i bild (overlays) produktraden (info_bar) längst ner och en slutbild på 3 sekunder med logga, rubrik, produktbild, fördelar, pris, erbjudanden, uppmaning och webbadress.
- overlays: 2–4 korta texter (1–5 ord) med tider mellan 0 och ${VIDEO_SECONDS} s som följer före → efter. De används bara om rösten inte går att göra; annars visas rösten ordagrant som text i bild. Låt dem därför vara samma ord som rösten säger vid samma tid, t.ex. "Leriga tassar igen?" först om rösten börjar så.
- voiceover: en lugn, vänlig kvinnoröst som pratar svenska, högst 30 ord (ca 12 sekunder). Den säger problemet, lösningen, priset och erbjudandet med exakt kod, och avslutar med var man köper (vardagshoppen.com). Skriv koden så att den går att uttala, t.ex. "koden FORSTA10".
- Rösten ska låta som en riktig hundägare som berättar för en kompis, inte som en reklamröst: vardagligt talspråk, korta meningar (3–8 ord), "du" i stället för "man", kommatecken där man andas, högst ett utropstecken. Inga reklamord (t.ex. "revolutionerande", "perfekt för", "missa inte", "unik"), inga uppräkningar med tre saker och inga ord som är svåra att uttala.
- end_card: headline är samma löfte som produktsidan ger (annonsen och sidan ska matcha). offer_lines är 0–2 korta rader med erbjudandena, t.ex. "−5 % med koden VALKOMMEN5". cta är en kort uppmaning utan webbadress.
- Produkten är för ALLA hundar, små som stora: koppens storlek (S, M eller L) väljs efter hundens storlek. Rikta aldrig en annons bara till stora (eller bara små) hundar, och skriv inte "stor hund" i texterna. Variera hundens ras och storlek mellan idéerna (t.ex. en liten terrier, en mellanstor spaniel, en stor labrador).
- Rikta varje idé till en tydlig grupp i målgruppen med ett identitetsord (t.ex. "hundägare med ljust golv", "du som bor på landet", "du med hund i bilen") och skriv in det i texten i bild eller texterna. Ge de tre idéerna olika grupper.
- De första 2 sekunderna avgör allt. Den starkaste kroken för oss: en riktigt lerig tass på väg in mot en ljus matta eller ett ljust golv, i närbild från hundens höjd. Minst en av de tre idéerna ska börja så, om inte beställningen bestämmer kroken.
${HOOK_GUIDE}
- Krokar: ge de tre idéerna olika krok-typer (hook_type): "nöjsam start" (t.ex. lera som sköljs bort i närbild, tillfredsställande att se), "känslosam berättelse" (ägaren och hunden, vardagskänsla), "sketch" (en kort rolig situation, t.ex. hunden springer in lerig precis efter städningen), "FOMO" (bara med ett riktigt erbjudande, t.ex. att FORSTA10 bara gäller de 10 första) eller "problem–lösning".
- Visa produkten i användning av en människa (händer, ägaren med hunden), inte bara produkten på ett bord. Det ger mänsklig kontakt och förtroende.
- Förtroendesignaler gör annonsen trovärdigare, men bara sanna: Vardagshoppen är ett svenskt UF-företag. Andra (garanti, leveranstid, betyg, antal sålda) bara om de står i produktinfon, ägarens instruktioner eller "Verifierade fakta".
- Finns en vinnarvideo under "Resultat" ska en av de tre idéerna vara en variant av den (variant_of = dess nummer): behåll kärnan som fungerade, men byt kroken (de första 3 sekunderna), miljön eller utseendet så att tittaren inte tänker "den här har jag sett förut".
- Prioritera videor som visar hur produkten används som bäst, enligt "Så används produkten bäst" i researchen.
- Låna greppen från "Annonser som gått bra och varför" – krok, format och känsla – men kopiera aldrig någon annans video.
- Använd "Kundernas röst" i researchen: bygg krokar och texter på kundernas egna klagomål och ord, och bemöt en vanlig invändning (t.ex. "passar den min hund?": ja, koppen finns i S, M och L efter hundens storlek) om produktinfon stöder svaret. Citera aldrig en kund i annonsen.
- Hundar ska se naturliga och glada ut. Inget som kan uppfattas som djurplågeri.
- Texterna under videon (captions) är KORTA: 1–2 meningar på naturlig, vardaglig svenska (högst 150 tecken utan hashtags), sedan priset och erbjudandet och 2–3 hashtags. Videon gör jobbet, texten ska bara läsas på en sekund. Skriv som en riktig butik, inte som en AI: inga klyschor ("Upptäck", "Säg adjö till", "Missa inte", "game changer"), inga utropstecken i varje mening, högst 2 emojis. Exempel: "Leriga tassar? Pumpa, vrid, torka – klart på 10 sekunder. 199 kr på vardagshoppen.com #hund #hundliv"
- Rabatter och erbjudanden: nämn bara det som står under "Aktuella erbjudanden", med exakt samma procent och kod. Rabatter som står i produktbeskrivningen kan vara gamla och får inte användas. Står det inga erbjudanden nämns ingen rabatt.
- Alla siffror och påståenden måste vara sanna: priset från produktinfon, övriga fakta bara från "Verifierade fakta" i researchen. Annars ingen siffra.

${PROMPT_GUIDE}`;

/**
 * Kollar med kod att videoprompten har den form videomodellen behöver: 2–3 scener med tider från 0 till videons längd,
 * rimlig längd, produkten från referensbilderna och en tydlig användningsscen. Returnerar en lista med problem.
 */
export function videoPromptProblems(prompt, product) {
  const problems = [];
  const text = String(prompt ?? "");
  const shots = [...text.matchAll(/Shot\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s\)\s*:/gi)]
    .map((m, i, all) => ({ from: Number(m[2]), to: Number(m[3]), body: text.slice(m.index, all[i + 1]?.index ?? text.length) }));
  if (shots.length < 2 || shots.length > 3) problems.push(`Videoprompten ska ha 2–3 scener som börjar med "Shot 1 (0-2s):", men har ${shots.length}.`);
  else {
    if (shots[0].from !== 0) problems.push("Första scenen i videoprompten ska börja på 0s.");
    if (Math.abs(shots.at(-1).to - VIDEO_SECONDS) > 0.5) problems.push(`Sista scenen i videoprompten ska sluta på ${VIDEO_SECONDS}s.`);
    if (shots.some((s, i) => i > 0 && Math.abs(s.from - shots[i - 1].to) > 0.5)) problems.push("Scenernas tider i videoprompten hänger inte ihop.");
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 80 || words > 300) problems.push(`Videoprompten är ${words} ord, den ska vara 100–250.`);
  if (!/reference image/i.test(text)) problems.push('Videoprompten ska säga att produkten ser ut som på bilderna ("from the reference images").');
  // Tasstvättkitet: användningen (pumpa/vrida/skrubba) ska ha en egen scen på minst 4 s, och handduken ska vara med.
  if (/tass/i.test(`${product.name} ${product.description}`)) {
    const use = shots.find((s) => /\b(pump|twist|scrub)/i.test(s.body));
    if (!use) problems.push("Videoprompten visar inte hur koppen används (pumpa och vrida runt tassen).");
    else if (use.to - use.from < 3.5) problems.push(`Användningsscenen är ${use.to - use.from} s, den ska vara minst 4 s.`);
    if (!/towel/i.test(text)) problems.push("Videoprompten visar inte handduken som torkar tassen.");
  }
  return problems;
}

/** Kollar med kod det som går att kolla i kroken: första texten i bild och första scenen. */
export function hookProblems(plan) {
  const problems = [];
  const firstSentence = String(plan.voiceover ?? "").split(/(?<=[.!?])\s+/)[0] ?? "";
  if (firstSentence.split(/\s+/).filter(Boolean).length > 6) problems.push(`Rösten ska börja med kroken i högst 5 ord (den visas som första text i bild), men första meningen är "${firstSentence}".`);
  const first = [...(plan.overlays ?? [])].sort((a, b) => a.from - b.from)[0];
  if (!first || first.from > 0.3) problems.push("Första texten i bild ska komma direkt på 0 s, det är en del av kroken.");
  else if (first.text.split(/\s+/).filter(Boolean).length > 5) problems.push(`Första texten i bild ("${first.text}") är för lång för en krok, högst 5 ord.`);
  const text = String(plan.video_prompt ?? "");
  const shot1 = text.match(/Shot\s*1\s*\((\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*s\)\s*:([\s\S]*?)(?=Shot\s*2|$)/i);
  if (shot1) {
    if (Number(shot1[2]) - Number(shot1[1]) > 3) problems.push("Första scenen (kroken) är längre än 3 s. Kom till saken direkt.");
    if (/establishing|slow(ly)? (pan|zoom|reveal)|wide shot|aerial|fade[s]? in|\blogo\b|\btitle\b/i.test(shot1[3])) problems.push("Första scenen börjar långsamt (etableringsbild, svep, logga eller titel). Börja mitt i handlingen i närbild.");
  }
  return problems;
}

/** Alla texter i annonsen som kunden ser eller hör. */
const adTexts = (plan) => [
  ...(plan.overlays ?? []).map((o) => o.text), plan.voiceover,
  plan.info_bar, plan.end_card?.headline, ...(plan.end_card?.features ?? []), ...(plan.end_card?.offer_lines ?? []), plan.end_card?.cta,
  ...Object.values(plan.captions ?? {}),
].filter(Boolean);

/** Nämner annonsen en storlek ska den nämna alla (ägaren: rösten sa bara L fast kitet finns i S, M och L). */
export function sizeProblems(plan, sizes) {
  if (sizes.length < 2) return [];
  const all = adTexts(plan).join("\n");
  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = sizes.filter((v) => new RegExp(`(^|[^\\p{L}])${escape(v)}(?![\\p{L}])`, "u").test(all));
  if (named.length && named.length < sizes.length) {
    return [`Annonsen nämner bara storlek ${named.join(", ")}, men produkten finns i ${sizes.join(", ")}. Nämn alla storlekar, t.ex. "finns i ${sizes.slice(0, -1).join(", ")} och ${sizes.at(-1)}".`];
  }
  return [];
}

/**
 * Kollar med kod (inte med Claude) att annonsen bara nämner rätt pris, rätt rabattkoder och rätt procent.
 * Returnerar en lista med problem. Tom lista betyder att allt stämmer.
 */
export function claimProblems(plan, product, offers, maxWords = 30) {
  const problems = [];
  const texts = adTexts(plan);
  problems.push(...captionProblems(plan.captions));
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
  const options = await productOptions(product);
  const sizes = sizesOf(options);
  const productInfo = `Produkt: ${product.name}, pris ${product.price}
Beskrivning: ${product.description}${options.length ? `\nVal i butiken: ${options.map((o) => `${o.name}: ${o.values.join(", ")}`).join("; ")}${sizes.length > 1 ? `. Nämner du storlek ska ALLA storlekar nämnas (${sizes.join(", ")}), aldrig bara en.` : ""}` : ""}
Målgrupp: ${product.audience}
Butik: Vardagshoppen (vardagshoppen.com), ett svenskt UF-företag. Produktsidan: ${product.shop_url}
Aktuella erbjudanden (de enda rabatterna som får nämnas): ${offers || "(inga)"}${product.focus ? `\nÄgarens instruktioner för just den här produkten (följ dem):\n${product.focus}` : ""}`;
  const researchText = research?.notes ?? "(ingen research än – använd beprövade grepp: problem–lösning, före/efter, och inga siffror utöver pris)";
  const earlierText = earlier.map((e) => `- #${e.id} [${e.status}] ${e.idea}`).join("\n") || "(inga)";
  const resultsText = results.text
    ? `${results.text}\n${results.winner ? `Vinnarvideon just nu: #${results.winner.id} (högst krokgrad). Gör en av idéerna som en variant av den.` : "Ingen video har visats minst 300 gånger än, så det finns ingen vinnare."}`
    : "(inga resultat än – videorna är inte publicerade eller Meta har inte skickat siffror)";
  const images = await productImageUrls(product, imageUrl);

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

Bilderna ovan är produktbilderna (samma bilder får videomodellen som referens). Titta noga på hur produkten ser ut och beskriv den korrekt i videoprompten.

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
        "att videomodellen klarar scenerna, att produktens användning visas tydligt i minst 4 sekunder i en följd (som i ägarens användningsvideo), att videon ser ut som en snygg och ren reklam med tydlig information om butiken och produkten, ett tydligt identitetsord för målgruppen, " +
        "att rösten och slutbilden säger pris och erbjudande rätt och lockar till köp, att rubriken matchar produktsidan, " +
        "att produkten används av en människa och på rätt sätt enligt ägarens instruktioner (står det hur produkten ska användas, t.ex. att tassen gnuggas runt i koppen och torkas med handduken, ska det stå tydligt i videoprompten), att förtroendesignaler är sanna, och att idéerna bygger på det som gått bra under 'Resultat'. " +
        "och att varje siffra och påstående i texterna stöds av produktinfon, 'Aktuella erbjudanden' eller 'Verifierade fakta'. " +
        "Sätt dessutom ett eget krokbetyg (hook_score 1–10) för bara de första 2 sekunderna: Stannar en hundägare som scrollar förbi? 8 betyder 'stannar nästan alla i målgruppen'. " +
        "Dra ner krokbetyget om första bildrutan är stilla, en etableringsbild, ett långsamt svep eller en logga, om problemet inte syns direkt i närbild, eller om första texten i bild är lång eller kommer sent. " +
        "Ta den bästa idén och skriv en förbättrad slutversion där alla problem är rättade och kroken är så stark som möjligt.\n\n" + REFERENCE + "\n\n" + RULES,
      prompt: `${productInfo}

Research (faktakollad):
${researchText}

Resultat för våra publicerade videor:
${resultsText}
${jobText ? `\nDen här beställningen (slutversionen måste följa den):\n${jobText}\n` : ""}
Idéer att granska:
${JSON.stringify(concepts, null, 2)}`,
    });
    log(product.id, "prompt", `Bästa idén fick ${review.score}/10 (kroken ${review.hook_score}/10)${review.problems ? ` (${review.problems.slice(0, 200)})` : ""}.`);
    // Fel pris, kod eller procent stoppas även om granskaren gav högt betyg.
    const wrong = [...claimProblems(review.final, product, offers), ...jobCheck(review.final), ...videoPromptProblems(review.final.video_prompt, product), ...hookProblems(review.final), ...sizeProblems(review.final, sizes)];
    if (review.hook_score < MIN_HOOK_SCORE) wrong.push(`Kroken fick ${review.hook_score}/10, den måste få minst ${MIN_HOOK_SCORE}. Gör de första 2 sekunderna starkare enligt "Så gör du kroken".`);
    if (wrong.length) log(product.id, "prompt", `Stoppad av faktakollen: ${wrong.join(" ")}`);
    if (review.score >= MIN_SCORE && !wrong.length) plan = { ...review.final, score: review.score, hook_score: review.hook_score };
    else feedback = [...wrong, review.problems, ...review.reviews.map((r) => `${r.idea}: ${r.problems}`)].join("\n");
  }

  if (!plan) {
    setQueuedVideos(product.id, 0);
    log(product.id, "prompt", `Ingen idé nådde ${MIN_SCORE}/10, så ingen video beställdes och kön är stoppad. Prova igen efter ny research, eller ge feedback genom att godkänna och avvisa videor.`);
    progress.stopped(product.id, "prompt", `Ingen idé nådde ${MIN_SCORE}/10, så ingen video beställdes`);
    return;
  }
  const idea = `${plan.idea} · Krok: ${plan.hook_type}${plan.variant_of ? ` (variant av #${plan.variant_of})` : ""} · För: ${plan.audience} · Kvalitet ${plan.score}/10, krok ${plan.hook_score}/10 · Text i bild: ${plan.overlays.map((o) => o.text).join(" / ")} · Röst: "${plan.voiceover}"`;
  const edit = { overlays: plan.overlays, voiceover: plan.voiceover, info_bar: plan.info_bar, end_card: plan.end_card };

  const { lastInsertRowid } = db.prepare(`INSERT INTO videos
    (product_id, created_at, status, idea, prompt, captions, edit, hook_type, variant_of, ab_group, source)
    VALUES (?, ?, 'generating', ?, ?, ?, ?, ?, ?, ?, 'ai')`
  ).run(product.id, now(), idea, plan.video_prompt, JSON.stringify(plan.captions), JSON.stringify(edit),
    plan.hook_type, plan.variant_of || null, job.kind === "ab" ? job.group : null);
  const videoId = Number(lastInsertRowid);

  progress.stage(product.id, "prompt", "send", `Video #${videoId}`);
  try {
    const requestId = await startVideo({
      prompt: plan.video_prompt, imageUrls: images, idempotencyKey: `agent-uf-video-${videoId}`,
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

    db.prepare("UPDATE videos SET video_url = ?, raw_file = ? WHERE id = ?").run(result.videoUrl, rawFile, video.id);
    progress.stage(video.product_id, "prompt", "edit", `Video #${video.id}`);
    await editAndOffer({ ...video, raw_file: rawFile });
  }
}

/**
 * Klipper den färdiga annonsen och lägger den för godkännande. En video utan text, pris och slutbild
 * visas aldrig för godkännande: misslyckas klippningen markeras videon som misslyckad, och den kan klippas
 * om gratis med "Klipp om" (Higgsfield-videon finns kvar på servern).
 */
export async function editAndOffer(video) {
  const outFile = `${crypto.randomBytes(12).toString("hex")}.mp4`;
  try {
    const { voiceError, polishError } = await finishAd(video, video.raw_file, outFile);
    const note = [voiceError && `Utan berättarröst: ${voiceError}`, polishError && `Utan sista touch: ${polishError}`].filter(Boolean).join(" ") || null;
    db.prepare("UPDATE videos SET status = 'pending', local_file = ?, error = ? WHERE id = ?").run(outFile, note, video.id);
    if (video.local_file && video.local_file !== video.raw_file) fs.rmSync(path.join(MEDIA_DIR, path.basename(video.local_file)), { force: true });
    log(video.product_id, "prompt", `Video #${video.id} är klar och väntar på ditt godkännande.${note ? ` ${note}` : ""}`);
    progress.done(video.product_id, "prompt", `Video #${video.id}`);
    return true;
  } catch (err) {
    const error = `Text, pris och slutbild kunde inte läggas på, så videon visas inte för godkännande: ${err.message}`;
    db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?").run(error, video.id);
    log(video.product_id, "prompt", `Video #${video.id}: ${error}`);
    progress.failed(video.product_id, "prompt", error);
    return false;
  }
}

/** Laddar ner produktbilden till slutbilden. Utan bild blir slutbilden utan den, i stället för att stoppa videon. */
async function productImageFile(product) {
  try {
    const url = await workingProductImage(product);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`svarade ${res.status}`);
    const file = path.join(MEDIA_DIR, `.product-${product.id}-${crypto.randomBytes(6).toString("hex")}.img`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  } catch (err) {
    log(product.id, "prompt", `Produktbilden kunde inte hämtas till slutbilden: ${err.message}`);
    return null;
  }
}

/**
 * Lägger på logga, pris, text i bild, slutbild med produktbild och berättarröst.
 * Går rösten inte att göra blir videon klar ändå, utan röst, och voiceError säger varför.
 */
export async function finishAd(video, rawFile, outFile) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(video.product_id);
  const edit = JSON.parse(video.edit || "{}");
  if (!edit.overlays?.length && !edit.end_card) throw new Error("Videon saknar text i bild och slutbild, så den kan inte klippas. Beställ en ny video.");
  let voiceFile;
  let voiceError = null;
  if (edit.voiceover && voiceConfigured()) {
    try {
      voiceFile = path.join(MEDIA_DIR, `${outFile}.voice.mp3`);
      fs.writeFileSync(voiceFile, await synthesizeVoice(speakable(edit.voiceover)));
    } catch (err) {
      voiceFile = undefined;
      voiceError = err.message;
    }
  } else if (edit.voiceover) {
    voiceError = "GOOGLE_TTS_API_KEY saknas i Railway";
  }
  const productImage = product ? await productImageFile(product) : null;
  // Redigeringsagenten putsar bilden innan text och slutbild läggs på. Går det inte klipps filmen som den är.
  let input = path.join(MEDIA_DIR, rawFile);
  let polished = null;
  let polishError = null;
  let transitionAt;
  const polish = polishEnabled();
  if (polish) {
    progress.stage(video.product_id, "polish", "look", `Video #${video.id}`);
    polished = path.join(MEDIA_DIR, `${outFile}.polished.mp4`);
    try {
      transitionAt = (await polishLook(input, polished)).duration;
      input = polished;
    } catch (err) {
      polishError = err.message.slice(0, 300);
    }
    progress.stage(video.product_id, "polish", "edit", `Video #${video.id}`);
  }
  const options = {
    input,
    output: path.join(MEDIA_DIR, outFile),
    overlays: edit.overlays ?? [],
    price: product?.price ?? "",
    endCard: edit.end_card ?? {},
    infoBar: edit.info_bar ?? "",
    voiceFile,
    // Texten i bild: din egen text om du skrev en (t.ex. när rösten behöver ett ord stavat som det låter), annars det rösten säger.
    voiceText: voiceFile ? edit.caption_text || edit.voiceover : "",
  };
  try {
    try {
      await editVideo({ ...options, productImage });
    } catch (err) {
      // En trasig produktbild ska inte stoppa annonsen: då görs slutbilden utan den.
      if (!productImage) throw err;
      log(video.product_id, "prompt", `Produktbilden gick inte att lägga i slutbilden, så den görs utan: ${err.message.slice(0, 200)}`);
      await editVideo(options);
    }
  } catch (err) {
    if (polish) progress.stopped(video.product_id, "polish", `Video #${video.id} kunde inte klippas`);
    throw err;
  } finally {
    if (voiceFile) fs.rmSync(voiceFile, { force: true });
    if (productImage) fs.rmSync(productImage, { force: true });
    if (polished) fs.rmSync(polished, { force: true });
  }
  if (polish) {
    progress.stage(video.product_id, "polish", "sound", `Video #${video.id}`);
    try {
      await polishSound(options.output, { transitionAt });
    } catch (err) {
      polishError = [polishError, err.message.slice(0, 300)].filter(Boolean).join(" ");
    }
    if (polishError) {
      log(video.product_id, "prompt", `Redigeringsagenten: video #${video.id} fick inte hela sista touchen: ${polishError}`);
      progress.failed(video.product_id, "polish", `Video #${video.id}: ${polishError}`);
    } else {
      progress.done(video.product_id, "polish", `Video #${video.id}`);
    }
  }
  return { file: outFile, voiceError, polishError };
}
