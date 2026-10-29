// Databas (SQLite-fil). På Railway ska DATA_DIR peka på en volym så att datan överlever omstarter.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR || "./data";
export const MEDIA_DIR = path.join(DATA_DIR, "media");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "agent-uf.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price TEXT NOT NULL,
  image_url TEXT,
  shop_url TEXT,
  audience TEXT
);
CREATE TABLE IF NOT EXISTS agents (
  product_id INTEGER NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  running INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_error TEXT,
  PRIMARY KEY (product_id, kind)
);
CREATE TABLE IF NOT EXISTS research (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  notes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL,          -- generating | pending | approved | rejected | failed
  idea TEXT,
  prompt TEXT,
  captions TEXT,                 -- JSON {instagram, facebook, tiktok}
  hf_request_id TEXT,
  video_url TEXT,
  local_file TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  video_id INTEGER NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,          -- publishing | posted | manual | failed
  external_id TEXT,
  created_at TEXT NOT NULL,
  error TEXT,
  UNIQUE (video_id, channel)
);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  kind TEXT NOT NULL,            -- comment | dm
  external_id TEXT NOT NULL UNIQUE,
  reply_to TEXT NOT NULL,        -- kommentar-id eller avsändar-id
  author TEXT,
  text TEXT NOT NULL,
  draft TEXT,
  needs_human INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,          -- drafted | sent | ignored | failed
  created_at TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
-- Vad varje Claude-anrop faktiskt kostade, räknat från svaret (tokens och webbsökningar).
-- run: alla anrop i samma jobb (en research, en video, en egen film) har samma run, så att jobbets totala kostnad syns.
CREATE TABLE IF NOT EXISTS costs (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  product_id INTEGER,
  agent TEXT NOT NULL,
  task TEXT NOT NULL,            -- research | video | clip | reply
  run TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  searches INTEGER NOT NULL,
  usd REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  product_id INTEGER,
  agent TEXT,
  message TEXT NOT NULL
);
`);

export const AGENT_KINDS = ["research", "prompt", "instagram", "facebook", "tiktok"];
export const CHANNELS = ["instagram", "facebook", "tiktok"];

export const now = () => new Date().toISOString();

// "Idag" räknas i svensk tid.
export function stockholmDate(iso = now()) {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

export function log(productId, agent, message) {
  db.prepare("INSERT INTO log (at, product_id, agent, message) VALUES (?, ?, ?, ?)").run(now(), productId, agent, message);
  console.log(`[${agent}] ${message}`);
}

export function getSetting(key, fallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}

// Nya kolumner läggs till i en befintlig databas.
const productColumns = db.prepare("PRAGMA table_info(products)").all().map((c) => c.name);
if (!productColumns.includes("shopify_handle")) db.exec("ALTER TABLE products ADD COLUMN shopify_handle TEXT");
if (!productColumns.includes("focus")) db.exec("ALTER TABLE products ADD COLUMN focus TEXT NOT NULL DEFAULT ''");
const videoColumns = db.prepare("PRAGMA table_info(videos)").all().map((c) => c.name);
// edit: JSON med text i bild, slutbild och berättarröst som klipparen lägger på. raw_file: videon som den kom från Higgsfield.
if (!videoColumns.includes("edit")) db.exec("ALTER TABLE videos ADD COLUMN edit TEXT");
if (!videoColumns.includes("raw_file")) db.exec("ALTER TABLE videos ADD COLUMN raw_file TEXT");
// hook_type/variant_of/ab_group: vilken sorts krok, vilken video den är en variant av och vilket A/B-test den hör till.
// source: 'ai' (Higgsfield) eller 'clip' (ägarens egen mobilfilm). channels: JSON-lista med kanalerna den får läggas upp på (NULL = alla).
for (const [column, type] of [["hook_type", "TEXT"], ["variant_of", "INTEGER"], ["ab_group", "TEXT"], ["source", "TEXT NOT NULL DEFAULT 'ai'"], ["channels", "TEXT"]]) {
  if (!videoColumns.includes(column)) db.exec(`ALTER TABLE videos ADD COLUMN ${column} ${type}`);
}
const postColumns = db.prepare("PRAGMA table_info(posts)").all().map((c) => c.name);
// stats: JSON med visningar, krokgrad m.m. från Meta. stats_at: när de hämtades senast.
if (!postColumns.includes("stats")) db.exec("ALTER TABLE posts ADD COLUMN stats TEXT");
if (!postColumns.includes("stats_at")) db.exec("ALTER TABLE posts ADD COLUMN stats_at TEXT");

// Det som bara gäller tasstvättkitet (förut inskrivet i agenternas kod).
const PAW_KIT_FOCUS = `Produkten är ett kit: tasstvätt (kopp med mjuka TPR-borst) plus mikrofiberhandduk med tassmönster.
Research: ta reda på hur kitet används bäst (rätt vattentemperatur och mängd, hur man för in och vrider tassen, hur handduken torkar mellan trampdynor och klor, hur man vänjer en ovan hund, rengöring av kopp och handduk, val av storlek) från tillverkare, veterinärer och djurbutiker.
Massagekänslan: de mjuka borsten känns som massage för hunden. Sök vad tillverkare, veterinärer och hundägare säger om det och skriv bara det som källorna stöder.
Video: prioritera videor som visar hur kitet används som bäst, i rätt ordning (doppa, vrid, torka med handduken). Visa massagekänslan lugnt (hunden slappnar av, njuter, kanske blundar) och säg det som en känsla ("som en mjuk tassmassage"). Påstå inga hälsoeffekter som inte finns under "Verifierade fakta".`;

// Butikens aktuella erbjudanden. Agenterna nämner bara rabatter som står här, så texten måste stämma med rabattkoderna i Shopify.
export const DEFAULT_OFFERS = "5 % rabatt på första köpet med koden VALKOMMEN5. De 10 första köpen får dessutom 10 % extra rabatt med koden FORSTA10.";
export const currentOffers = () => String(getSetting("offers", DEFAULT_OFFERS)).trim();

export function ensureAgents(productId) {
  const insert = db.prepare("INSERT OR IGNORE INTO agents (product_id, kind) VALUES (?, ?)");
  for (const kind of AGENT_KINDS) insert.run(productId, kind);
}

// Första produkten läggs in automatiskt.
if (!db.prepare("SELECT 1 FROM products LIMIT 1").get()) {
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO products (name, description, price, image_url, shop_url, audience, shopify_handle, focus) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    "Tasstvättkit",
    "Tasstvätt (kopp med mjuka TPR-borst) för små, mellanstora och stora hundar plus mikrofiberhandduk med tassmönster. Doppa tassen, vrid lätt, torka av – inga leriga tassar inne.",
    "199 kr",
    "https://cdn.shopify.com/s/files/1/1073/2290/0744/files/tasskit-med-handduk.jpg?v=1793199480",
    "https://frostskrapa.myshopify.com/products/tasstvattkit-sma-och-mellanstora-hundar",
    "Medelålders hundägare i Sverige med hundar i alla storlekar, särskilt under höst och vinter med lera, slask och grus.",
    "tasstvattkit-sma-och-mellanstora-hundar",
    PAW_KIT_FOCUS
  );
  ensureAgents(Number(lastInsertRowid));
}

// Befintliga databaser: tasstvättkitet behåller sina instruktioner och kopplas till sin Shopify-produkt.
db.prepare("UPDATE products SET focus = ? WHERE focus = '' AND shop_url LIKE '%/products/tasstvattkit-%'").run(PAW_KIT_FOCUS);

// Sant från butikens produktsida (2026-10-29). Förtroendesignaler som agenterna får använda, och leveransen som de inte får överdriva.
const PAW_KIT_SHOP_FACTS = `Fakta från butikens produktsida (sanna, får användas som förtroendesignaler):
- 14 dagars ångerrätt.
- Storleksgaranti: passar inte koppen byter vi till en annan storlek, så länge den finns i lager.
- Mikrofiberhandduk ingår i varje kit (grå, med broderad tass). Mjuka TPR-borst (inte silikon) och avtagbar borstinsats. Finns i S, M och L.
- Förbeställning: första leveransen väntas i början av december och skickas direkt när den har kommit. Lova aldrig snabb leverans eller "skickas idag". Den som beställer nu kan avbeställa innan paketet har skickats.
- Skickas med PostNord inom Sverige. Frakt 29 kr, fri frakt från 349 kr.
- I annonserna nämns bara priset 199 kr (Hallkit). Tvåpack och frakt hör till produktsidan.`;
db.prepare("UPDATE products SET focus = focus || char(10) || char(10) || ? WHERE shop_url LIKE '%/products/tasstvattkit-%' AND focus NOT LIKE '%Fakta från butikens produktsida%'").run(PAW_KIT_SHOP_FACTS);
db.prepare("UPDATE products SET description = replace(description, 'mjuka silikonborst', 'mjuka TPR-borst'), focus = replace(replace(focus, 'mjuka silikonborst', 'mjuka TPR-borst'), 'silikonborsten känns', 'de mjuka borsten känns') WHERE shop_url LIKE '%/products/tasstvattkit-%'").run();
db.prepare("UPDATE products SET shopify_handle = substr(shop_url, instr(shop_url, '/products/') + 10) WHERE shopify_handle IS NULL AND shop_url LIKE '%/products/%'").run();

// Produkten som agenterna gör reklam för just nu. Standard: den första.
export function activeProduct() {
  const id = getSetting("active_product_id", null);
  return db.prepare("SELECT * FROM products WHERE id = ?").get(id) ?? db.prepare("SELECT * FROM products ORDER BY id LIMIT 1").get();
}
