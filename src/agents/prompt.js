// Promptagenten: skriver videoprompt + texter, beställer videon och väntar in den.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, log, stockholmDate, getSetting, setSetting, MEDIA_DIR } from "../db.js";
import { askClaude } from "../claude.js";
import { startVideo, checkVideo, higgsfieldConfigured } from "../higgsfield.js";
import { latestResearch } from "./research.js";

const MAX_PER_MONTH = Number(process.env.MAX_VIDEOS_PER_MONTH || 35);

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["idea", "video_prompt", "captions"],
  properties: {
    idea: { type: "string", description: "Kort beskrivning av idén på svenska" },
    video_prompt: { type: "string", description: "Prompt till videomodellen, på engelska" },
    captions: {
      type: "object",
      additionalProperties: false,
      required: ["instagram", "facebook", "tiktok"],
      properties: {
        instagram: { type: "string" },
        facebook: { type: "string" },
        tiktok: { type: "string" },
      },
    },
  },
};

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

  log(product.id, "prompt", "Skriver videoprompt…");
  const plan = await askClaude({
    schema: SCHEMA,
    effort: "medium",
    system:
      "Du är promptagent för Agent UF. Du gör en kort, stående (9:16) reklamvideo på 10 sekunder. " +
      "Produktbilden skickas med till videomodellen, så produkten ska se ut exakt som på bilden. " +
      "Videoprompten skrivs på engelska och beskriver scen, kamerarörelse, ljus och vad som händer sekund för sekund. " +
      "Ingen text i bild. Texterna till inläggen skrivs på svenska, är korta, har en tydlig uppmaning att köpa i butiken " +
      "och passar varje plattform (TikTok: kort och lekfull med 3–5 hashtags; Instagram: lite längre med hashtags; Facebook: vänlig utan många hashtags).",
    prompt: `Produkt: ${product.name}, pris ${product.price}
Beskrivning: ${product.description}
Målgrupp: ${product.audience}
Butik: ${product.shop_url}

Research från researchagenten:
${research?.notes ?? "(ingen research än – använd beprövade grepp: problem–lösning, före/efter)"}

Tidigare idéer (upprepa inte; "rejected" betyder att ägaren inte gillade den):
${earlier.map((e) => `- [${e.status}] ${e.idea}`).join("\n") || "(inga)"}`,
  });

  const { lastInsertRowid } = db.prepare(
    "INSERT INTO videos (product_id, created_at, status, idea, prompt, captions) VALUES (?, ?, 'generating', ?, ?, ?)"
  ).run(product.id, now(), plan.idea, plan.video_prompt, JSON.stringify(plan.captions));
  const videoId = Number(lastInsertRowid);

  try {
    const requestId = await startVideo({
      prompt: plan.video_prompt, imageUrl: product.image_url, idempotencyKey: `agent-uf-video-${videoId}`,
    });
    db.prepare("UPDATE videos SET hf_request_id = ? WHERE id = ?").run(requestId, videoId);
    log(product.id, "prompt", `Video #${videoId} beställd: ${plan.idea}`);
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
