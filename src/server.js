// Webbservern: kontrollsidan, dess API och videofilerna som Instagram/Facebook hämtar.
import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, log, getSetting, setSetting, ensureAgents, activeProduct, currentOffers, CHANNELS, MEDIA_DIR } from "./db.js";
import { startScheduler, runNow } from "./scheduler.js";
import { sendReply, channelConfigured } from "./agents/social.js";
import { diagnoseMeta, metaLoginConfigured, metaLoginUrl, finishMetaLogin } from "./channels/meta.js";
import { higgsfieldConfigured, VIDEO_MODELS, videoModel, videoModelSek } from "./higgsfield.js";
import { geminiConfigured, tavilyConfigured } from "./gemini.js";
import { queuedVideos, setQueuedVideos, addVideoJobs, videoJobs, newAbGroup } from "./agents/prompt.js";
import { statsText, abTests, performance } from "./agents/stats.js";
import { addClip } from "./agents/clips.js";
import { researchDue, latestResearch, RESEARCH_EVERY_DAYS } from "./agents/research.js";
import { importShopifyProducts } from "./shopify.js";
import { STAGES, progressOf } from "./progress.js";
import { estimateSek, spendSummary } from "./costs.js";
import { selfCheck } from "./editor.js";
import { voiceConfigured, synthesizeVoice, VOICES, chosenVoice } from "./voice.js";
import { editAndOffer } from "./agents/prompt.js";

const AB_SIZE = 3;
const MAX_ORDER = 10;

const app = express();
app.use(express.json());

// Offentligt: hälsokoll och videofiler (slumpade filnamn) så att Meta kan hämta dem.
app.get("/health", (_req, res) => res.send("ok"));
app.use("/media", express.static(MEDIA_DIR, { index: false }));
// Samma video som nedladdning: mobilens webbläsare sparar filen i stället för att bara spela upp den.
app.get("/download/:file", (req, res) => {
  if (!/^[a-f0-9]{24}\.mp4$/.test(req.params.file)) return res.status(404).send("Hittades inte");
  res.download(path.join(MEDIA_DIR, req.params.file), "vardagshoppen-annons.mp4", (err) => {
    if (err && !res.headersSent) res.status(404).send("Hittades inte");
  });
});

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
      gemini: geminiConfigured(),
      tavily: tavilyConfigured(),
      higgsfield: higgsfieldConfigured(),
      publicUrl: Boolean(process.env.PUBLIC_URL),
      editor: checks.editor,
      voice: checks.voice,
      ...Object.fromEntries(CHANNELS.map((c) => [c, channelConfigured[c]()])),
    },
    // Vad ett jobb brukar kosta (snittet av de senaste, annars en uppskattning) och vad Claude faktiskt har kostat.
    // En video = Claude (idéer och granskning) + Higgsfield (den valda videomodellen).
    cost: { video: estimateSek("video") + videoModelSek(), research: geminiConfigured() ? 0 : estimateSek("research"), clip: estimateSek("clip") },
    spend: spendSummary(),
    videoModels: Object.entries(VIDEO_MODELS).map(([id, m]) => ({ id, ...m, chosen: id === videoModel() })),
    voices: Object.entries(VOICES).map(([id, name]) => ({ id, name, chosen: id === chosenVoice() })),
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

// Klipp om en video gratis (ingen ny Higgsfield- eller Claude-kostnad), t.ex. efter att klippningen misslyckades.
// Provlyssna på en röst (gratis inom Googles gratiskvot). Sparas, så att samma röst bara görs en gång.
app.get("/api/voices/:id/preview", async (req, res) => {
  if (!VOICES[req.params.id]) return res.status(404).json({ error: "Okänd röst" });
  if (!voiceConfigured()) return res.status(400).json({ error: "GOOGLE_TTS_API_KEY saknas i Railway" });
  const file = path.join(MEDIA_DIR, `voice-preview-${req.params.id}.mp3`);
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, await synthesizeVoice("Leriga tassar efter promenaden? Med tasstvättkitet från Vardagshoppen blir tassen ren på några sekunder. Finns i S, M och L.", req.params.id));
    }
    res.type("audio/mpeg").sendFile(file);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Klipp om en video gratis (samma film från Higgsfield): med den valda rösten, och med ny rösttext om du skrev en.
app.post("/api/videos/:id/reedit", async (req, res) => {
  let video = one("SELECT * FROM videos WHERE id = ?", req.params.id);
  if (!video?.raw_file || !["failed", "pending"].includes(video.status)) return res.status(400).json({ error: "Den här videon går inte att klippa om" });
  // Det rösten säger och det som står i bild kan skilja sig, t.ex. när rösten uttalar ett ord fel och du skriver det som det låter.
  const voiceover = String(req.body?.voiceover ?? "").trim();
  const captionText = String(req.body?.caption_text ?? "").trim();
  if (voiceover || captionText) {
    const edit = JSON.parse(video.edit || "{}");
    if (voiceover) edit.voiceover = voiceover;
    if (captionText) edit.caption_text = captionText;
    db.prepare("UPDATE videos SET edit = ? WHERE id = ?").run(JSON.stringify(edit), video.id);
    video = one("SELECT * FROM videos WHERE id = ?", video.id);
  }
  // Egen status, så att klippagenten inte tar filmen och skriver nya texter (det skulle kosta).
  db.prepare("UPDATE videos SET status = 'reediting' WHERE id = ?").run(video.id);
  const ok = await editAndOffer(video);
  if (!ok) return res.status(500).json({ error: one("SELECT error FROM videos WHERE id = ?", video.id).error });
  res.json({ ok: true });
});

// Radera en video: filerna på servern och raden på sidan. Inlägg som redan ligger ute på TikTok, Instagram
// eller Facebook ligger kvar där (dem tar du bort i appen). En video som håller på att göras kan inte raderas.
app.delete("/api/videos/:id", (req, res) => {
  const video = one("SELECT * FROM videos WHERE id = ?", req.params.id);
  if (!video) return res.status(404).json({ error: "Videon finns inte" });
  if (["generating", "editing", "reediting"].includes(video.status)) return res.status(400).json({ error: "Videon görs just nu. Vänta tills den är klar." });
  for (const file of [video.local_file, video.raw_file]) {
    if (file) fs.rmSync(path.join(MEDIA_DIR, path.basename(file)), { force: true });
  }
  db.prepare("DELETE FROM posts WHERE video_id = ?").run(video.id);
  db.prepare("DELETE FROM videos WHERE id = ?").run(video.id);
  log(video.product_id, "all", `Video #${video.id} raderad.`);
  res.json({ ok: true });
});

// "Lägg upp själv": markera att du har lagt upp videon manuellt.
app.post("/api/posts/:id/done", (req, res) => {
  db.prepare("UPDATE posts SET status = 'posted' WHERE id = ? AND status = 'manual'").run(req.params.id);
  res.json({ ok: true });
});

// Ett misslyckat inlägg tas bort så att agenten försöker igen.
// "Koppla Facebook": skickar dig till Facebooks godkännanderuta och tar emot svaret.
// Adressen byggs från den adress du själv är på, så att den alltid stämmer med appens domän.
const siteUrl = (req) => `${req.get("x-forwarded-proto") || req.protocol}://${req.get("host")}`;
const metaRedirect = (req) => `${siteUrl(req)}/meta/callback`;
let metaState = null;
app.get("/meta/connect", (req, res) => {
  if (!metaLoginConfigured()) return res.status(400).send("Lägg in META_APP_ID och META_APP_SECRET i Railway först.");
  metaState = crypto.randomBytes(16).toString("hex");
  const host = req.get("host");
  res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:24px;max-width:680px;margin:auto;line-height:1.5">
    <h2>Koppla Facebook</h2>
    <p>Facebook måste känna till exakt de här adresserna. Kolla att de står i appen (developers.facebook.com → Vardagshoppen Agent):</p>
    <p><b>App settings → Basic → App Domains:</b><br><code style="user-select:all;background:#222;padding:4px 8px;display:inline-block">${host}</code></p>
    <p><b>App settings → Basic → Website → Site URL:</b><br><code style="user-select:all;background:#222;padding:4px 8px;display:inline-block">${siteUrl(req)}/</code></p>
    <p><b>Facebook-inloggning för företag → Settings → Valid OAuth Redirect URIs:</b><br><code style="user-select:all;background:#222;padding:4px 8px;display:inline-block">${metaRedirect(req)}</code></p>
    <p>Tryck <b>Save changes</b> på varje ställe. Sedan:</p>
    <p><a href="${metaLoginUrl(metaRedirect(req), metaState).replace(/&/g, "&amp;")}" style="display:inline-block;background:#fff;color:#000;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Fortsätt till Facebook</a></p>
    ${process.env.META_LOGIN_CONFIG_ID ? `<p>Visar Facebook "Sorry, something went wrong"? Prova i stället:<br><a href="${metaLoginUrl(metaRedirect(req), metaState, false).replace(/&/g, "&amp;")}" style="display:inline-block;margin-top:6px;background:#333;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Fortsätt utan konfiguration</a></p>` : ""}
    <p><a style="color:#aaa" href="/">Tillbaka</a></p></body>`);
});
app.get("/meta/callback", async (req, res) => {
  const page = (title, lines) => res.send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font-family:system-ui;background:#0b0b0b;color:#eee;padding:24px;max-width:640px;margin:auto"><h2>${title}</h2>
    <pre style="white-space:pre-wrap;font:inherit">${lines.join("\n").replace(/</g, "&lt;")}</pre><p><a style="color:#fff" href="/">Tillbaka till kontrollsidan</a></p></body>`);
  if (req.query.error) return page("Facebook avbröts", [String(req.query.error_description || req.query.error)]);
  if (!metaState || req.query.state !== metaState) return page("Något gick fel", ["Länken var för gammal. Tryck Koppla Facebook igen."]);
  metaState = null;
  try {
    const name = await finishMetaLogin(String(req.query.code), metaRedirect(req));
    log(null, "facebook", `Facebook kopplat till sidan ${name}.`);
    const check = await diagnoseMeta();
    page(check.ok ? `Klart! Kopplat till ${name}` : `Kopplat till ${name}, men något saknas`, check.lines);
  } catch (err) {
    page("Det gick inte att koppla", [err.message]);
  }
});

app.get("/api/meta/check", async (_req, res) => {
  try { res.json(await diagnoseMeta()); } catch (err) { res.json({ ok: false, lines: [`✗ ${err.message}`] }); }
});

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
  if ("video_model" in req.body) {
    if (!VIDEO_MODELS[req.body.video_model]) return res.status(400).json({ error: "Okänd videomodell" });
    setSetting("video_model", req.body.video_model);
    log(null, "prompt", `Videomodellen är nu ${VIDEO_MODELS[req.body.video_model].name} (ca ${VIDEO_MODELS[req.body.video_model].sek} kr per video hos Higgsfield).`);
  }
  if ("tts_voice" in req.body) {
    if (!VOICES[req.body.tts_voice]) return res.status(400).json({ error: "Okänd röst" });
    setSetting("tts_voice", req.body.tts_voice);
    log(null, "prompt", `Berättarrösten är nu ${VOICES[req.body.tts_voice]}. Nya videor får den, och "Klipp om" ger en befintlig video den gratis.`);
  }
  if ("claude_budget_sek" in req.body) {
    const budget = Math.max(0, Math.round(Number(req.body.claude_budget_sek) || 0));
    setSetting("claude_budget_sek", budget);
    log(null, "all", budget ? `Månadstaket för Claude är nu ${budget} kr.` : "Månadstaket för Claude är borttaget.");
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
db.prepare("UPDATE videos SET status = 'failed', error = 'Omklippningen avbröts av en omstart. Tryck Klipp om igen.' WHERE status = 'reediting'").run();

// Provklipp och provröst när servern startar (gratis). Resultatet visas överst på kontrollsidan.
const checks = { editor: null, voice: null };
async function runChecks() {
  checks.editor = await selfCheck(MEDIA_DIR);
  if (!checks.editor.ok) log(null, "prompt", `Klipparen fungerar inte: ${checks.editor.error}`);
  if (!voiceConfigured()) checks.voice = { ok: false, error: "GOOGLE_TTS_API_KEY saknas i Railway" };
  else checks.voice = await synthesizeVoice("Hej").then(() => ({ ok: true }), (err) => ({ ok: false, error: err.message }));
  if (!checks.voice.ok) log(null, "prompt", `Berättarrösten fungerar inte: ${checks.voice.error}`);
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`Kontrollsidan kör på port ${port}`);
  if (process.env.DISABLE_SCHEDULER !== "1") startScheduler();
  runChecks();
});
