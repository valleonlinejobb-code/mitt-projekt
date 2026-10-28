// TikTok via Content Posting API.
// Kräver: TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REFRESH_TOKEN.
// Tills TikTok har granskat appen går det bara att lägga upp privat (TIKTOK_PRIVACY=SELF_ONLY).
// TikTok har inget API för att svara på kommentarer, så det sköts manuellt från kontrollsidan.
import fs from "node:fs";
import { getSetting, setSetting } from "../db.js";

const API = "https://open.tiktokapis.com/v2";

export const tiktokConfigured = () =>
  Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET && process.env.TIKTOK_REFRESH_TOKEN);

async function accessToken() {
  const saved = getSetting("tiktok_token", null);
  if (saved && saved.expiresAt > Date.now() + 60_000) return saved.accessToken;

  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: saved?.refreshToken || process.env.TIKTOK_REFRESH_TOKEN,
    }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`TikTok-inloggning: ${body.error_description || body.error || res.status}`);
  setSetting("tiktok_token", {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  });
  return body.access_token;
}

/** Laddar upp en videofil från disk. Returnerar TikToks publish_id. */
export async function publishTikTokVideo(filePath, title) {
  const token = await accessToken();
  const size = fs.statSync(filePath).size;
  const init = await fetch(`${API}/post/publish/video/init/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: { title: title.slice(0, 2200), privacy_level: process.env.TIKTOK_PRIVACY || "SELF_ONLY" },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
    }),
  });
  const body = await init.json();
  if (!init.ok || (body.error && body.error.code !== "ok")) {
    throw new Error(`TikTok: ${body.error?.message || init.status}`);
  }
  const upload = await fetch(body.data.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: fs.readFileSync(filePath),
  });
  if (!upload.ok) throw new Error(`TikTok-uppladdning misslyckades (${upload.status})`);
  return body.data.publish_id;
}
