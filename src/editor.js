// Klipparen: lägger på det som videomodellen inte kan göra själv, med ffmpeg på servern (gratis).
// Butikens namn och logga, priset, text i bild, en slutbild med pris och erbjudanden, och berättarrösten.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || "ffmpeg";
const ASSETS = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../assets");
const W = 720;
const H = 1280;
const STORE_DOMAIN = new URL(process.env.SHOPIFY_STORE_URL || "https://vardagshoppen.com").host.replace(/^www\./, "");

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", ...args]);
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
  plain: { logo: { size: 220, y: 250 }, brand: 520, headline: 580, price: 790, offer: 900, cta: 1050, domain: 1125 },
  product: { logo: { size: 130, y: 70 }, brand: 245, headline: 290, image: { w: 480, h: 400, y: 430 }, price: 935, offer: 1030, cta: 1135, domain: 1200 },
};

function buildAss({ duration, total, overlays, price, endCard, layout }) {
  const t0 = duration;
  const L = layout;
  const line = (start, end, style, text, tags = "") => `Dialogue: 1,${assTime(start)},${assTime(end)},${style},,0,0,0,,${tags}${assText(text)}`;
  const events = [
    // Butiksnamnet bredvid loggan och priset uppe till höger, hela videon utom slutbilden.
    line(0, t0, "Brand", "Vardagshoppen", "{\\an4\\pos(130,78)}"),
    ...(price ? [line(1.5, t0, "Badge", price, "{\\an9\\pos(686,52)\\fad(200,0)}")] : []),
    ...overlays
      .filter((o) => o.text && o.to > o.from && o.from < t0)
      .map((o) => line(o.from, Math.min(o.to, t0), "Caption", o.text, "{\\fad(120,120)}")),
    // Slutbilden: grön bakgrund, loggan läggs ovanpå av ffmpeg.
    `Dialogue: 0,${assTime(t0)},${assTime(total)},Box,,0,0,0,,{\\an7\\pos(0,0)\\fad(250,0)\\p1}m 0 0 l ${W} 0 ${W} ${H} 0 ${H}{\\p0}`,
    line(t0, total, "EndBrand", "Vardagshoppen", `{\\an5\\pos(360,${L.brand})\\fad(250,0)}`),
    ...(endCard.headline ? [line(t0, total, "EndText", endCard.headline, `{\\an8\\pos(360,${L.headline})\\fad(250,0)}`)] : []),
    ...(price ? [line(t0 + 0.3, total, "EndPrice", price, `{\\an5\\pos(360,${L.price})\\fad(200,0)}`)] : []),
    ...(endCard.offer_lines ?? []).slice(0, 2).map((t, i) => line(t0 + 0.6, total, "EndOffer", t, `{\\an5\\pos(360,${L.offer + i * 56})\\fad(200,0)}`)),
    ...(endCard.cta ? [line(t0 + 0.9, total, "EndOffer", endCard.cta, `{\\an5\\pos(360,${L.cta})\\fad(200,0)}`)] : []),
    line(t0 + 0.9, total, "EndCta", STORE_DOMAIN, `{\\an5\\pos(360,${L.domain})\\fad(200,0)}`),
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
Style: EndBrand,Inter Display,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: EndText,Inter,42,${OFFWHITE},${OFFWHITE},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,60,60,0,1
Style: EndPrice,Inter Display,132,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1
Style: EndOffer,Inter,38,${OFFWHITE},${OFFWHITE},&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,40,40,0,1
Style: EndCta,Inter Display,40,${GREEN},${GREEN},&H00FFFFFF,&H00000000,1,0,0,0,100,100,0,0,3,16,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
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
 * @param {string} [o.productImage] produktbilden, visas i slutbilden så att man ser vad vi säljer
 */
export async function editVideo({ input, output, overlays = [], price = "", endCard = {}, voiceFile, productImage }) {
  const { duration, hasAudio } = await probe(input);
  const voice = voiceFile ? await probe(voiceFile) : null;
  // Slutbilden står kvar 3 s, längre om rösten behöver det (högst 6 s).
  const endSeconds = Math.min(6, Math.max(3, (voice?.duration ?? 0) + 0.9 - duration));
  const total = duration + endSeconds;

  const assFile = `${output}.ass`;
  const layout = productImage ? LAYOUT.product : LAYOUT.plain;
  fs.writeFileSync(assFile, buildAss({ duration, total, overlays, price, endCard, layout }));

  const args = ["-y", "-i", input, "-loop", "1", "-i", path.join(ASSETS, "logo.png")];
  let next = 2;
  const imageIndex = productImage ? next++ : -1;
  if (productImage) args.push("-loop", "1", "-i", productImage);
  const voiceIndex = voice ? next++ : -1;
  if (voice) args.push("-i", voiceFile);
  const silenceIndex = hasAudio ? -1 : next++;
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");

  const filters = [
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${endSeconds.toFixed(2)}[v0]`,
    "[1:v]split=2[l1][l2]", "[l1]scale=84:84[ls]", `[l2]scale=${layout.logo.size}:${layout.logo.size}[lb]`,
    `[v0][ls]overlay=28:36[v1]`,
    `[v1]subtitles=filename=${assFile}:fontsdir=${path.join(ASSETS, "fonts")}[v2]`,
    `[v2][lb]overlay=${(W - layout.logo.size) / 2}:${layout.logo.y}:enable='gte(t,${duration.toFixed(2)})'[v3]`,
    // Produktbilden på ett vitt kort mitt i slutbilden.
    productImage
      ? `[${imageIndex}:v]scale=${layout.image.w - 40}:${layout.image.h - 40}:force_original_aspect_ratio=decrease,pad=${layout.image.w}:${layout.image.h}:(ow-iw)/2:(oh-ih)/2:white,setsar=1[pi];` +
        `[v3][pi]overlay=${(W - layout.image.w) / 2}:${layout.image.y}:enable='gte(t,${duration.toFixed(2)})'[vout]`
      : "[v3]null[vout]",
    // Videomodellens ljud sänks när rösten pratar.
    `[${hasAudio ? 0 : silenceIndex}:a]volume=${voice ? 0.25 : 1},apad[a0]`,
    voice ? `[${voiceIndex}:a]adelay=400:all=1,apad[a1]` : null,
    voice ? "[a0][a1]amix=inputs=2:duration=first:normalize=0[aout]" : "[a0]anull[aout]",
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
      endCard: { headline: "Test", offer_lines: ["Test"], cta: "Test" },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    fs.rmSync(input, { force: true });
    fs.rmSync(output, { force: true });
  }
}
