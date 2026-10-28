// Webbservern: kontrollsidan, dess API och videofilerna som Instagram/Facebook hämtar.
import express from "express";
import crypto from "node:crypto";
import { db, log, getSetting, setSetting, ensureAgents, AGENT_KINDS, CHANNELS, MEDIA_DIR } from "./db.js";
import { startScheduler, runNow } from "./scheduler.js";
import { sendReply, channelConfigured } from "./agents/social.js";
import { higgsfieldConfigured } from "./higgsfield.js";

const app = express();
app.use(express.json());

// Offentligt: hälsokoll och videofiler (slumpade filnamn) så att Meta kan hämta dem.
app.get("/health", (_req, res) => res.send("ok"));
app.use("/media", express.static(MEDIA_DIR, { index: false }));

// Allt annat kräver lösenordet (CONTROL_PASSWORD). Användarnamnet spelar ingen roll.
app.use((req, res, next) => {
  const password = process.env.CONTROL_PASSWORD;
  if (!password) return res.status(500).send("Sätt CONTROL_PASSWORD i Railway först.");
  const [, encoded = ""] = (req.headers.authorization || "").split(" ");
  const given = Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":");
  const ok = given.length === password.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(password));
  if (ok) return next();
  res.set("WWW-Authenticate", 'Basic realm="Agent UF"').status(401).send("Lösenord krävs");
});

app.use(express.static("public"));

const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);

app.get("/api/state", (_req, res) => {
  const products = all("SELECT * FROM products ORDER BY id").map((p) => ({
    ...p,
    agents: all("SELECT * FROM agents WHERE product_id = ?", p.id),
  }));
  res.json({
    products,
    videos: all("SELECT * FROM videos ORDER BY id DESC LIMIT 30").map((v) => ({
      ...v,
      captions: v.captions ? JSON.parse(v.captions) : null,
      posts: all("SELECT * FROM posts WHERE video_id = ?", v.id),
    })),
    inbox: all("SELECT * FROM inbox WHERE status IN ('drafted', 'failed') ORDER BY id DESC LIMIT 50"),
    log: all("SELECT * FROM log ORDER BY id DESC LIMIT 60"),
    research: all("SELECT * FROM research ORDER BY id DESC LIMIT 3"),
    connections: {
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
      higgsfield: higgsfieldConfigured(),
      publicUrl: Boolean(process.env.PUBLIC_URL),
      ...Object.fromEntries(CHANNELS.map((c) => [c, channelConfigured[c]()])),
    },
    settings: {
      auto_reply_instagram: getSetting("auto_reply_instagram", false),
      auto_reply_facebook: getSetting("auto_reply_facebook", false),
    },
  });
});

app.post("/api/agents/:productId/:kind", (req, res) => {
  const { productId, kind } = req.params;
  if (!AGENT_KINDS.includes(kind) && kind !== "all") return res.status(400).json({ error: "Okänd agent" });
  const running = req.body.running ? 1 : 0;
  if (kind === "all") db.prepare("UPDATE agents SET running = ? WHERE product_id = ?").run(running, productId);
  else db.prepare("UPDATE agents SET running = ? WHERE product_id = ? AND kind = ?").run(running, productId, kind);
  log(Number(productId), kind, running ? "Startad" : "Stoppad");
  res.json({ ok: true });
});

app.post("/api/agents/:productId/:kind/run", (req, res) => {
  try {
    runNow(Number(req.params.productId), req.params.kind);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/videos/:id/approve", (req, res) => {
  const video = one("SELECT * FROM videos WHERE id = ? AND status = 'pending'", req.params.id);
  if (!video) return res.status(404).json({ error: "Videon väntar inte på godkännande" });
  const captions = { ...JSON.parse(video.captions), ...(req.body.captions || {}) };
  db.prepare("UPDATE videos SET status = 'approved', captions = ? WHERE id = ?").run(JSON.stringify(captions), video.id);
  log(video.product_id, "prompt", `Video #${video.id} godkänd`);
  res.json({ ok: true });
});

app.post("/api/videos/:id/reject", (req, res) => {
  db.prepare("UPDATE videos SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(req.params.id);
  res.json({ ok: true });
});

// "Lägg upp själv": markera att du har lagt upp videon manuellt.
app.post("/api/posts/:id/done", (req, res) => {
  db.prepare("UPDATE posts SET status = 'posted' WHERE id = ? AND status = 'manual'").run(req.params.id);
  res.json({ ok: true });
});

// Ett misslyckat inlägg tas bort så att agenten försöker igen.
app.post("/api/posts/:id/retry", (req, res) => {
  db.prepare("DELETE FROM posts WHERE id = ? AND status = 'failed'").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/inbox/:id/send", async (req, res) => {
  const row = one("SELECT * FROM inbox WHERE id = ?", req.params.id);
  if (!row) return res.status(404).json({ error: "Finns inte" });
  if (req.body.draft) db.prepare("UPDATE inbox SET draft = ? WHERE id = ?").run(req.body.draft, row.id);
  try {
    await sendReply(one("SELECT * FROM inbox WHERE id = ?", row.id));
    res.json({ ok: true });
  } catch (err) {
    db.prepare("UPDATE inbox SET status = 'failed', error = ? WHERE id = ?").run(err.message, row.id);
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/inbox/:id/ignore", (req, res) => {
  db.prepare("UPDATE inbox SET status = 'ignored' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.post("/api/settings", (req, res) => {
  for (const key of ["auto_reply_instagram", "auto_reply_facebook"]) {
    if (key in req.body) setSetting(key, Boolean(req.body[key]));
  }
  res.json({ ok: true });
});

app.put("/api/products/:id", (req, res) => {
  const fields = ["name", "description", "price", "image_url", "shop_url", "audience"];
  const current = one("SELECT * FROM products WHERE id = ?", req.params.id);
  if (!current) return res.status(404).json({ error: "Finns inte" });
  const next = { ...current, ...Object.fromEntries(fields.filter((f) => f in req.body).map((f) => [f, String(req.body[f])])) };
  db.prepare("UPDATE products SET name = ?, description = ?, price = ?, image_url = ?, shop_url = ?, audience = ? WHERE id = ?")
    .run(...fields.map((f) => next[f]), current.id);
  res.json({ ok: true });
});

app.post("/api/products", (req, res) => {
  const { name, description, price, image_url = "", shop_url = "", audience = "" } = req.body;
  if (!name || !description || !price) return res.status(400).json({ error: "Namn, beskrivning och pris krävs" });
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO products (name, description, price, image_url, shop_url, audience) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(name, description, price, image_url, shop_url, audience);
  ensureAgents(Number(lastInsertRowid));
  res.json({ ok: true, id: Number(lastInsertRowid) });
});

// Om servern startades om mitt i en publicering räknas den som misslyckad.
db.prepare("UPDATE posts SET status = 'failed', error = 'Avbröts av omstart' WHERE status = 'publishing'").run();

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Kontrollsidan kör på port ${port}`);
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();
});
