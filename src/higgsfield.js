// Videoverktyget: Higgsfield API (betalas per video). https://docs.higgsfield.ai
import { getSetting } from "./db.js";

const API = process.env.HIGGSFIELD_API_URL || "https://api.higgsfield.ai";

// Videomodellerna som tar produktbilder som referens. Ungefärligt pris för en 10 s video i 720p enligt
// open.higgsfield.ai/pricing (oktober 2026, med Higgsfields rabatt). Ägaren väljer modell på kontrollsidan.
export const VIDEO_MODELS = {
  "alibaba/wan-3.0/reference-to-video": { name: "Wan 3.0", sek: 3, note: "Billigast. Bra för vanliga scener." },
  "alibaba/wan-3.0-prime/reference-to-video": { name: "Wan 3.0 Prime", sek: 4, note: "Wan i högre kvalitet, skarpare detaljer." },
  "bytedance/seedance-2.0/reference-to-video": { name: "Seedance 2.0", sek: 20, note: "Dyrast. Starkast på att följa referensbilder och rörelser." },
};
export const DEFAULT_VIDEO_MODEL = process.env.HIGGSFIELD_MODEL || "alibaba/wan-3.0/reference-to-video";
export const videoModel = () => {
  const chosen = getSetting("video_model", DEFAULT_VIDEO_MODEL);
  return VIDEO_MODELS[chosen] ? chosen : DEFAULT_VIDEO_MODEL;
};
export const videoModelSek = () => VIDEO_MODELS[videoModel()]?.sek ?? 3;

// Nyckeln kan anges som en enda sträng (HF_API_KEY, t.ex. "id:hemlighet") eller som två delar.
function credentials() {
  if (process.env.HF_API_KEY) return process.env.HF_API_KEY.trim();
  const id = process.env.HF_API_KEY_ID;
  const secret = process.env.HF_API_KEY_SECRET;
  return id && secret ? `${id}:${secret}` : null;
}

function authHeader() {
  const key = credentials();
  if (!key) throw new Error("HF_API_KEY saknas i Railway");
  return `Key ${key}`;
}

export const higgsfieldConfigured = () => Boolean(credentials());

/** Startar en video. Produktbilderna (högst 4) skickas med så att videon visar den riktiga produkten. */
export async function startVideo({ prompt, imageUrls = [], idempotencyKey }) {
  const res = await fetch(`${API}/${videoModel()}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls.length ? imageUrls.slice(0, 4) : undefined,
      duration: Number(process.env.VIDEO_SECONDS || 10),
      resolution: process.env.VIDEO_RESOLUTION || "720p",
      aspect_ratio: "9:16",
      generate_audio: true,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Higgsfield svarade ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body.request_id;
}

/** Returnerar { status, videoUrl?, error? }. status: waiting | completed | failed */
export async function checkVideo(requestId) {
  const res = await fetch(`${API}/requests/${requestId}/status`, { headers: { Authorization: authHeader() } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Higgsfield status ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  if (body.status === "completed") return { status: "completed", videoUrl: body.video?.url };
  if (["queued", "in_progress", "processing", "pending"].includes(body.status)) return { status: "waiting" };
  return { status: "failed", error: `Higgsfield: ${body.status} ${body.error ?? ""}`.trim() };
}
