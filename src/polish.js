// Redigeringsagenten: ger videon en sista touch innan den visas för godkännande. Helt gratis, bara ffmpeg på servern.
// Bilden: tar bort flimmer och brus (AI-video brusar ofta), skalar upp mjukt till 720×1280 så att kanterna blir jämna,
// skärper lagom och ger lite friskare färger. Görs på filmen från Higgsfield innan text och slutbild läggs på,
// så att text, logga och butikens gröna färg inte ändras. Ljudet: jämnar ut ljudnivån på den färdiga annonsen
// till samma nivå som TikTok, Instagram och Facebook använder (−14 LUFS), så att rösten varken är för svag eller skär.
import fs from "node:fs";
import { run, probe } from "./editor.js";
import { getSetting } from "./db.js";

// Ordningen spelar roll: först städa bilden, sedan skala upp, sist skärpa och färg (annars förstärks bruset).
export const LOOK = [
  "deflicker=mode=pm:size=5", // jämnar ut ljusskiftningar mellan bildrutorna
  "hqdn3d=1.5:1.5:6:6", // tar bort brus och korn, mest det som hoppar mellan bildrutor
  "scale=720:1280:force_original_aspect_ratio=increase:flags=lanczos", // mjuk uppskalning ger jämna kanter
  "crop=720:1280",
  "setsar=1",
  "cas=strength=0.55", // skärper detaljer utan vita kanter runt saker
  "eq=contrast=1.05:brightness=0.01:saturation=1.04", // lite mer kontrast och ljus
  "vibrance=intensity=0.15", // lyfter matta färger mer än de som redan är starka, så att huden inte blir orange
  "format=yuv420p",
].join(",");

/** Om redigeringsagenten är på (bocken på kontrollsidan). På från början. */
export const polishEnabled = () => getSetting("polish", true);

/** Ger bilden den sista touchen. Ljudet följer med oförändrat. */
export async function polishLook(input, output) {
  const { code, stderr } = await run([
    "-y", "-i", input, "-map", "0:v:0", "-map", "0:a?", "-vf", LOOK,
    // Hög kvalitet här, eftersom klipparen kodar om videon en gång till.
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-c:a", "copy", output,
  ]);
  if (code !== 0) throw new Error(`Bilden kunde inte putsas: ${stderr.slice(-300)}`);
}

/** Jämnar ut ljudnivån i den färdiga annonsen. Bilden kopieras som den är. Byter ut filen. */
export async function polishSound(file) {
  if (!(await probe(file)).hasAudio) return;
  const tmp = `${file}.sound.mp4`;
  const { code, stderr } = await run([
    "-y", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", tmp,
  ]);
  if (code !== 0) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Ljudet kunde inte jämnas ut: ${stderr.slice(-300)}`);
  }
  fs.renameSync(tmp, file);
}
