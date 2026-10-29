// Webbservern: kontrollsidan, dess API och videofilerna som Instagram/Facebook hämtar.
import express from "express";
import crypto from "node:crypto";
import { db, log, getSetting, setSetting, ensureAgents, activeProduct, currentOffers, CHANNELS, MEDIA_DIR } from "./db.js";
import { startScheduler, runNow } from "./scheduler.js";
import { sendReply, channelConfigured } from "./agents/social.js";
import { higgsfieldConfigured } from "./higgsfield.js";
import { queuedVideos, setQueuedVideos, addVideoJobs, videoJobs, newAbGroup } from "./agents/prompt.js";
import { statsText, abTests, performance } from "./agents/stats.js";
import { addClip } from "./agents/clips.js";
import { researchDue, latestResearch, RESEARCH_EVERY_DAYS } from "./agents/research.js";
import { importShopifyProducts } from "./shopify.js";
import { STAGES, progressOf } from "./progress.js";

// Ungefärliga kostnader som visas innan du beställer (kronor).
const COST = {
  video: Number(process.env.COST_PER_VIDEO_SEK || 4),
  research: Number(process.env.COST_PER_RESEARCH_SEK || 7),
  clip: Number(process.env.COST_PER_CLIP_SEK || 1),
};
const AB_SIZE = 3;
const MAX_ORDER = 10;

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

// Vad research- och promptagenten gör just nu. Kontrollsidan fyller pilarna mellan agenterna utifrån det.
function flowFor(product) {
  if (!product) return null;
  const research = latestResearch(product.id);
  let prompt = progressOf(product.id, "prompt");
  // Efter en omstart finns bara databasen kvar: en video som Higgsfield håller på med visas ändå.
  const generating = one("SELECT * FROM videos WHERE product_id = ? AND status = 'generating' ORDER BY id DESC LIMIT 1", product.id);
  if (generating && prompt?.status !== "working") {
    prompt = { status: "working", stage: STAGES.prompt.findIndex(([k]) => k === "render"), stageStartedAt: generating.created_at, runStartedAt: generating.created_at, detail: `Video #${generating.id}` };
  }
  return {
    stages: Object.fromEntries(Object.entries(STAGES).map(([agent, list]) => [agent, list.map(([, label, seconds]) => ({ label, seconds }))])),
    research: progressOf(product.id, "research") ?? (research ? { status: "done", at: research.created_at, detail: "" } : null),
    prompt,
  };
}

app.get("/api/state", (_req, res) => {
  const products = all("SELECT * FROM products ORDER BY id").map((p) => ({
    ...p,
    agents: all("SELECT * FROM agents WHERE product_id = ?", p.id),
    queued: queuedVideos(p.id),
    jobs: videoJobs(p.id),
    abTests: abTests(p.id),
    winnerId: performance(p.id).winner?.id ?? null,
    researchDue: researchDue(p),
    research: latestResearch(p.id) ?? null,
  }));
  res.json({
    products,
    activeProductId: activeProduct()?.id ?? null,
    flow: flowFor(activeProduct()),
    researchEveryDays: RESEARCH_EVERY_DAYS,
    videos: all("SELECT * FROM videos ORDER BY id DESC LIMIT 30").map((v) => ({
      ...v,
      captions: v.captions ? JSON.parse(v.captions) : null,
      channels: v.channels ? JSON.parse(v.channels) : null,
      posts: all("SELECT * FROM posts WHERE video_id = ?", v.id).map((p) => ({ ...p, statsText: p.stats ? statsText(JSON.parse(p.stats)) : "" })),
    })),
    inbox: all("SELECT * FROM inbox WHERE status IN ('drafted', 'failed') ORDER BY id DESC LIMIT 50"),
    log: all("SELECT * FROM log ORDER BY id DESC LIMIT 60"),
    connections: {
      claude: Boolean(process.env.ANTHROPIC_API_KEY),
      higgsfield: higgsfieldConfigured(),
      publicUrl: Boolean(process.env.PUBLIC_URL),
      ...Object.fromEntries(CHANNELS.map((c) => [c, channelConfigured[c]()])),
    },
    cost: COST,
    maxOrder: MAX_ORDER,
    settings: {
      auto_reply_instagram: getSetting("auto_reply_instagram", false),
      auto_reply_facebook: getSetting("auto_reply_facebook", false),
      offers: currentOffers(),
    },
  });
});

app.post("/api/agents/:productId/:kind", (req, res) => {
  const { productId, kind } = req.params;
  // Bara kanalagenterna startas och stoppas. Research och video körs när du beställer videor.
  if (!CHANNELS.includes(kind) && kind !== "all") return res.status(400).json({ error: "Den agenten startas med Beställ videor" });
  const running = req.body.running ? 1 : 0;
  if (kind === "all") {
    db.prepare(`UPDATE agents SET running = ? WHERE product_id = ? AND kind IN (${CHANNELS.map(() => "?").join(",")})`).run(running, productId, ...CHANNELS);
  } else db.prepare("UPDATE agents SET running = ? WHERE product_id = ? AND kind = ?").run(running, productId, kind);
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

// Välj vilken produkt agenterna gör reklam för. Kön för den förra produkten töms så att inga pengar går åt till den,
// och kanalagenterna fortsätter som de var (på eller av) för den nya produkten.
app.post("/api/active-product", (req, res) => {
  const next = one("SELECT * FROM products WHERE id = ?", Number(req.body.id));
  if (!next) return res.status(404).json({ error: "Finns inte" });
  const previous = activeProduct();
  if (previous && previous.id !== next.id) {
    if (queuedVideos(previous.id) > 0) {
      setQueuedVideos(previous.id, 0);
      log(previous.id, "prompt", "Kön tömdes eftersom du bytte produkt.");
    }
    ensureAgents(next.id);
    const copy = db.prepare("UPDATE agents SET running = ? WHERE product_id = ? AND kind = ?");
    for (const a of all("SELECT kind, running FROM agents WHERE product_id = ?", previous.id)) {
      if (CHANNELS.includes(a.kind)) copy.run(a.running, next.id, a.kind);
    }
    db.prepare(`UPDATE agents SET running = 0 WHERE product_id = ?`).run(previous.id);
  }
  setSetting("active_product_id", next.id);
  log(next.id, "all", `Agenterna gör nu reklam för ${next.name}.`);
  res.json({ ok: true });
});

app.post("/api/products/import", async (_req, res) => {
  try {
    res.json({ ok: true, ...(await importShopifyProducts()) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Beställ videor: det enda sättet att få agenterna att göra videor (och spendera pengar på dem).
app.post("/api/products/:id/order", (req, res) => {
  const product = one("SELECT * FROM products WHERE id = ?", req.params.id);
  if (!product) return res.status(404).json({ error: "Finns inte" });
  if (product.id !== activeProduct()?.id) return res.status(400).json({ error: "Välj produkten överst på sidan först" });
  // mode: "normal" (count videor), "ab" (A/B-test med 3 videor och olika krokar) eller "variant" (1 variant av video `of`).
  const mode = req.body.mode || "normal";
  let jobs;
  if (mode === "ab") {
    const group = newAbGroup();
    jobs = Array.from({ length: AB_SIZE }, () => ({ kind: "ab", group }));
  } else if (mode === "variant") {
    const target = one("SELECT * FROM videos WHERE id = ? AND product_id = ? AND idea IS NOT NULL AND status IN ('pending', 'approved')", Number(req.body.of), product.id);
    if (!target) return res.status(400).json({ error: "Det går bara att göra varianter av videor som väntar på dig eller är godkända" });
    jobs = [{ kind: "variant", of: target.id }];
  } else if (mode === "normal") {
    const count = Number(req.body.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_ORDER) return res.status(400).json({ error: `Välj 1–${MAX_ORDER} videor` });
    jobs = Array.from({ length: count }, () => ({ kind: "normal" }));
  } else return res.status(400).json({ error: "Okänd beställning" });
  if (queuedVideos(product.id) + jobs.length > MAX_ORDER) return res.status(400).json({ error: `Högst ${MAX_ORDER} videor i kön åt gången` });
  addVideoJobs(product.id, jobs);
  const what = mode === "ab" ? `ett A/B-test (${jobs[0].group}) med ${AB_SIZE} videor` : mode === "variant" ? `en variant av video #${jobs[0].of}` : `${jobs.length} ${jobs.length === 1 ? "video" : "videor"}`;
  log(product.id, "prompt", `Du beställde ${what}.`);
  res.json({ ok: true });
});

app.post("/api/products/:id/order/cancel", (req, res) => {
  setQueuedVideos(Number(req.params.id), 0);
  log(Number(req.params.id), "prompt", "Beställningen avbröts.");
  res.json({ ok: true });
});

// Ladda upp en egen mobilfilm. Klippagenten lägger på text, röst och logga (ett Claude-anrop, ca 1 kr).
app.post("/api/products/:id/clips", express.raw({ type: () => true, limit: "300mb" }), async (req, res) => {
  const product = one("SELECT * FROM products WHERE id = ?", req.params.id);
  if (!product) return res.status(404).json({ error: "Finns inte" });
  if (!Buffer.isBuffer(req.body) || req.body.length < 1000) return res.status(400).json({ error: "Välj en film att ladda upp" });
  try {
    const id = await addClip(product.id, req.body, decodeURIComponent(String(req.get("X-Note") || "")).trim());
    res.json({ ok: true, id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/videos/:id/approve", (req, res) => {
  const video = one("SELECT * FROM videos WHERE id = ? AND status = 'pending'", req.params.id);
  if (!video) return res.status(404).json({ error: "Videon väntar inte på godkännande" });
  // Kanalerna videon får läggas upp på. Utan val: alla.
  const channels = Array.isArray(req.body.channels) ? CHANNELS.filter((c) => req.body.channels.includes(c)) : CHANNELS;
  if (!channels.length) return res.status(400).json({ error: "Välj minst en kanal" });
  const captions = { ...JSON.parse(video.captions), ...(req.body.captions || {}) };
  db.prepare("UPDATE videos SET status = 'approved', captions = ?, channels = ? WHERE id = ?")
    .run(JSON.stringify(captions), channels.length === CHANNELS.length ? null : JSON.stringify(channels), video.id);
  log(video.product_id, "prompt", `Video #${video.id} godkänd för ${channels.join(", ")}`);
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
  if ("offers" in req.body) {
    setSetting("offers", String(req.body.offers).trim().slice(0, 1000));
    log(null, "all", "Erbjudandena ändrades.");
  }
  res.json({ ok: true });
});

app.put("/api/products/:id", (req, res) => {
  const fields = ["name", "description", "price", "image_url", "shop_url", "audience", "focus"];
  const current = one("SELECT * FROM products WHERE id = ?", req.params.id);
  if (!current) return res.status(404).json({ error: "Finns inte" });
  const next = { ...current, ...Object.fromEntries(fields.filter((f) => f in req.body).map((f) => [f, String(req.body[f])])) };
  db.prepare("UPDATE products SET name = ?, description = ?, price = ?, image_url = ?, shop_url = ?, audience = ?, focus = ? WHERE id = ?")
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
