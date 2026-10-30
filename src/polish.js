// Redigeringsagenten: ger videon en sista touch innan den visas för godkännande. Helt gratis, bara ffmpeg på servern.
// Bilden: tar bort flimmer och brus (AI-video brusar ofta), skalar upp mjukt till 720×1280 så att kanterna blir jämna,
// skärper lagom och ger lite friskare färger. Görs på filmen från Higgsfield innan text och slutbild läggs på,
// så att text, logga och butikens gröna färg inte ändras. Ljudet: jämnar ut ljudnivån på den färdiga annonsen
// till samma nivå som TikTok, Instagram och Facebook använder (−14 LUFS), så att rösten varken är för svag eller skär.
import fs from "node:fs";
import { run, probe } from "./editor.js";
import { getSetting } from "./db.js";

// Tipsen från en videoredigerare som redigeringsagenten följer (allt gratis, ffmpeg):
// 1. Rena bilder: ta bort flimmer och brus före allt annat, annars förstärks de av skärpan.
// 2. Rörelse hela tiden: en långsam inzoomning (6 % över hela filmen) gör att det känns filmat med kamera och håller kvar blicken.
// 3. Lagom skärpa och friskare färger, men inte så mycket att det ser filtrerat ut.
// 4. Rösten först: skär bort muller, jämna ut rösten (kompressor) och lyft tydligheten runt 3 kHz.
// 5. Ljud på övergången: ett mjukt "whoosh" när slutbilden sveper in gör att klippet känns redigerat.
// 6. Samma ljudnivå som apparna (−14 LUFS), så att videon varken är tyst eller skär i öronen.

/** Bildkedjan. Ordningen spelar roll: först städa bilden, sedan skala och zooma, sist skärpa och färg. */
export function look(seconds) {
  return [
    "deflicker=mode=pm:size=5", // jämnar ut ljusskiftningar mellan bildrutorna
    "hqdn3d=1.5:1.5:6:6", // tar bort brus och korn, mest det som hoppar mellan bildrutor
    "scale=720:1280:force_original_aspect_ratio=increase:flags=lanczos", // mjuk uppskalning ger jämna kanter
    "crop=720:1280",
    // Långsam inzoomning mot mitten, från 100 % till 106 % över hela filmen.
    `scale=w='2*trunc(360*(1+0.06*t/${Math.max(1, seconds).toFixed(2)}))':h=-2:eval=frame:flags=lanczos`,
    "crop=720:1280",
    "setsar=1",
    "cas=strength=0.55", // skärper detaljer utan vita kanter runt saker
    "eq=contrast=1.05:brightness=0.01:saturation=1.04", // lite mer kontrast och ljus
    "vibrance=intensity=0.15", // lyfter matta färger mer än de som redan är starka, så att huden inte blir orange
    "format=yuv420p",
  ].join(",");
}

/** Om redigeringsagenten är på (bocken på kontrollsidan). På från början. */
export const polishEnabled = () => getSetting("polish", true);

/** Ger bilden den sista touchen. Ljudet följer med oförändrat. Returnerar filmens längd (där slutbilden börjar). */
export async function polishLook(input, output) {
  const { duration } = await probe(input);
  const { code, stderr } = await run([
    "-y", "-i", input, "-map", "0:v:0", "-map", "0:a?", "-vf", look(duration),
    // Hög kvalitet här, eftersom klipparen kodar om videon en gång till.
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-c:a", "copy", output,
  ]);
  if (code !== 0) throw new Error(`Bilden kunde inte putsas: ${stderr.slice(-300)}`);
  return { duration };
}

// Rösten: bort med muller under 80 Hz, en mjuk kompressor så att svaga ord hörs, och lite mer tydlighet runt 3 kHz.
const VOICE_CHAIN = "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2,equalizer=f=3000:t=q:w=1.2:g=2.5";

/**
 * Ljudet i den färdiga annonsen: rösten putsas, ett mjukt whoosh läggs där slutbilden sveper in (transitionAt, sekunder),
 * och allt jämnas ut till −14 LUFS. Bilden kopieras som den är. Byter ut filen.
 */
export async function polishSound(file, { transitionAt } = {}) {
  if (!(await probe(file)).hasAudio) return;
  const tmp = `${file}.sound.mp4`;
  const whoosh = transitionAt > 0;
  const at = Math.max(0, Math.round((transitionAt - 0.25) * 1000));
  const filters = whoosh
    ? [
        `[0:a:0]${VOICE_CHAIN}[v]`,
        // Rosa brus genom ett bandpass, tonat in och ut: låter som en snabb luftsvepning.
        `anoisesrc=d=0.6:c=pink:r=44100:a=0.6,bandpass=f=1400:width_type=h:w=1800,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.3,volume=0.5,adelay=${at}:all=1,aformat=channel_layouts=stereo[w]`,
        "[v][w]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]",
      ].join(";")
    : `[0:a:0]${VOICE_CHAIN},loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
  const { code, stderr } = await run([
    "-y", "-i", file, "-filter_complex", filters, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", tmp,
  ]);
  if (code !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Ljudet kunde inte putsas: ${stderr.slice(-300)}`);
  }
  fs.renameSync(tmp, file);
}
