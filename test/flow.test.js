// Testar hela kedjan research → prompt → Higgsfield → kanalagenterna utan att spendera pengar:
// alla anrop till Claude, Higgsfield och Meta fångas upp här och får påhittade svar.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-uf-test-"));
Object.assign(process.env, {
  DATA_DIR: dataDir,
  ANTHROPIC_API_KEY: "test-key",
  HF_API_KEY: "test-id:test-secret",
  PUBLIC_URL: "https://agent-uf.test",
  META_PAGE_ID: "page-1",
  META_PAGE_TOKEN: "page-token",
  META_IG_USER_ID: "",
  GOOGLE_TTS_API_KEY: "tts-key",
});

// En riktig liten video (2 s med ljud) och en riktig röstfil, så att klipparen testas på riktigt.
const sampleVideo = path.join(dataDir, "sample.mp4");
const sampleVoice = path.join(dataDir, "voice.mp3");
execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=480x854:d=2:r=24", "-f", "lavfi", "-i", "sine=f=300:d=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sampleVideo]);
execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=f=500:d=4", sampleVoice]);

const calls = [];
let videoStatus = "queued";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const claudeText = (text, citations) => json({
  id: "msg_test", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn",
  content: [{ type: "text", text, ...(citations ? { citations } : {}) }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const CONCEPT = {
  idea: "Lerig tass blir ren på tre sekunder",
  hook: "Lerig tass i närbild",
  video_prompt: "0-3 s: close-up of a muddy dog paw entering a silicone paw washer cup...",
  hook_type: "problem–lösning",
  variant_of: 0,
  audience: "ägare till stora hundar",
  overlays: [{ from: 0, to: 1, text: "Lerig hund igen?" }, { from: 1, to: 2, text: "Ren tass på sekunder" }],
  voiceover: "Trött på leriga tassar? Tasstvättkit för 199 kronor på vardagshoppen.com. De tio första får 10 % extra med koden FORSTA10.",
  end_card: { headline: "Rena tassar på sekunder", offer_lines: ["−5 % med koden VALKOMMEN5", "+10 % för de 10 första: FORSTA10"], cta: "Beställ idag" },
  captions: { instagram: "IG-text", facebook: "FB-text", tiktok: "TT-text" },
};
let reviewedConcept = CONCEPT;
let ignoreOrders = false; // låtsas att granskaren struntar i beställningen (A/B-krok, variant)
let clipPlan = null;
// Granskaren följer beställningen: väljer en ledig krok i A/B-testet och sätter variant_of.
function followOrder(concept, prompt) {
  if (ignoreOrders) return concept;
  const free = prompt.match(/Välj någon av: ([^.\n]+)\./)?.[1]?.split(", ");
  const variant = prompt.match(/Sätt variant_of = (\d+)/)?.[1];
  return { ...concept, ...(free ? { hook_type: free[0] } : {}), ...(variant ? { variant_of: Number(variant) } : {}) };
}
const CLIP_PLAN = {
  idea: "Bella får rena tassar efter promenaden", hook_type: "nöjsam start", audience: "hundägare med ljust golv",
  overlays: [{ from: 0, to: 1.5, text: "Lerig efter promenaden?" }],
  voiceover: "Leriga tassar efter promenaden? Tasstvättkit för 199 kronor på vardagshoppen.com.",
  end_card: { headline: "Rena tassar på sekunder", offer_lines: ["−5 % med koden VALKOMMEN5"], cta: "Beställ idag" },
  captions: { instagram: "IG-film", facebook: "FB-film", tiktok: "TT-film" },
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = init.body ? JSON.parse(init.body) : null;
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  calls.push({ url, method: init.method ?? "GET", headers, body });

  if (url.startsWith("https://api.anthropic.com/")) {
    const system = body.system;
    if (system.startsWith("Du är researchagent")) {
      return claudeText("Utkast", [{ type: "web_search_result_location", url: "https://example.com/a", title: "Källa A", cited_text: "x", encrypted_index: "e" }]);
    }
    if (system.startsWith("Du är faktagranskare")) return claudeText("## Så används produkten bäst\n- Doppa och vrid (källa: https://example.com/a)");
    if (system.startsWith("Du är promptagent")) return claudeText(JSON.stringify({ concepts: [CONCEPT, CONCEPT, CONCEPT] }));
    if (system.startsWith("Du är en sträng kvalitetsgranskare")) {
      const final = followOrder(reviewedConcept, body.messages[0].content.at(-1).text);
      return claudeText(JSON.stringify({ reviews: [{ idea: CONCEPT.idea, score: 9, problems: "" }], final, score: 9, problems: "" }));
    }
    if (system.startsWith("Du är klippagent")) return claudeText(JSON.stringify(clipPlan ?? CLIP_PLAN));
  }
  if (url === "https://api.higgsfield.ai/alibaba/wan-3.0/reference-to-video") {
    return json({ status: "queued", request_id: "req-1", status_url: "https://api.higgsfield.ai/requests/req-1/status" });
  }
  if (url === "https://api.higgsfield.ai/requests/req-1/status") {
    return json(videoStatus === "completed"
      ? { status: "completed", request_id: "req-1", video: { url: "https://cdn.higgsfield.test/video.mp4" } }
      : { status: videoStatus, request_id: "req-1" });
  }
  if (url.startsWith("https://cdn.shopify.com/")) {
    if (url.includes("tasskit-med-handduk.jpg")) return new Response(null, { status: 404 }); // gammal, borttagen bild
    return new Response(null, { status: 200 });
  }
  if (url === "https://vardagshoppen.com/products/tasstvattkit-sma-och-mellanstora-hundar.json") {
    return json({ product: { image: { src: "https://cdn.shopify.com/s/files/ny-bild.jpg" } } });
  }
  if (url === "https://cdn.higgsfield.test/video.mp4") return new Response(fs.readFileSync(sampleVideo));
  if (url === "https://texttospeech.googleapis.com/v1/text:synthesize") {
    return json({ audioContent: fs.readFileSync(sampleVoice).toString("base64") });
  }
  if (url.startsWith("https://graph.facebook.com/")) {
    if (url.includes("/page-1/videos")) return json({ id: "fb-video-1" });
    if (url.includes("/fb-video-1/video_insights")) {
      const metric = (name, value) => ({ name, values: [{ value }] });
      return json({ data: [metric("total_video_impressions", 1000), metric("total_video_views", 340), metric("total_video_10s_views", 200),
        metric("total_video_complete_views", 120), metric("total_video_avg_time_watched", 6200)] });
    }
    return json({ data: [] }); // kommentarer och DM: inga nya
  }
  throw new Error(`Oväntat nätverksanrop i testet: ${url}`);
};

// Modulerna laddas först nu, så att de använder den falska fetch och testdatabasen.
const { db, activeProduct } = await import("../src/db.js");
const { tick } = await import("../src/scheduler.js");
const { setQueuedVideos, queuedVideos, pollVideos } = await import("../src/agents/prompt.js");
const { progressOf, STAGES } = await import("../src/progress.js");
const { probe } = await import("../src/editor.js");

test("research → prompt → Higgsfield → video tillbaka → kanalagenterna", async () => {
  const product = activeProduct();
  setQueuedVideos(product.id, 1); // som att trycka Beställ 1 video

  await tick();

  // Researchagenten är klar och har lämnat över till promptagenten.
  assert.equal(progressOf(product.id, "research").status, "done");
  const research = db.prepare("SELECT * FROM research WHERE product_id = ?").get(product.id);
  assert.match(research.notes, /Doppa och vrid/);

  // Promptagenten fick researchen och skickade prompten + produktbilden till Higgsfield.
  const ideaCall = calls.find((c) => c.url.startsWith("https://api.anthropic.com/") && c.body.system.startsWith("Du är promptagent"));
  assert.match(JSON.stringify(ideaCall.body.messages), /Doppa och vrid/, "promptagenten fick researchen");
  const hf = calls.find((c) => c.url.endsWith("/reference-to-video"));
  assert.equal(hf.method, "POST");
  assert.equal(hf.headers.get("Authorization"), "Key test-id:test-secret");
  assert.equal(hf.body.prompt, CONCEPT.video_prompt);
  // Den gamla produktbilden var borttagen i Shopify, så den nya hämtades från butiken.
  assert.deepEqual(hf.body.image_urls, ["https://cdn.shopify.com/s/files/ny-bild.jpg"]);
  assert.deepEqual(ideaCall.body.messages[0].content[0].source, { type: "url", url: "https://cdn.shopify.com/s/files/ny-bild.jpg" });
  assert.equal(hf.body.duration, 10);
  assert.equal(hf.body.aspect_ratio, "9:16");
  assert.ok(hf.headers.get("Idempotency-Key"));
  assert.equal(queuedVideos(product.id), 0);

  let video = db.prepare("SELECT * FROM videos WHERE product_id = ?").get(product.id);
  assert.equal(video.status, "generating");
  assert.equal(video.hf_request_id, "req-1");
  assert.equal(STAGES.prompt[progressOf(product.id, "prompt").stage][0], "render");

  // Higgsfield jobbar fortfarande: inget händer.
  videoStatus = "in_progress";
  await pollVideos();
  assert.equal(db.prepare("SELECT status FROM videos WHERE id = ?").get(video.id).status, "generating");

  // Videon är klar: den hämtas, sparas och väntar på godkännande. Pilarna till kanalerna blir fulla.
  videoStatus = "completed";
  await pollVideos();
  video = db.prepare("SELECT * FROM videos WHERE id = ?").get(video.id);
  assert.equal(video.status, "pending");
  assert.ok(fs.existsSync(path.join(dataDir, "media", video.local_file)), "videofilen är sparad");
  // Klipparen har lagt på slutbild och röst: 2 s video + slutbild som räcker för rösten (4 s + marginal).
  assert.equal(video.error, null);
  assert.notEqual(video.local_file, video.raw_file);
  const finished = await probe(path.join(dataDir, "media", video.local_file));
  assert.ok(finished.duration > 4.5 && finished.duration < 5.5, `längd ${finished.duration}`);
  assert.ok(finished.hasAudio);
  const tts = calls.find((c) => c.url.startsWith("https://texttospeech.googleapis.com/"));
  assert.equal(tts.body.input.text, CONCEPT.voiceover);
  assert.equal(tts.body.voice.languageCode, "sv-SE");
  assert.match(video.idea, /Röst: "Trött på leriga tassar/);
  assert.equal(progressOf(product.id, "prompt").status, "done");

  // Inget läggs upp innan du har godkänt.
  db.prepare("UPDATE agents SET running = 1 WHERE product_id = ? AND kind IN ('facebook', 'instagram')").run(product.id);
  await tick();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 0);

  // Godkänd: Facebook-agenten lägger upp den, Instagram (inte kopplat) lägger den under "Lägg upp själv".
  db.prepare("UPDATE videos SET status = 'approved' WHERE id = ?").run(video.id);
  await tick();
  const fbPost = db.prepare("SELECT * FROM posts WHERE video_id = ? AND channel = 'facebook'").get(video.id);
  assert.equal(fbPost.status, "posted");
  assert.equal(fbPost.external_id, "fb-video-1");
  const fbCall = calls.find((c) => c.url.includes("/page-1/videos"));
  assert.equal(fbCall.body.file_url, `https://agent-uf.test/media/${video.local_file}`);
  assert.equal(fbCall.body.description, "FB-text");
  assert.equal(db.prepare("SELECT status FROM posts WHERE video_id = ? AND channel = 'instagram'").get(video.id).status, "manual");
  // TikTok-agenten är avstängd och har inte lagt upp något.
  assert.equal(db.prepare("SELECT 1 FROM posts WHERE channel = 'tiktok'").get(), undefined);
});

test("Produktbilden går inte att hämta: inga pengar går åt", async () => {
  const product = activeProduct();
  db.prepare("UPDATE products SET image_url = 'https://cdn.shopify.com/tasskit-med-handduk.jpg', shopify_handle = NULL WHERE id = ?").run(product.id);
  db.prepare("UPDATE videos SET status = 'rejected' WHERE status = 'generating'").run();
  const before = calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length;
  setQueuedVideos(product.id, 2);
  await tick();
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length, before, "Claude anropades inte");
  assert.equal(queuedVideos(product.id), 0);
  assert.match(progressOf(product.id, "prompt").detail, /Produktbilden går inte att hämta/);
});

test("Higgsfield misslyckas: kön töms och promptagenten visar felet", async () => {
  const product = activeProduct();
  db.prepare("INSERT INTO videos (product_id, created_at, status, hf_request_id) VALUES (?, ?, 'generating', 'req-1')").run(product.id, new Date().toISOString());
  setQueuedVideos(product.id, 3);
  videoStatus = "nsfw";
  await pollVideos();
  assert.equal(queuedVideos(product.id), 0);
  assert.equal(progressOf(product.id, "prompt").status, "error");
});

test("Fel rabatt i annonsen: ingen video beställs, även om granskaren gav 9/10", async () => {
  const product = activeProduct();
  db.prepare("UPDATE products SET image_url = 'https://cdn.shopify.com/s/files/ny-bild.jpg' WHERE id = ?").run(product.id);
  db.prepare("UPDATE videos SET status = 'rejected' WHERE status = 'generating'").run();
  reviewedConcept = { ...CONCEPT, voiceover: "Nu 25 % rabatt med koden FORSTA10!" };
  const before = calls.filter((c) => c.url.endsWith("/reference-to-video")).length;
  setQueuedVideos(product.id, 1);
  await tick();
  reviewedConcept = CONCEPT;
  assert.equal(calls.filter((c) => c.url.endsWith("/reference-to-video")).length, before, "Higgsfield anropades inte");
  assert.equal(progressOf(product.id, "prompt").status, "stopped");
  const logged = db.prepare("SELECT message FROM log WHERE message LIKE 'Stoppad av faktakollen%'").get();
  assert.match(logged.message, /25 % finns inte/);

  // Resultaten från Facebook hämtades (gratis) och promptagenten fick dem, med den publicerade videon som vinnare.
  const post = db.prepare("SELECT * FROM posts WHERE channel = 'facebook'").get();
  assert.equal(JSON.parse(post.stats).views, 340);
  const ideaCall = calls.findLast((c) => c.url.startsWith("https://api.anthropic.com/") && c.body.system.startsWith("Du är promptagent"));
  const sent = JSON.stringify(ideaCall.body.messages);
  assert.match(sent, /1 000 visade · krokgrad 34 % · 35 % tittade klart · snitt 6,2 s/);
  assert.match(sent, new RegExp(`Vinnarvideon just nu: #${post.video_id}`));
});

test("Produkttexten säger en annan rabatt än erbjudandena: ägaren får veta det", async () => {
  const { offerMismatches } = await import("../src/agents/prompt.js");
  const { DEFAULT_OFFERS } = await import("../src/db.js");
  const [warning] = offerMismatches("Lanseringserbjudande: de 10 första kunderna får 25 % rabatt med koden FORSTA10 i kassan.", DEFAULT_OFFERS);
  assert.match(warning, /25 % för FORSTA10.*10 %/);
});

const { videoJobs, addVideoJobs, newAbGroup } = await import("../src/agents/prompt.js");
const { abTests } = await import("../src/agents/stats.js");
const { nextVideoFor } = await import("../src/agents/social.js");
const { addClip } = await import("../src/agents/clips.js");
const claudeCalls = (start) => calls.filter((c) => c.url.startsWith("https://api.anthropic.com/") && c.body.system.startsWith(start));

/** Gör klart nästa video i kön: promptagenten beställer, Higgsfield blir klar, videon klipps. */
async function makeNextVideo() {
  videoStatus = "queued";
  await tick();
  videoStatus = "completed";
  await pollVideos();
}

test("A/B-test: 3 videor med samma budskap men olika krokar, och vinnaren utses efter siffrorna", async () => {
  const product = activeProduct();
  db.prepare("UPDATE videos SET status = 'rejected' WHERE status IN ('generating', 'pending')").run();
  const group = newAbGroup();
  addVideoJobs(product.id, [1, 2, 3].map(() => ({ kind: "ab", group })));
  assert.equal(queuedVideos(product.id), 3);
  for (let i = 0; i < 3; i++) await makeNextVideo();
  assert.equal(queuedVideos(product.id), 0);

  const videos = db.prepare("SELECT * FROM videos WHERE ab_group = ? ORDER BY id").all(group);
  assert.equal(videos.length, 3);
  assert.deepEqual(videos.map((v) => v.status), ["pending", "pending", "pending"]);
  assert.equal(new Set(videos.map((v) => v.hook_type)).size, 3, "olika krokar");
  // Den andra videon fick veta vilken krok som redan användes och vilket budskap den skulle behålla.
  const secondIdeas = claudeCalls("Du är promptagent").at(-2).body.messages[0].content.at(-1).text;
  assert.match(secondIdeas, new RegExp(`Krok-typer som redan används i testet: ${videos[0].hook_type}`));
  assert.match(secondIdeas, new RegExp(`Behåll budskapet från video #${videos[0].id}`));

  // Inga siffror än: ingen vinnare.
  assert.equal(abTests(product.id)[0].winnerId, null);
  // Publicerade på Facebook med olika krokgrad: video 2 vinner.
  const insert = db.prepare("INSERT INTO posts (video_id, channel, status, external_id, created_at, stats) VALUES (?, 'facebook', 'posted', ?, ?, ?)");
  videos.forEach((v, i) => insert.run(v.id, `ab-${v.id}`, new Date().toISOString(), JSON.stringify({ impressions: 500, views: [100, 250, 150][i] })));
  const [test1] = abTests(product.id);
  assert.equal(test1.group, group);
  assert.equal(test1.winnerId, videos[1].id);
  assert.equal(Math.round(test1.videos[1].hookRate * 100), 50);
});

test("A/B-test: en idé med en krok som redan används stoppas innan Higgsfield anropas", async () => {
  const product = activeProduct();
  const group = newAbGroup();
  db.prepare("INSERT INTO videos (product_id, created_at, status, idea, hook_type, ab_group) VALUES (?, ?, 'pending', 'Första', 'problem–lösning', ?)").run(product.id, new Date().toISOString(), group);
  addVideoJobs(product.id, [{ kind: "ab", group }]);
  const before = calls.filter((c) => c.url.endsWith("/reference-to-video")).length;
  ignoreOrders = true;
  await tick();
  ignoreOrders = false;
  assert.equal(calls.filter((c) => c.url.endsWith("/reference-to-video")).length, before, "Higgsfield anropades inte");
  assert.equal(progressOf(product.id, "prompt").status, "stopped");
  assert.ok(db.prepare("SELECT 1 FROM log WHERE message LIKE ?").get(`%Krok-typen "problem–lösning" används redan i ${group}%`));
});

test("Variant av en video, och kanalval: en video bara för Facebook läggs inte upp på Instagram", async () => {
  const product = activeProduct();
  const target = db.prepare("SELECT id FROM videos WHERE status = 'pending' ORDER BY id LIMIT 1").get();
  addVideoJobs(product.id, [{ kind: "variant", of: target.id }]);
  await makeNextVideo();
  const variant = db.prepare("SELECT * FROM videos ORDER BY id DESC LIMIT 1").get();
  assert.equal(variant.variant_of, target.id);
  assert.equal(variant.status, "pending");
  assert.match(variant.idea, new RegExp(`variant av #${target.id}`));

  db.prepare("UPDATE videos SET status = 'rejected' WHERE status = 'approved'").run();
  db.prepare("UPDATE videos SET status = 'approved', channels = ? WHERE id = ?").run(JSON.stringify(["facebook"]), variant.id);
  assert.equal(nextVideoFor(product, "facebook").id, variant.id);
  assert.equal(nextVideoFor(product, "instagram"), undefined);
  db.prepare("UPDATE videos SET channels = NULL WHERE id = ?").run(variant.id);
  assert.equal(nextVideoFor(product, "instagram").id, variant.id);
});

test("Egen mobilfilm: klippagenten lägger på text, röst och logga utan Higgsfield", async () => {
  const product = activeProduct();
  setQueuedVideos(product.id, 0);
  await assert.rejects(addClip(product.id, Buffer.from("inte en film"), ""), /gick inte att läsa som video/);

  const higgsfieldBefore = calls.filter((c) => c.url.includes("higgsfield")).length;
  const id = await addClip(product.id, fs.readFileSync(sampleVideo), "Bella efter promenaden");
  assert.equal(db.prepare("SELECT status FROM videos WHERE id = ?").get(id).status, "editing");
  await tick();

  const clip = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
  assert.equal(clip.status, "pending", clip.error ?? "");
  assert.equal(clip.source, "clip");
  assert.equal(clip.hook_type, "nöjsam start");
  assert.equal(JSON.parse(clip.captions).facebook, "FB-film");
  const finished = await probe(path.join(dataDir, "media", clip.local_file));
  assert.ok(finished.duration > 4.5 && finished.duration < 5.5, `längd ${finished.duration}`);
  assert.equal(calls.filter((c) => c.url.includes("higgsfield")).length, higgsfieldBefore, "Higgsfield anropades inte");
  // Claude fick bilder ur filmen och ägarens anteckning.
  const call = claudeCalls("Du är klippagent").at(-1);
  assert.equal(call.body.messages[0].content[0].source.type, "base64");
  assert.match(call.body.messages[0].content.at(-1).text, /Bella efter promenaden/);
  assert.equal(calls.findLast((c) => c.url.startsWith("https://texttospeech")).body.input.text, CLIP_PLAN.voiceover);
});

test("Egen mobilfilm med fel rabatt: markeras som misslyckad och försöks inte igen", async () => {
  const product = activeProduct();
  clipPlan = { ...CLIP_PLAN, voiceover: "Nu 50 % rabatt med koden REA50!" };
  const id = await addClip(product.id, fs.readFileSync(sampleVideo), "");
  await tick();
  const before = claudeCalls("Du är klippagent").length;
  await tick();
  clipPlan = null;
  const clip = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
  assert.equal(clip.status, "failed");
  assert.match(clip.error, /faktakollen/);
  assert.equal(claudeCalls("Du är klippagent").length, before, "inget nytt försök");
});
