// Resultat: hämtar hur våra publicerade videor har gått (gratis) så att promptagenten kan lära sig vad som fungerar.
import { db, now, log } from "../db.js";
import * as meta from "../channels/meta.js";

const REFRESH_HOURS = 6;
const fetchers = { facebook: meta.fetchFacebookVideoStats, instagram: meta.fetchInstagramReelStats };
const configured = { facebook: meta.facebookConfigured, instagram: meta.instagramConfigured };

/** Uppdaterar siffrorna för inlägg från de senaste 30 dagarna. Fel stoppar aldrig videon. */
export async function refreshStats(productId) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const stale = new Date(Date.now() - REFRESH_HOURS * 3_600_000).toISOString();
  const posts = db.prepare(`
    SELECT p.* FROM posts p JOIN videos v ON v.id = p.video_id
    WHERE v.product_id = ? AND p.status = 'posted' AND p.external_id IS NOT NULL
      AND p.channel IN ('facebook', 'instagram') AND p.created_at > ? AND (p.stats_at IS NULL OR p.stats_at < ?)`).all(productId, since, stale);
  for (const post of posts) {
    if (!configured[post.channel]()) continue;
    try {
      const stats = await fetchers[post.channel](post.external_id);
      db.prepare("UPDATE posts SET stats = ?, stats_at = ? WHERE id = ?").run(JSON.stringify(stats), now(), post.id);
    } catch (err) {
      db.prepare("UPDATE posts SET stats_at = ? WHERE id = ?").run(now(), post.id);
      log(productId, "prompt", `Kunde inte hämta resultat för ${post.channel}-inlägget till video #${post.video_id}: ${err.message}`);
    }
  }
}

const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "–");

/** Kort text om ett inlägg, t.ex. "1 200 visade · krokgrad 34 % · 41 % tittade klart · snitt 6,2 s". */
export function statsText(stats) {
  if (!stats) return "";
  const parts = [`${stats.impressions.toLocaleString("sv-SE").replace(/\s/g, " ")} visade`];
  if (stats.impressions) parts.push(`krokgrad ${pct(stats.views, stats.impressions)}`);
  if (stats.completeViews != null && stats.views) parts.push(`${pct(stats.completeViews, stats.views)} tittade klart`);
  if (stats.avgSeconds) parts.push(`snitt ${stats.avgSeconds.toFixed(1).replace(".", ",")} s`);
  if (stats.shares != null) parts.push(`${stats.likes ?? 0} gilla · ${stats.comments ?? 0} komm. · ${stats.shares} delningar`);
  return parts.join(" · ");
}

/** Resultaten per video, bäst först. Vinnaren är den med högst krokgrad bland videor som visats minst 300 gånger. */
export function performance(productId) {
  const rows = db.prepare(`
    SELECT v.id, v.idea, p.channel, p.stats FROM posts p JOIN videos v ON v.id = p.video_id
    WHERE v.product_id = ? AND p.stats IS NOT NULL ORDER BY v.id DESC LIMIT 20`).all(productId)
    .map((r) => ({ ...r, stats: JSON.parse(r.stats) }));
  const hook = (s) => (s.impressions ? s.views / s.impressions : 0);
  const ranked = rows.filter((r) => r.stats.impressions >= 300).sort((a, b) => hook(b.stats) - hook(a.stats));
  return {
    winner: ranked[0] ?? null,
    text: rows.map((r) => `- Video #${r.id} på ${r.channel}: ${statsText(r.stats)} — ${r.idea}`).join("\n"),
  };
}
