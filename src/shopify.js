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
