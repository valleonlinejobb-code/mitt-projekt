// Egna mobilfilmer: ägaren laddar upp en film, och klippagenten lägger på text i bild, berättarröst, logga, pris och slutbild.
// Äkta film av en riktig hund slår ofta AI-video. En film kostar bara ett anrop till Claude (ca 1 kr), ingen Higgsfield.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, log, currentOffers, MEDIA_DIR } from "../db.js";
import { askClaude } from "../claude.js";
import { newRun } from "../costs.js";
import { extractFrames, probe } from "../editor.js";
import { HOOK_TYPES, claimProblems, editAndOffer, INFO_BAR, END_CARD } from "./prompt.js";
import * as progress from "../progress.js";

export const MAX_CLIP_SECONDS = 90;
const REFERENCE = fs.readFileSync(new URL("./reference-ad.md", import.meta.url), "utf8");

const CLIP_PLAN = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "hook_type", "audience", "overlays", "voiceover", "info_bar", "end_card", "captions"],
  properties: {
    idea: { type: "string", description: "Kort beskrivning på svenska av vad filmen visar och vinkeln i annonsen" },
    hook_type: { type: "string", enum: HOOK_TYPES },
    audience: { type: "string", description: "Vem annonsen riktar sig till (identitetsordet)" },
    overlays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "text"],
        properties: { from: { type: "number" }, to: { type: "number" }, text: { type: "string" } },
      },
    },
    voiceover: { type: "string" },
    info_bar: INFO_BAR,
    end_card: END_CARD,
    captions: {
      type: "object",
      additionalProperties: false,
      required: ["instagram", "facebook", "tiktok"],
      properties: { instagram: { type: "string" }, facebook: { type: "string" }, tiktok: { type: "string" } },
    },
  },
};

/** Sparar en uppladdad film. Den bearbetas av schemaläggaren inom en minut. Returnerar videons nummer. */
export async function addClip(productId, buffer, note = "") {
  const name = crypto.randomBytes(12).toString("hex");
  const rawFile = `${name}-clip.mp4`;
  const full = path.join(MEDIA_DIR, rawFile);
  fs.writeFileSync(full, buffer);
  let info;
  try {
    info = await probe(full);
  } catch {
    fs.rmSync(full, { force: true });
    throw new Error("Filen gick inte att läsa som video. Ladda upp en vanlig mobilfilm (mp4 eller mov).");
  }
  if (info.duration < 2 || info.duration > MAX_CLIP_SECONDS) {
    fs.rmSync(full, { force: true });
    throw new Error(`Filmen är ${Math.round(info.duration)} sekunder. Den måste vara mellan 2 och ${MAX_CLIP_SECONDS} sekunder.`);
  }
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO videos (product_id, created_at, status, idea, raw_file, edit, source) VALUES (?, ?, 'editing', ?, ?, ?, 'clip')"
  ).run(productId, now(), `Egen film${note ? `: ${note}` : ""} (bearbetas…)`, rawFile, JSON.stringify({ note: String(note).slice(0, 500) }));
  log(productId, "prompt", `Egen film #${lastInsertRowid} uppladdad (${Math.round(info.duration)} s). Klippagenten lägger på text, röst och logga.`);
  return Number(lastInsertRowid);
}

export const nextClip = () => db.prepare("SELECT * FROM videos WHERE status = 'editing' AND source = 'clip' ORDER BY id LIMIT 1").get();

/** Skriver text i bild, berättarröst, slutbild och texter för en egen film, och klipper ihop den. */
export async function processClip(video) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(video.product_id);
  try {
    progress.stage(product.id, "prompt", "edit", `Egen film #${video.id}`);
    const { note } = JSON.parse(video.edit || "{}");
    const { duration, frames } = await extractFrames(path.join(MEDIA_DIR, video.raw_file));
    const offers = currentOffers();
    const maxWords = Math.max(12, Math.min(40, Math.round(duration * 2.3)));
    let plan;
    let feedback = "";
    const cost = { agent: "prompt", task: "clip", run: newRun(), productId: product.id };
    for (let attempt = 1; attempt <= 2 && !plan; attempt++) {
      const draft = await askClaude({
        ...cost,
        schema: CLIP_PLAN,
        effort: "high",
        images: frames.map(({ data, media_type }) => ({ data, media_type })),
        system:
          "Du är klippagent för Vardagshoppen. Ägaren har filmat en egen mobilfilm, och du gör den till en annons genom att skriva text i bild, " +
          "berättarröst, slutbild och inläggstexter. Du ändrar inte filmen. Skriv bara om det som syns i bilderna, och hitta inte på något.\n\n" +
          REFERENCE,
        prompt: `Produkt: ${product.name}, pris ${product.price}
Beskrivning: ${product.description}
Målgrupp: ${product.audience}
Butik: Vardagshoppen (vardagshoppen.com), ett svenskt UF-företag.
Aktuella erbjudanden (de enda rabatterna som får nämnas): ${offers || "(inga)"}${product.focus ? `\nÄgarens instruktioner för produkten:\n${product.focus}` : ""}
${note ? `\nÄgarens anteckning om filmen: ${note}\n` : ""}
Filmen är ${duration.toFixed(1)} sekunder. Bilderna ovan är tagna vid ${frames.map((f) => `${f.at.toFixed(1)} s`).join(", ")}.

Skriv:
- overlays: 2–4 korta texter (1–5 ord) med tider mellan 0 och ${duration.toFixed(1)} s som passar det som syns just då. Den första ska fånga på 2 sekunder.
- voiceover: en lugn svensk kvinnoröst, högst ${maxWords} ord. Den säger problemet, lösningen, priset och erbjudandet med exakt kod, och avslutar med vardagshoppen.com.
- info_bar: produktraden längst ner under hela filmen, högst 40 tecken, t.ex. "Tasstvättkit · kopp + handduk · ${product.price}".
- end_card: rubrik (samma löfte som produktsidan, högst 6 ord), 2–3 korta fördelar ur produktinfon (features, högst 3 ord var), 0–2 rader med erbjudandena och en kort uppmaning utan webbadress.
- captions: inläggstexter för Instagram, Facebook och TikTok på svenska som slutar med uppmaning, pris och erbjudande.
Bara priset ${product.price} och erbjudandena ovan får nämnas. Inga andra siffror om de inte står i produktinfon.
${feedback ? `\nRätta det här från förra försöket:\n${feedback}` : ""}`,
      });
      const problems = claimProblems(draft, product, offers, maxWords);
      if (problems.length) {
        log(product.id, "prompt", `Egen film #${video.id}: faktakollen hittade ${problems.join(" ")}`);
        feedback = problems.join("\n");
      } else plan = draft;
    }
    if (!plan) throw new Error("Texterna klarade inte faktakollen två gånger. Filmen är inte bearbetad.");

    const edit = { note, overlays: plan.overlays, voiceover: plan.voiceover, info_bar: plan.info_bar, end_card: plan.end_card };
    const idea = `Egen film: ${plan.idea} · Krok: ${plan.hook_type} · För: ${plan.audience} · Text i bild: ${plan.overlays.map((o) => o.text).join(" / ")} · Röst: "${plan.voiceover}"`;
    db.prepare("UPDATE videos SET idea = ?, edit = ?, captions = ?, hook_type = ? WHERE id = ?")
      .run(idea, JSON.stringify(edit), JSON.stringify(plan.captions), plan.hook_type, video.id);
    // Klipps som AI-videorna: utan text och slutbild visas filmen inte för godkännande.
    await editAndOffer(db.prepare("SELECT * FROM videos WHERE id = ?").get(video.id));
  } catch (err) {
    // Markeras som misslyckad så att den inte försöks igen varje minut (och kostar pengar varje gång).
    db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?").run(err.message, video.id);
    throw err;
  }
}
