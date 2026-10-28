// Videoverktyget: Higgsfield API (betalas per video). https://docs.higgsfield.ai
const API = process.env.HIGGSFIELD_API_URL || "https://api.higgsfield.ai";
const MODEL = process.env.HIGGSFIELD_MODEL || "alibaba/wan-3.0/reference-to-video";

function authHeader() {
  const id = process.env.HF_API_KEY_ID;
  const secret = process.env.HF_API_KEY_SECRET;
  if (!id || !secret) throw new Error("HF_API_KEY_ID och HF_API_KEY_SECRET saknas i Railway");
  return `Key ${id}:${secret}`;
}

export const higgsfieldConfigured = () => Boolean(process.env.HF_API_KEY_ID && process.env.HF_API_KEY_SECRET);

/** Startar en video. Produktbilden skickas med så att videon visar den riktiga produkten. */
export async function startVideo({ prompt, imageUrl, idempotencyKey }) {
  const res = await fetch(`${API}/${MODEL}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrl ? [imageUrl] : undefined,
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
