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

export function ensureAgents(productId) {
  const insert = db.prepare("INSERT OR IGNORE INTO agents (product_id, kind) VALUES (?, ?)");
  for (const kind of AGENT_KINDS) insert.run(productId, kind);
}

// Första produkten läggs in automatiskt.
if (!db.prepare("SELECT 1 FROM products LIMIT 1").get()) {
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO products (name, description, price, image_url, shop_url, audience) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    "Tasstvättkit",
    "Tasstvätt (kopp med mjuka silikonborst) för små, mellanstora och stora hundar plus mikrofiberhandduk med tassmönster. Doppa tassen, vrid lätt, torka av – inga leriga tassar inne.",
    "199 kr",
    "https://cdn.shopify.com/s/files/1/1073/2290/0744/files/tasskit-med-handduk.jpg?v=1793199480",
    "https://frostskrapa.myshopify.com/products/tasstvattkit-sma-och-mellanstora-hundar",
    "Medelålders hundägare i Sverige med hundar i alla storlekar, särskilt under höst och vinter med lera, slask och grus."
  );
  ensureAgents(Number(lastInsertRowid));
}
