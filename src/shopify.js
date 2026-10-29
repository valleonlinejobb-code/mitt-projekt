// Hämtar butikens produkter från Shopify (den öppna produktlistan, ingen nyckel behövs).
import { db, ensureAgents, log } from "./db.js";

const STORE_URL = (process.env.SHOPIFY_STORE_URL || "https://vardagshoppen.com").replace(/\/$/, "");

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", aring: "å", auml: "ä", ouml: "ö", Aring: "Å", Auml: "Ä", Ouml: "Ö", eacute: "é", ndash: "–", mdash: "—" };

const plainText = (html) => String(html || "")
  .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, "\n")
  .replace(/<[^>]+>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&(\w+);/g, (m, name) => ENTITIES[name] ?? m)
  .replace(/\n\s*\n+/g, "\n").trim()
  .slice(0, 2000);

/** Lägger till butikens produkter som inte finns än. Det du redan har skrivit om en produkt skrivs aldrig över. */
export async function importShopifyProducts() {
  const res = await fetch(`${STORE_URL}/products.json?limit=250`, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) throw new Error("Butiken är lösenordsskyddad, så produkterna går inte att hämta. Ta bort lösenordet i Shopify eller lägg till produkten själv.");
  if (!res.ok) throw new Error(`Kunde inte hämta produkterna från ${STORE_URL} (${res.status})`);
  const { products = [] } = await res.json();

  const existing = db.prepare("SELECT shopify_handle FROM products WHERE shopify_handle IS NOT NULL").all().map((p) => p.shopify_handle);
  const insert = db.prepare(
    "INSERT INTO products (name, description, price, image_url, shop_url, audience, shopify_handle) VALUES (?, ?, ?, ?, ?, '', ?)"
  );
  const added = [];
  for (const p of products) {
    if (existing.includes(p.handle)) continue;
    const price = Math.min(...(p.variants || []).map((v) => Number(v.price)).filter((n) => n > 0));
    const { lastInsertRowid } = insert.run(
      p.title,
      plainText(p.body_html) || p.title,
      Number.isFinite(price) ? `${Math.round(price)} kr` : "",
      p.images?.[0]?.src || "",
      `${STORE_URL}/products/${p.handle}`,
      p.handle,
    );
    ensureAgents(Number(lastInsertRowid));
    added.push(p.title);
  }
  log(null, "shopify", added.length ? `Nya produkter från butiken: ${added.join(", ")}` : "Inga nya produkter i butiken.");
  return { added, total: products.length };
}

/**
 * Alla produktens bilder från butiken (huvudbilden först, högst 4), så att videomodellen ser produkten från flera håll,
 * t.ex. koppen, borsten inuti och handduken. Går de inte att hämta används bara huvudbilden.
 */
export async function productImageUrls(product, mainUrl) {
  const urls = mainUrl ? [mainUrl] : [];
  if (!product.shopify_handle) return urls;
  try {
    const res = await fetch(`${STORE_URL}/products/${product.shopify_handle}.json`);
    if (!res.ok) return urls;
    const images = (await res.json()).product?.images ?? [];
    for (const { src } of images) {
      if (urls.length >= 4) break;
      if (src && !urls.some((u) => u.split("?")[0] === src.split("?")[0])) urls.push(src);
    }
  } catch { /* huvudbilden räcker */ }
  return urls;
}

/**
 * Kollar att produktbilden går att hämta innan agenterna lägger pengar på en video.
 * Har bilden bytts i Shopify (den gamla länken ger fel) hämtas den nya bilden från butiken och sparas.
 */
export async function workingProductImage(product) {
  if (!product.image_url) return "";
  const reachable = async (url) => (await fetch(url, { method: "HEAD" }).catch(() => null))?.ok;
  if (await reachable(product.image_url)) return product.image_url;
  if (product.shopify_handle) {
    const res = await fetch(`${STORE_URL}/products/${product.shopify_handle}.json`).catch(() => null);
    const src = res?.ok ? (await res.json()).product?.image?.src : null;
    if (src && await reachable(src)) {
      db.prepare("UPDATE products SET image_url = ? WHERE id = ?").run(src, product.id);
      log(product.id, "prompt", "Produktbilden hade bytts i butiken. Den nya bilden används nu.");
      return src;
    }
  }
  throw new Error(`Produktbilden går inte att hämta (${product.image_url}). Klistra in en fungerande bildlänk under "Produktinfo som agenterna använder".`);
}
