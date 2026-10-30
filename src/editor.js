// Klipparen: lägger på det som videomodellen inte kan göra själv, med ffmpeg på servern (gratis).
// Butikens namn och logga, priset, text i bild, en slutbild med pris och erbjudanden, och berättarrösten.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const ASSETS = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../assets");
const W = 720;
const H = 1280;
const STORE_DOMAIN = new URL(process.env.SHOPIFY_STORE_URL || "https://vardagshoppen.com").host.replace(/^www\./, "");

// Typsnitten för texten i bild. Servern på Railway har inga egna typsnitt, och då ritade undertextmotorn (libass)
// ingenting alls: varken text, pris eller den gröna slutbilden (bara loggan och produktbilden, som läggs på på annat sätt).
// Därför får ffmpeg en egen fontconfig-fil som pekar på våra typsnitt, så att det fungerar likadant på alla datorer.
const FONTS_DIR = path.join(ASSETS, "fonts");
const FONTCONFIG_FILE = path.join(os.tmpdir(), "vardagshoppen-fonts.conf");
fs.writeFileSync(FONTCONFIG_FILE, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${FONTS_DIR}</dir>
  <cachedir>${path.join(os.tmpdir(), "vardagshoppen-fontcache")}</cachedir>
</fontconfig>
`);

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", ...args], { env: { ...process.env, FONTCONFIG_FILE } });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-20_000); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

/** Längd i sekunder och om filen har ljud. */
export async function probe(file) {
  const { stderr } = await run(["-i", file]);
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error(`Kunde inte läsa ${path.basename(file)}: ${stderr.slice(-300)}`);
  return { duration: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), hasAudio: /Stream #.*Audio:/.test(stderr) };
}

/** Tar ut några bilder (JPEG, base64) jämnt utspridda i filmen, så att Claude kan se vad som händer i den. */
export async function extractFrames(file, count = 4) {
  const { duration } = await probe(file);
  const frames = [];
  for (let i = 0; i < count; i++) {
    const at = (duration * (i + 0.5)) / count;
    const out = `${file}.frame${i}.jpg`;
    const { code, stderr } = await run(["-y", "-ss", at.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=-2:640", "-q:v", "4", out]);
    if (code !== 0 || !fs.existsSync(out)) throw new Error(`Kunde inte ta ut bilder ur filmen: ${stderr.slice(-300)}`);
    frames.push({ at, data: fs.readFileSync(out).toString("base64"), media_type: "image/jpeg" });
    fs.rmSync(out, { force: true });
  }
  return { duration, frames };
}

const assTime = (s) => {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
// Text från Claude får inte innehålla ASS-koder.
const assText = (s) => String(s ?? "").replace(/[{}\\]/g, "").replace(/\s*\n\s*/g, "\\N").trim();

// Färger i ASS skrivs &HAABBGGRR. Grönt #073322, benvitt #F7F5F0.
const GREEN = "&H00223307";
const OFFWHITE = "&H00F0F5F7";

// Slutbildens platser (y-led). Med produktbild flyttas texten så att bilden får plats i mitten.
const LAYOUT = {
  plain: { logo: { size: 200, y: 200 }, brand: 450, headline: 505, features: 660, price: 790, offer: 900, cta: 1050, domain: 1125 },
  product: { logo: { size: 120, y: 60 }, brand: 220, headline: 262, image: { w: 480, h: 360, y: 370 }, features: 775, price: 875, offer: 965, cta: 1075, domain: 1155 },
};

/** y-uttryck för ffmpeg: bilden börjar `dist` pixlar längre ner och glider upp på plats på 0,45 s, mjukt på slutet. */
const slideIn = (y, start, dist = 40) => `'${y}+${dist}*pow(max(0,1-(t-${start.toFixed(2)})/0.45),2)'`;

function buildAss({ duration, total, overlays, price, endCard, infoBar, layout }) {
  const t0 = duration;
  const L = layout;
  const line = (start, end, style, text, tags = "") => `Dialogue: 1,${assTime(start)},${assTime(end)},${style},,0,0,0,,${tags}${assText(text)}`;
  // Mjuka rörelser i stället för texter som bara tänds: allt glider upp en bit och tonas in, ett i taget.
  const rise = (x, y, an = 5, ms = 380) => `{\\an${an}\\move(${x},${y + 36},${x},${y},0,${ms})\\fad(${ms},0)}`;
  const events = [
    // Butiksnamnet bredvid loggan och priset uppe till höger, hela videon utom slutbilden.
    line(0, t0, "Brand", "Vardagshoppen", "{\\an4\\pos(130,78)\\fad(300,150)}"),
    // Prisrutan glider in från höger kant.
    ...(price ? [line(1.5, t0, "Badge", price, "{\\an9\\move(790,52,686,52,0,320)\\fad(200,150)}")] : []),
    // Produktraden längst ner glider upp, som i en riktig reklam: vad det är och vad det kostar.
    ...(infoBar ? [line(0.5, t0, "Info", infoBar, "{\\an2\\move(360,1300,360,1235,0,380)\\fad(300,150)}")] : []),
    // Texten i bild poppar in mjukt (växer från 85 % till 100 %).
    ...overlays
      .filter((o) => o.text && o.to > o.from && o.from < t0)
      .map((o) => line(o.from, Math.min(o.to, t0), "Caption", o.text, "{\\fscx90\\fscy90\\t(0,120,\\fscx100\\fscy100)\\fad(90,60)}")),
    // Övergången till slutbilden: en ljus och en grön panel sveper upp över videon, som i en riktig reklamfilm.
    `Dialogue: 0,${assTime(t0)},${assTime(t0 + 0.6)},Wipe,,0,0,0,,{\\an7\\move(0,${H},0,0,0,360)\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`,
    `Dialogue: 0,${assTime(t0 + 0.08)},${assTime(total)},Box,,0,0,0,,{\\an7\\move(0,${H},0,0,0,420)\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`,
    line(t0 + 0.35, total, "EndBrand", "Vardagshoppen", rise(360, L.brand)),
    ...(endCard.headline ? [line(t0 + 0.45, total, "EndText", endCard.headline, rise(360, L.headline, 8))] : []),
    ...((endCard.features ?? []).length ? [line(t0 + 0.75, total, "EndFeature", endCard.features.slice(0, 3).join("  ·  "), rise(360, L.features))] : []),
    // Priset poppar fram (lite större först, sedan rätt storlek).
    ...(price ? [line(t0 + 0.9, total, "EndPrice", price, `{\\an5\\pos(360,${L.price})\\fscx70\\fscy70\\t(0,220,\\fscx108\\fscy108)\\t(220,380,\\fscx100\\fscy100)\\fad(200,0)}`)] : []),
    ...(endCard.offer_lines ?? []).slice(0, 2).map((t, i) => line(t0 + 1.1 + i * 0.12, total, "EndOffer", t, rise(360, L.offer + i * 56))),
    ...(endCard.cta ? [line(t0 + 1.4, total, "EndOffer", endCard.cta, rise(360, L.cta))] : []),
    line(t0 + 1.5, total, "EndCta", STORE_DOMAIN, rise(360, L.domain)),
  ];
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Brand,Inter Display,42,&H00FFFFFF,&H00FFFFFF,&H60000000,&H00000000,1,0,0,0,100,100,0,0,3,10,0,4,0,0,0,1
Style: Badge,Inter Display,46,&H00FFFFFF,&H00FFFFFF,${GREEN},&H00000000,1,0,0,0,100,100,0,0,3,12,0,9,0,0,0,1
Style: Caption,Inter Display,58,&H00FFFFFF,&H00FFFFFF,&H50000000,&H00000000,1,0,0,0,100,100,0,0,3,14,0,2,60,60,330,1
Style: Box,Inter Display,10,&H00223307,&H00223307,&H00223307,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: Wipe,Inter Display,10,${OFFWHITE},${OFFWHITE},${OFFWHITE},&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: EndBrand,Inter Display,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: EndText,Inter,42,${OFFWHITE},${OFFWHITE},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,60,60,0,1
Style: EndPrice,Inter Display,132,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: Info,Inter Display,34,&H00FFFFFF,&H00FFFFFF,${GREEN},&H00000000,1,0,0,0,100,100,0,0,3,14,0,2,40,40,0,1
Style: EndFeature,Inter,32,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1
Style: EndOffer,Inter,38,${OFFWHITE},${OFFWHITE},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1
Style: EndCta,Inter Display,40,${GREEN},${GREEN},&H00FFFFFF,&H00000000,1,0,0,0,100,100,0,0,3,16,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

/** Hur lång själva bilden i filmen är (inte ljudet), genom att läsa igenom videoströmmen. */
async function videoLength(file) {
  const { stderr } = await run(["-i", file, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"]);
  const m = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
  const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return seconds > 0.5 ? seconds : null;
}

/**
 * Hur lång rösten verkligen är, genom att avkoda hela ljudfilen. Längden i MP3-filens huvud är bara en uppskattning
 * och kan vara för kort, och då klipptes videon av innan rösten hade pratat klart.
 */
async function audioLength(file) {
  const { stderr } = await run(["-i", file, "-map", "0:a:0", "-f", "null", "-"]);
  const m = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1);
  const seconds = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return seconds > 0.2 ? seconds : null;
}

/** Medelfärgen (r, g, b) i en ruta [w, h, x, y] av en video vid tiden t. */
export function colorAt(file, t, [w, h, x, y]) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1",
      "-vf", `crop=${w}:${h}:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const chunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.on("error", reject);
    child.on("close", () => resolve([...Buffer.concat(chunks).subarray(0, 3)]));
  });
}
const isGreen = ([r, g, b] = []) => g > r && g > b && g < 120 && r < 70;

/** En bild ur videon vid tiden t, förminskad till 90 × 160 punkter (rgb, 3 byte per punkt). */
function frameAt(file, t) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-v", "error", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1",
      "-vf", "scale=90:160", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const chunks = [];
    child.stdout.on("data", (d) => chunks.push(d));
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Tittar på den färdiga filmen innan den visas för dig: slutbilden ska ha grön bakgrund och synlig vit text,
 * och prisrutan och produktraden ska synas under videon. Annars kastas ett fel, så att en halvfärdig annons aldrig erbjuds.
 */
export async function verifyAd(file, { duration, total, price, infoBar }) {
  const problems = [];
  const end = await frameAt(file, Math.min(total - 0.3, duration + 2.6));
  if (end.length < 90 * 160 * 3) throw new Error("Kontrollen av den färdiga filmen kunde inte läsa slutbilden.");
  const px = (x, y) => [...end.subarray((y * 90 + x) * 3, (y * 90 + x) * 3 + 3)];
  if (![px(2, 40), px(2, 120), px(87, 80)].every(isGreen)) problems.push("slutbildens gröna bakgrund syns inte");
  let white = 0;
  for (let i = 0; i < end.length; i += 3) if (end[i] > 200 && end[i + 1] > 200 && end[i + 2] > 200) white++;
  if (white < 60) problems.push("slutbildens text (pris och rubrik) syns inte");
  if (price && duration > 2.5 && !isGreen(await colorAt(file, 2.2, [10, 10, 690, 48]))) problems.push("prisrutan uppe till höger syns inte");
  if (infoBar && duration > 2.5 && !isGreen(await colorAt(file, 2.2, [10, 6, 355, 1238]))) problems.push("produktraden längst ner syns inte");
  if (problems.length) throw new Error(`Kontrollen av den färdiga filmen hittade fel: ${problems.join(", ")}.`);
}

/** När rösten pratar: tidsintervall [start, slut] i sekunder, avgränsade av pauser i ljudet. */
export async function speechSegments(file, length) {
  const { stderr } = await run(["-i", file, "-af", "silencedetect=noise=-38dB:d=0.22", "-f", "null", "-"]);
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const segments = [];
  let from = 0;
  starts.forEach((start, i) => {
    if (start - from > 0.15) segments.push([from, start]);
    from = ends[i] ?? length;
  });
  if (length - from > 0.15) segments.push([from, length]);
  return segments;
}

/** Delar rösttexten i korta bitar (2–5 ord) som visas som text i bild, en i taget. */
export function captionChunks(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const text = current.join(" ");
    const pause = /[,;:–—]$/.test(word) && text.length >= 12;
    if (current.length >= 6 || text.length >= 26 || pause) {
      chunks.push(text);
      current = [];
    }
  }
  if (current.length) {
    // Ett ensamt sista ord läggs ihop med biten före, så att det inte blinkar förbi.
    if (current.length === 1 && chunks.length && chunks.at(-1).length + current[0].length < 34) chunks[chunks.length - 1] += ` ${current[0]}`;
    else chunks.push(current.join(" "));
  }
  return chunks.map((c) => c.replace(/[,;:.–—]+$/, "").trim()).filter(Boolean);
}

/**
 * Text i bild som visar exakt det rösten säger, i samma takt: meningarna läggs på rösten pauser i ljudet,
 * och bitarna inom en mening fördelas efter hur långa de är. Visas bara medan videon pågår (slutbilden har egen text).
 */
export function voiceCaptions(text, segments, { offset = 0.4, tempo = 1, until }) {
  const sentences = String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (!sentences.length || !segments.length) return [];
  const spans = segments.length === sentences.length
    ? segments
    : (() => {
      // Pauserna stämmer inte med meningarna: fördela meningarna efter längd över hela talet.
      const [start, end] = [segments[0][0], segments.at(-1)[1]];
      const total = sentences.reduce((a, s) => a + s.length, 0);
      let at = start;
      return sentences.map((s) => { const span = [at, at + ((end - start) * s.length) / total]; at = span[1]; return span; });
    })();
  const captions = [];
  sentences.forEach((sentence, i) => {
    const chunks = captionChunks(sentence);
    const [start, end] = spans[i];
    const weight = chunks.reduce((a, c) => a + c.length + 4, 0);
    let at = start;
    for (const chunk of chunks) {
      const next = at + ((end - start) * (chunk.length + 4)) / weight;
      captions.push({ from: offset + at / tempo, to: offset + next / tempo, text: chunk });
      at = next;
    }
  });
  // Bitarna hänger ihop utan glapp, den första syns redan från start (kroken) och ingen syns på slutbilden.
  captions.forEach((c, i) => { c.to = captions[i + 1]?.from ?? c.to + 0.3; });
  if (captions.length) captions[0].from = 0;
  return captions.filter((c) => c.from < until - 0.3).map((c) => ({ ...c, to: Math.min(c.to, until) }));
}

/**
 * Gör den färdiga annonsen av videomodellens video.
 * @param {object} o
 * @param {string} o.input       videon från Higgsfield
 * @param {string} o.output      färdig video
 * @param {{from:number,to:number,text:string}[]} o.overlays  text i bild under videon
 * @param {string} o.price       t.ex. "199 kr"
 * @param {{headline?:string, offer_lines?:string[], cta?:string}} o.endCard
 * @param {string} [o.voiceFile] berättarrösten (MP3)
 * @param {string} [o.voiceText] det rösten säger; blir texten i bild, i samma takt som rösten
 * @param {string} [o.productImage] produktbilden, visas i slutbilden så att man ser vad vi säljer
 * @param {string} [o.infoBar]   produktraden längst ner under videon
 */
export async function editVideo({ input, output, overlays = [], price = "", endCard = {}, voiceFile, voiceText = "", productImage, infoBar = "" }) {
  const probed = await probe(input);
  // Bildens egen längd: ljudet från videomodellen kan vara längre eller kortare än bilden.
  const duration = (await videoLength(input)) || probed.duration;
  const hasAudio = probed.hasAudio;
  const voice = voiceFile ? { duration: (await audioLength(voiceFile)) || (await probe(voiceFile)).duration } : null;
  // Rösten börjar efter 0,4 s. Är den lång pratar den lite snabbare (högst 10 %), så att slutbilden inte blir för lång.
  const tempo = voice ? Math.min(1.1, Math.max(1, (voice.duration + 0.4 + 1.2) / (duration + 8))) : 1;
  const voiceEnd = voice ? 0.4 + voice.duration / tempo : 0;
  // Slutbilden står kvar minst 4 s och alltid tills 1,2 s efter att rösten har pratat klart: videon tar aldrig slut mitt i en mening.
  const endSeconds = Math.max(4, voiceEnd + 1.2 - duration);
  const total = duration + endSeconds;

  // Med berättarröst visar texten i bild exakt det rösten säger, i samma takt (ägaren: annars läser man en sak och hör en annan).
  if (voice && voiceText.trim()) {
    const spoken = voiceCaptions(voiceText, await speechSegments(voiceFile, voice.duration), { tempo, until: duration });
    if (spoken.length) overlays = spoken;
  }

  const assFile = `${output}.ass`;
  const layout = productImage ? LAYOUT.product : LAYOUT.plain;
  fs.writeFileSync(assFile, buildAss({ duration, total, overlays, price, endCard, infoBar, layout }));

  const args = ["-y", "-i", input, "-loop", "1", "-i", path.join(ASSETS, "logo.png")];
  let next = 2;
  const imageIndex = productImage ? next++ : -1;
  if (productImage) args.push("-loop", "1", "-i", productImage);
  const voiceIndex = voice ? next++ : -1;
  if (voice) args.push("-i", voiceFile);
  const silenceIndex = hasAudio ? -1 : next++;
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");

  const filters = [
    `[0:v]setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,` +
      `trim=duration=${duration.toFixed(3)},tpad=stop_mode=clone:stop_duration=${endSeconds.toFixed(2)}[v0]`,
    "[1:v]split=2[l1][l2]", "[l1]scale=84:84[ls]", `[l2]scale=${layout.logo.size}:${layout.logo.size}[lb]`,
    `[v0][ls]overlay=28:36[v1]`,
    `[v1]subtitles=filename=${assFile}:fontsdir=${FONTS_DIR}[v2]`,
    // Loggan och produktbilden i slutbilden tonas in och glider upp på plats (samma rörelse som texterna).
    `[lb]format=rgba,fade=t=in:st=${(duration + 0.4).toFixed(2)}:d=0.4:alpha=1[lbf]`,
    `[v2][lbf]overlay=${(W - layout.logo.size) / 2}:${slideIn(layout.logo.y, duration + 0.4)}:eval=frame:enable='gte(t,${duration.toFixed(2)})'[v3]`,
    // Produktbilden på ett vitt kort mitt i slutbilden.
    productImage
      ? `[${imageIndex}:v]scale=${layout.image.w - 40}:${layout.image.h - 40}:force_original_aspect_ratio=decrease,pad=${layout.image.w}:${layout.image.h}:(ow-iw)/2:(oh-ih)/2:white,setsar=1,` +
        `format=rgba,fade=t=in:st=${(duration + 0.55).toFixed(2)}:d=0.45:alpha=1[pi];` +
        `[v3][pi]overlay=${(W - layout.image.w) / 2}:${slideIn(layout.image.y, duration + 0.55, 50)}:eval=frame:enable='gte(t,${duration.toFixed(2)})'[vout]`
      : "[v3]null[vout]",
    // Videomodellens ljud sänks när rösten pratar.
    // Ljudet från videomodellen tonas ut när bilden tar slut i stället för att tystna tvärt, och sänks när rösten pratar.
    `[${hasAudio ? 0 : silenceIndex}:a]asetpts=PTS-STARTPTS,atrim=0:${duration.toFixed(3)},afade=t=out:st=${Math.max(0, duration - 0.8).toFixed(2)}:d=0.8,volume=${voice ? 0.3 : 1},apad[a0]`,
    voice ? `[${voiceIndex}:a]${tempo > 1 ? `atempo=${tempo.toFixed(3)},` : ""}adelay=400:all=1,apad[a1]` : null,
    voice ? "[a0][a1]amix=inputs=2:duration=first:normalize=0[amix]" : "[a0]anull[amix]",
    // Ljudet tonas ut den sista sekunden i stället för att klippas av.
    `[amix]afade=t=out:st=${(total - 1).toFixed(2)}:d=1[aout]`,
  ].filter(Boolean);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]", "-t", total.toFixed(2),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-movflags", "+faststart", output,
  );
  const { code, stderr } = await run(args);
  fs.rmSync(assFile, { force: true });
  if (code !== 0) throw new Error(`ffmpeg misslyckades: ${stderr.slice(-400)}`);
  await verifyAd(output, { duration, total, price, infoBar });
  return { seconds: total };
}

/**
 * Provklipper en liten testfilm när servern startar, så att kontrollsidan visar direkt om klipparen
 * (ffmpeg, typsnitt, logga) inte fungerar, i stället för att det märks först på en betald video.
 */
export async function selfCheck(dir) {
  const input = path.join(dir, ".selfcheck-in.mp4");
  const output = path.join(dir, ".selfcheck-out.mp4");
  try {
    const made = await run(["-y", "-f", "lavfi", "-i", "testsrc=s=360x640:d=1:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", input]);
    if (made.code !== 0) throw new Error(`ffmpeg fungerar inte: ${made.stderr.slice(-300)}`);
    await editVideo({
      input, output, price: "199 kr",
      overlays: [{ from: 0, to: 1, text: "Test" }],
      endCard: { headline: "Test", features: ["Test"], offer_lines: ["Test"], cta: "Test" }, infoBar: "Test",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(input, { force: true });
    fs.rmSync(output, { force: true });
  }
}
