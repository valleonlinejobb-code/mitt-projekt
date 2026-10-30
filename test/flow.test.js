// Testar hela kedjan research → prompt → Higgsfield → kanalagenterna utan att spendera pengar:
// alla anrop till Claude, Higgsfield och Meta fångas upp här och får påhittade svar.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
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
  GEMINI_RETRY_MS: "0", // inga väntetider mellan nya försök i testerna
});

// En riktig liten video (2 s med ljud) och en riktig röstfil, så att klipparen testas på riktigt.
const sampleVideo = path.join(dataDir, "sample.mp4");
const sampleVoice = path.join(dataDir, "voice.mp3");
execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc=s=480x854:d=2:r=24", "-f", "lavfi", "-i", "sine=f=300:d=2",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sampleVideo]);
execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=f=500:d=4", sampleVoice]);
// Produktbilden: helröd, så att den syns i slutbilden när vi mäter färgen.
const sampleImage = path.join(dataDir, "product.jpg");
execFileSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=400x400", "-frames:v", "1", sampleImage]);

/** Medelfärgen (r, g, b) i en ruta av en video vid tiden t. */
function colorAt(file, t, [w, h, x, y]) {
  const rgb = execFileSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1",
    "-vf", `crop=${w}:${h}:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  return [...rgb.subarray(0, 3)];
}

const calls = [];
let videoStatus = "queued";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const claudeText = (text, citations, extra = {}) => json({
  id: "msg_test", type: "message", role: "assistant", model: "claude-test", stop_reason: "end_turn",
  content: [{ type: "text", text, ...(citations ? { citations } : {}) }],
  usage: { input_tokens: 1, output_tokens: 1 },
  ...extra,
});
const CONCEPT = {
  idea: "Lerig tass blir ren på tre sekunder",
  hook: "Lerig tass i närbild",
  video_prompt: "Shot 1 (0-2s): Close-up at the dog's eye level, static camera. A golden retriever with light fur walks a very muddy front paw toward a white rug in a bright clean Scandinavian home with a light oak floor and soft natural daylight from a window. " +
    "Shot 2 (2-7s): Close-up, gentle handheld. The owner's left hand gently holds the dog's front leg while the right hand holds the paw-washing cup from the reference images, filled with a little water. The owner lowers the muddy paw into the cup, pumps the cup up and down three times and twists it so the soft bristles scrub all around the paw, muddy brown water swirling, then lifts out the clean paw. " +
    "Shot 3 (7-10s): Medium close-up, slow push-in. The owner wraps the clean paw in the grey microfiber towel from the reference images and rubs it dry while the relaxed golden retriever sits calmly on the white rug. " +
    "Photorealistic vertical smartphone video, sharp focus, natural colors, realistic hand and paw anatomy, no on-screen text.",
  hook_type: "problem–lösning",
  variant_of: 0,
  audience: "ägare till stora hundar",
  overlays: [{ from: 0, to: 1, text: "Lerig hund igen?" }, { from: 1, to: 2, text: "Ren tass på sekunder" }],
  voiceover: "Trött på leriga tassar? Tasstvättkit för 199 kronor på vardagshoppen.com. De tio första får 10 % extra med koden FORSTA10.",
  info_bar: "Tasstvättkit · kopp + handduk · 199 kr",
  end_card: { headline: "Rena tassar på sekunder", features: ["Mjuka borst", "Handduk ingår"], offer_lines: ["−5 % med koden VALKOMMEN5", "+10 % för de 10 första: FORSTA10"], cta: "Beställ idag" },
  captions: { instagram: "IG-text", facebook: "FB-text", tiktok: "TT-text" },
};
let reviewedConcept = CONCEPT;
let reviewedHookScore = 9;
let ignoreOrders = false; // låtsas att granskaren struntar i beställningen (A/B-krok, variant)
let clipPlan = null;
let ttsFails = false;
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
  info_bar: "Tasstvättkit · 199 kr",
  end_card: { headline: "Rena tassar på sekunder", features: ["Mjuka borst"], offer_lines: ["−5 % med koden VALKOMMEN5"], cta: "Beställ idag" },
  captions: { instagram: "IG-film", facebook: "FB-film", tiktok: "TT-film" },
};

globalThis.fetch = async (input, init = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body ?? null; // FormData (videouppladdning) lämnas som den är
  const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  calls.push({ url, method: init.method ?? "GET", headers, body });

  if (url.startsWith("https://api.anthropic.com/")) {
    const system = body.system;
    if (system.startsWith("Du är researchagent")) {
      // Som en riktig research: mycket text från webbsökningarna.
      // Källa B kom från en sökning men citerades inte – den räknas ändå som läst.
      return claudeText("Utkast", [{ type: "web_search_result_location", url: "https://example.com/a", title: "Källa A", cited_text: "x", encrypted_index: "e" }],
        { model: body.model, usage: { input_tokens: 200_000, output_tokens: 10_000, server_tool_use: { web_search_requests: 12 } },
          content: [
            { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.com/b", title: "Källa B", encrypted_content: "e" }] },
            { type: "text", text: "Utkast", citations: [{ type: "web_search_result_location", url: "https://example.com/a", title: "Källa A", cited_text: "x", encrypted_index: "e" }] },
          ] });
    }
    if (system.startsWith("Du är faktagranskare")) return claudeText("## Så används produkten bäst\n- Doppa och vrid (källa: https://example.com/a)");
    if (system.startsWith("Du är promptagent")) return claudeText(JSON.stringify({ concepts: [CONCEPT, CONCEPT, CONCEPT] }));
    if (system.startsWith("Du är en sträng kvalitetsgranskare")) {
      const final = followOrder(reviewedConcept, body.messages[0].content.at(-1).text);
      return claudeText(JSON.stringify({ reviews: [{ idea: CONCEPT.idea, score: 9, hook_score: reviewedHookScore, problems: "" }], final, score: 9, hook_score: reviewedHookScore, problems: "" }));
    }
    if (system.startsWith("Du är klippagent")) return claudeText(JSON.stringify(clipPlan ?? CLIP_PLAN));
  }
  if (url.startsWith("https://generativelanguage.googleapis.com/")) {
    // Gemini med Google-sökning: platsen för källan räknas i byte, så texten har å, ä och ö.
    // Med Tavily planerar Gemini först sökfrågorna och skriver sedan själv (källa: URL) utifrån träffarna.
    const system = body.systemInstruction.parts[0].text;
    if (system.startsWith("Du planerar webbsökningar")) {
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ queries: ["tasstvätt tips", "paw plunger ad", "tasstvätt recension"] }) }] } }] });
    }
    const first = "Tvätta tassen i ljummet vatten.";
    const grounded = system.startsWith("Du är researchagent") && body.tools;
    const text = !system.startsWith("Du är researchagent")
      ? `## Så används produkten bäst\n- Gemini-faktakollad: ${first}`
      : grounded ? `${first} Torka sedan med handduken.` : `${first} (källa: https://hundtips.se/tassar) Torka sedan med handduken.`;
    return json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP",
      ...(grounded ? { groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "hundtips.se" } }],
        groundingSupports: [{ segment: { endIndex: Buffer.byteLength(first) }, groundingChunkIndices: [0] }],
      } } : {}) }] });
  }
  if (url === "https://api.tavily.com/search") {
    return json({ results: [
      { title: "Tasstips", url: "https://hundtips.se/tassar", content: "Kort utdrag.", raw_content: "Tvätta tassen i ljummet vatten och torka med handduk." },
      { title: "Recension", url: "https://example.com/recension", content: "Kunderna tycker att koppen är för liten för stora hundar." },
    ] });
  }
  if (url.startsWith("https://vertexaisearch.cloud.google.com/")) return new Response(null, { status: 302, headers: { location: "https://hundtips.se/tassar" } });
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
    return new Response(init.method === "HEAD" ? null : fs.readFileSync(sampleImage), { status: 200 });
  }
  if (url === "https://vardagshoppen.com/products/tasstvattkit-sma-och-mellanstora-hundar.json") {
    return json({ product: { image: { src: "https://cdn.shopify.com/s/files/ny-bild.jpg" }, images: [
      { src: "https://cdn.shopify.com/s/files/ny-bild.jpg?v=2" }, { src: "https://cdn.shopify.com/s/files/borsten.jpg" }, { src: "https://cdn.shopify.com/s/files/handduk.jpg" },
    ] } });
  }
  if (url === "https://cdn.higgsfield.test/video.mp4") return new Response(fs.readFileSync(sampleVideo));
  if (url === "https://texttospeech.googleapis.com/v1/text:synthesize") {
    if (ttsFails) return json({ error: { code: 403, message: "API key not valid" } }, 403);
    return json({ audioContent: fs.readFileSync(sampleVoice).toString("base64") });
  }
  if (url.startsWith("https://graph.facebook.com/") || url.startsWith("https://graph-video.facebook.com/")) {
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
const progress = await import("../src/progress.js");
const { progressOf, STAGES } = progress;
const { probe } = await import("../src/editor.js");

test("research → prompt → Higgsfield → video tillbaka → kanalagenterna", async () => {
  const product = activeProduct();
  setQueuedVideos(product.id, 1); // som att trycka Beställ 1 video

  await tick();

  // Researchagenten är klar och har lämnat över till promptagenten.
  assert.equal(progressOf(product.id, "research").status, "done");
  const research = db.prepare("SELECT * FROM research WHERE product_id = ?").get(product.id);
  assert.match(research.notes, /Doppa och vrid/);
  const checkCall = calls.find((c) => c.body?.system?.startsWith?.("Du är faktagranskare"));
  assert.match(checkCall.body.messages[0].content.at(-1).text, /- Källa A: https:\/\/example\.com\/a\n- Källa B: https:\/\/example\.com\/b/);
  assert.match(research.notes, /^Lästa källor: 2 \(sökning med Claude\)\./);

  // Promptagenten fick researchen och skickade prompten + produktbilden till Higgsfield.
  const ideaCall = calls.find((c) => c.url.startsWith("https://api.anthropic.com/") && c.body.system.startsWith("Du är promptagent"));
  assert.match(JSON.stringify(ideaCall.body.messages), /Doppa och vrid/, "promptagenten fick researchen");
  const hf = calls.find((c) => c.url.endsWith("/reference-to-video"));
  assert.equal(hf.method, "POST");
  assert.equal(hf.headers.get("Authorization"), "Key test-id:test-secret");
  assert.equal(hf.body.prompt, CONCEPT.video_prompt);
  // Den gamla produktbilden var borttagen i Shopify, så den nya hämtades från butiken.
  // Alla produktbilder skickas med (huvudbilden först, utan dubletter), så att videomodellen ser koppen, borsten och handduken.
  assert.deepEqual(hf.body.image_urls, ["https://cdn.shopify.com/s/files/ny-bild.jpg", "https://cdn.shopify.com/s/files/borsten.jpg", "https://cdn.shopify.com/s/files/handduk.jpg"]);
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
  // Det som saknades i den dåliga annonsen: slutbilden visar produkten (röd provbild) på grön bakgrund med pris.
  const finalFile = path.join(dataDir, "media", video.local_file);
  const [r, g, b] = colorAt(finalFile, 4.5, [300, 260, 210, 500]);
  assert.ok(r > 180 && g < 90 && b < 90, `produktbilden syns mitt i slutbilden (${r},${g},${b})`);
  const [, bg] = colorAt(finalFile, 4.5, [40, 40, 20, 600]);
  assert.ok(bg > 30 && bg < 80, "grön bakgrund i slutbilden");
  // Under själva videon ligger priset uppe till höger (grön ruta) ovanpå videon.
  const [pr, pg, pb] = colorAt(finalFile, 1.8, [60, 30, 600, 60]);
  assert.ok(pg > pr && pg > pb, `prisrutan syns uppe till höger (${pr},${pg},${pb})`);
  // Produktraden längst ner (grön ruta med vit text) under hela videon.
  const [ir, ig, ib] = colorAt(finalFile, 1.8, [500, 50, 110, 1190]);
  assert.ok(ig > ir && ig > ib, `produktraden syns längst ner (${ir},${ig},${ib})`);
  assert.equal(JSON.parse(video.edit).info_bar, CONCEPT.info_bar);
  const tts = calls.find((c) => c.url.startsWith("https://texttospeech.googleapis.com/"));
  assert.equal(tts.body.input.text, CONCEPT.voiceover);
  assert.equal(tts.body.voice.languageCode, "sv-SE");
  assert.match(video.idea, /Röst: "Trött på leriga tassar/);
  assert.equal(progressOf(product.id, "prompt").status, "done");
  // Redigeringsagenten har gett videon sin sista touch.
  assert.equal(progressOf(product.id, "polish").status, "done");

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
  // Videofilen laddas upp direkt (Meta hämtar den inte från en adress).
  assert.ok(fbCall.url.startsWith("https://graph-video.facebook.com/"));
  assert.ok(fbCall.body.get("source").size > 0, "videofilen skickades med");
  assert.equal(fbCall.body.get("description"), "FB-text");
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

test("Kostnaden för varje Claude-anrop sparas och visas per jobb", async () => {
  const { spendSummary, estimateSek } = await import("../src/costs.js");
  const research = db.prepare("SELECT * FROM costs WHERE agent = 'research' ORDER BY id").all();
  assert.ok(research.length >= 2, "båda researchanropen räknas");
  assert.equal(new Set(research.slice(0, 2).map((r) => r.run)).size, 1, "utkast och faktakoll hör till samma jobb");
  // Researchen körs med Sonnet 5.5: 200 000 tokens in à 2 $ + 10 000 ut à 10 $ per miljon + 12 sökningar à 0,01 $ = 0,62 $
  assert.equal(research[0].model, "claude-sonnet-5-5");
  assert.equal(research[0].searches, 12);
  assert.ok(Math.abs(research[0].usd - 0.62) < 1e-9);
  const summary = spendSummary();
  assert.ok(summary.monthSek > 6, "månadens kostnad räknas i kronor");
  assert.ok(summary.byAgent.some((a) => a.agent === "prompt"), "promptagentens anrop räknas också");
  assert.ok(estimateSek("research") >= 6, "uppskattningen bygger på riktiga jobb");
});

test("Månadstaket nått: inga Claude-anrop och kön töms", async () => {
  const { setSetting } = await import("../src/db.js");
  const product = activeProduct();
  setSetting("claude_budget_sek", 1);
  const before = calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length;
  setQueuedVideos(product.id, 1);
  await tick();
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length, before, "inget anrop till Claude");
  assert.equal(queuedVideos(product.id), 0);
  assert.match(db.prepare("SELECT last_error FROM agents WHERE product_id = ? AND kind = 'prompt'").get(product.id).last_error, /tak/);
  setSetting("claude_budget_sek", 0);
});

const { editAndOffer } = await import("../src/agents/prompt.js");

test("Klipparen misslyckas: videon visas inte för godkännande, och kan klippas om gratis", async () => {
  const product = activeProduct();
  videoStatus = "completed";
  // En video utan text och slutbild (som den dåliga annonsen) får inte hamna hos dig för godkännande.
  const { lastInsertRowid } = db.prepare("INSERT INTO videos (product_id, created_at, status, hf_request_id, idea) VALUES (?, ?, 'generating', 'req-1', 'utan text')")
    .run(product.id, new Date().toISOString());
  const id = Number(lastInsertRowid);
  await pollVideos();
  let video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
  assert.equal(video.status, "failed");
  assert.match(video.error, /visas inte för godkännande/);
  assert.equal(video.local_file, null);
  assert.ok(fs.existsSync(path.join(dataDir, "media", video.raw_file)), "Higgsfield-videon finns kvar");

  // Klipp om: ingen ny kostnad hos Claude eller Higgsfield.
  const paid = () => calls.filter((c) => c.url.startsWith("https://api.anthropic.com/") || c.url.includes("higgsfield.ai/alibaba")).length;
  const before = paid();
  db.prepare("UPDATE videos SET edit = ? WHERE id = ?").run(JSON.stringify({ overlays: CONCEPT.overlays, voiceover: CONCEPT.voiceover, info_bar: CONCEPT.info_bar, end_card: CONCEPT.end_card }), id);
  assert.equal(await editAndOffer(db.prepare("SELECT * FROM videos WHERE id = ?").get(id)), true);
  video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
  assert.equal(video.status, "pending");
  assert.equal(paid(), before);
});

test("Berättarrösten fungerar inte: videon blir klar ändå, med text, pris och slutbild", async () => {
  const product = activeProduct();
  ttsFails = true;
  const { lastInsertRowid } = db.prepare("INSERT INTO videos (product_id, created_at, status, hf_request_id, edit) VALUES (?, ?, 'generating', 'req-1', ?)")
    .run(product.id, new Date().toISOString(), JSON.stringify({ overlays: CONCEPT.overlays, voiceover: CONCEPT.voiceover, info_bar: CONCEPT.info_bar, end_card: CONCEPT.end_card }));
  await pollVideos();
  ttsFails = false;
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(lastInsertRowid));
  assert.equal(video.status, "pending");
  assert.match(video.error, /Utan berättarröst: .*403/);
  const finished = await probe(path.join(dataDir, "media", video.local_file));
  assert.ok(finished.duration > 4.5, "slutbilden är med");
});

test("Promptagenten och granskaren vet att tassen ska gnuggas runt i koppen och torkas", async () => {
  const product = activeProduct();
  assert.match(product.focus, /pumpar koppen upp och ner och vrider den flera gånger/);
  assert.match(product.focus, /lindas in i mikrofiberhandduken/);
  assert.match(product.focus, /Att bara doppa tassen/);
  const review = claudeCalls("Du är en sträng kvalitetsgranskare").at(-1);
  assert.match(review.body.system, /på rätt sätt enligt ägarens instruktioner/);
  assert.match(review.body.system, /användning visas tydligt i minst 4 sekunder/);
  assert.match(review.body.system, /Ägarens användningsvideo/);
  assert.match(review.body.system, /snygg och ren reklam/);
  assert.match(review.body.messages[0].content.at(-1).text, /scrub all around the paw/);
});

/** Det ffmpeg skriver om en fil (på stderr), t.ex. storlek och ljudnivå. */
const ffmpegInfo = (...args) => spawnSync(ffmpeg, ["-hide_banner", "-nostats", ...args], { encoding: "utf8" }).stderr;
/** Ljudnivån i LUFS, som TikTok och Instagram mäter den. */
const lufs = (file) => Number(ffmpegInfo("-i", file, "-af", "ebur128", "-f", "null", "-").match(/Integrated loudness:\s+I:\s+(-?[\d.]+)/)[1]);

test("Redigeringsagenten: skarpare bild i 720×1280 och jämn ljudnivå, gratis, och kan stängas av", async () => {
  const { polishLook, polishSound } = await import("../src/polish.js");
  const { setSetting } = await import("../src/db.js");
  const media = path.join(dataDir, "media");
  // Bilden: den lilla provfilmen (480×854) skalas upp mjukt till 720×1280, och ljudet följer med.
  const looked = path.join(media, "polish-look.mp4");
  await polishLook(sampleVideo, looked);
  assert.match(ffmpegInfo("-i", looked), /Video: h264.*720x1280/);
  assert.ok((await probe(looked)).hasAudio);
  // Ljudet: en svag ton lyfts till ungefär −14 LUFS, samma nivå som sociala medier använder.
  const quiet = path.join(media, "polish-quiet.mp4");
  execFileSync(ffmpeg, ["-v", "error", "-y", "-i", sampleVideo, "-af", "volume=-25dB", "-c:v", "copy", "-c:a", "aac", quiet]);
  assert.ok(lufs(quiet) < -30, `före: ${lufs(quiet)}`);
  await polishSound(quiet);
  assert.ok(Math.abs(lufs(quiet) + 14) < 2.5, `efter: ${lufs(quiet)} LUFS`);

  // Avstängd: videon klipps utan sista touch, och redigeringsagenten rör den inte.
  const product = activeProduct();
  setSetting("polish", false);
  progress.stopped(product.id, "polish", "");
  const { lastInsertRowid } = db.prepare("INSERT INTO videos (product_id, created_at, status, raw_file, edit) VALUES (?, ?, 'failed', ?, ?)")
    .run(product.id, new Date().toISOString(), path.basename(looked), JSON.stringify({ overlays: CONCEPT.overlays, info_bar: CONCEPT.info_bar, end_card: CONCEPT.end_card }));
  assert.equal(await editAndOffer(db.prepare("SELECT * FROM videos WHERE id = ?").get(Number(lastInsertRowid))), true);
  assert.equal(progressOf(product.id, "polish").status, "stopped");
  setSetting("polish", true);
});

test("Provklippet när servern startar visar att klipparen fungerar", async () => {
  const { selfCheck } = await import("../src/editor.js");
  assert.deepEqual(await selfCheck(path.join(dataDir, "media")), { ok: true });
});

test("Gemini med Googles egen sökning (betalning påslagen): källorna får riktiga adresser", async () => {
  const { runResearch, latestResearch } = await import("../src/agents/research.js");
  const product = activeProduct();
  const costsBefore = db.prepare("SELECT COUNT(*) AS n FROM costs").get().n;
  const claudeBefore = calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length;
  process.env.GEMINI_API_KEY = "gemini-key";
  try {
    await runResearch(product);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
  assert.match(latestResearch(product.id).notes, /Gemini-faktakollad/);
  const geminiCalls = calls.filter((c) => c.url.startsWith("https://generativelanguage.googleapis.com/"));
  assert.equal(geminiCalls.length, 2, "utkast och faktakoll");
  assert.ok(geminiCalls.every((c) => c.url.includes("gemini-3.8-flash:generateContent") && c.headers.get("x-goog-api-key") === "gemini-key"));
  assert.deepEqual(geminiCalls[0].body.tools, [{ google_search: {} }]);
  // Researchen letar också efter svenska kunders klagomål, invändningar och ord.
  assert.match(geminiCalls[0].body.contents[0].parts[0].text, /Svenska kunders röst/);
  assert.match(geminiCalls[1].body.contents[0].parts[0].text, /## Det här tar vi med oss[\s\S]*## Kundernas röst/);
  // Faktakollen fick utkastet med källan på rätt plats och den riktiga adressen, inte Googles omdirigering.
  const checkPrompt = geminiCalls[1].body.contents[0].parts[0].text;
  assert.match(checkPrompt, /Tvätta tassen i ljummet vatten\. \(källa: https:\/\/hundtips\.se\/tassar\) Torka/);
  assert.match(checkPrompt, /- hundtips\.se: https:\/\/hundtips\.se\/tassar/);
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length, claudeBefore, "Claude anropades inte");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM costs").get().n, costsBefore, "ingen kostnad");
});

test("Med GEMINI_API_KEY och TAVILY_API_KEY görs researchen helt gratis: Tavily söker och Gemini läser träffarna", async () => {
  const { runResearch, latestResearch } = await import("../src/agents/research.js");
  const product = activeProduct();
  const costsBefore = db.prepare("SELECT COUNT(*) AS n FROM costs").get().n;
  const geminiBefore = calls.filter((c) => c.url.startsWith("https://generativelanguage.googleapis.com/")).length;
  const claudeBefore = calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length;
  Object.assign(process.env, { GEMINI_API_KEY: "gemini-key", TAVILY_API_KEY: "tvly-key" });
  try {
    await runResearch(product);
  } finally {
    delete process.env.GEMINI_API_KEY;
    delete process.env.TAVILY_API_KEY;
  }
  assert.match(latestResearch(product.id).notes, /Gemini-faktakollad/);
  const geminiCalls = calls.filter((c) => c.url.startsWith("https://generativelanguage.googleapis.com/")).slice(geminiBefore);
  assert.equal(geminiCalls.length, 4, "sökplan + utkast, sökplan + faktakoll");
  assert.ok(geminiCalls.every((c) => !c.body.tools), "Googles sökning används inte (den kostar på gratisnivån)");
  const tavily = calls.filter((c) => c.url === "https://api.tavily.com/search");
  assert.equal(tavily.length, 6, "tre sökningar per steg");
  assert.equal(tavily[0].headers.get("authorization"), "Bearer tvly-key");
  // Utkastet byggde på träffarna, och bara källor som faktiskt citerades skickades vidare till faktakollen.
  assert.match(geminiCalls[1].body.contents[0].parts[0].text, /URL: https:\/\/hundtips\.se\/tassar\nTvätta tassen i ljummet vatten och torka/);
  const checkPrompt = geminiCalls[3].body.contents[0].parts[0].text;
  // Alla lästa sidor går vidare till faktakollen, med sidans egen text som utdrag (inte bara de citerade).
  assert.equal(tavily[0].body.include_raw_content, "text");
  assert.match(checkPrompt, /- Tasstips: https:\/\/hundtips\.se\/tassar\n  Utdrag: Tvätta tassen i ljummet vatten och torka med handduk\./);
  assert.match(checkPrompt, /- Recension: https:\/\/example\.com\/recension\n  Utdrag: Kunderna tycker/);
  assert.match(latestResearch(product.id).notes, /^Lästa källor: 2 \(sökning med Tavily, 3 sökningar\)\./);
  assert.equal(calls.filter((c) => c.url.startsWith("https://api.anthropic.com/")).length, claudeBefore, "Claude anropades inte");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM costs").get().n, costsBefore, "ingen kostnad");
});

test("Sökningen ger inga träffar: researchen stoppas med ett tydligt fel och den förra rapporten ligger kvar", async () => {
  const { runResearch, latestResearch } = await import("../src/agents/research.js");
  const product = activeProduct();
  const before = latestResearch(product.id);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input) === "https://api.tavily.com/search"
    ? new Response(JSON.stringify({ detail: { error: "This request exceeds your plan's set usage limit." } }), { status: 432 })
    : realFetch(input, init);
  Object.assign(process.env, { GEMINI_API_KEY: "gemini-key", TAVILY_API_KEY: "tvly-key" });
  try {
    await assert.rejects(runResearch(product), /Sökningen gav inga träffar \(3 sökningar\): Tavily svarade 432: This request exceeds/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.TAVILY_API_KEY;
  }
  assert.equal(latestResearch(product.id).id, before.id, "ingen tom rapport sparades");
});

test("Gemini överbelastad (503): researchen försöker igen och byter till den mindre modellen", async () => {
  const { runResearch, latestResearch } = await import("../src/agents/research.js");
  const product = activeProduct();
  const before = calls.length;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("/gemini-3.8-flash:")
    ? (calls.push({ url: String(input) }), new Response(JSON.stringify({ error: { message: "This model is currently experiencing high demand." } }), { status: 503 }))
    : realFetch(input, init);
  Object.assign(process.env, { GEMINI_API_KEY: "gemini-key", TAVILY_API_KEY: "tvly-key" });
  try {
    await runResearch(product);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_API_KEY;
    delete process.env.TAVILY_API_KEY;
  }
  assert.match(latestResearch(product.id).notes, /Gemini-faktakollad/);
  const gemini = calls.slice(before).filter((c) => c.url.startsWith("https://generativelanguage.googleapis.com/"));
  assert.equal(gemini.filter((c) => c.url.includes("/gemini-3.8-flash:")).length, 12, "3 försök per anrop, 4 anrop");
  assert.equal(gemini.filter((c) => c.url.includes("/gemini-3.5-flash-lite:")).length, 4, "den mindre modellen klarade alla 4");
});

test("Kundernas röst plockas ut ur researchen, så att svarsagenten kan bemöta vanliga invändningar", async () => {
  const { researchSection } = await import("../src/agents/research.js");
  const notes = "## Det här tar vi med oss\n- Lerig tass först\n## Kundernas röst\n- Invändning: Passar den stora hundar? (källa: https://example.com/r)\n## Verifierade fakta\n- x";
  assert.equal(researchSection(notes, "Kundernas röst"), "- Invändning: Passar den stora hundar? (källa: https://example.com/r)");
  assert.equal(researchSection(notes, "Finns inte"), "");
  assert.equal(researchSection(undefined, "Kundernas röst"), "");
});

test("Videoprompten kontrolleras: utan scener och utan tydlig användning beställs ingen video", async () => {
  const { videoPromptProblems } = await import("../src/agents/prompt.js");
  const product = activeProduct();
  assert.deepEqual(videoPromptProblems(CONCEPT.video_prompt, product), []);
  const dipOnly = "Shot 1 (0-3s): A muddy paw near a white rug in a bright home, from the reference images. " +
    "Shot 2 (3-5s): The owner dips the paw in the cup and lifts it out. Shot 3 (5-10s): A happy dog on the rug. " + "Calm natural daylight. ".repeat(20);
  const problems = videoPromptProblems(dipOnly, product);
  assert.ok(problems.some((p) => /visar inte hur koppen används/.test(p)), problems.join(" "));
  assert.ok(problems.some((p) => /handduken/.test(p)));
  assert.ok(videoPromptProblems("A dog with a cup.", product).some((p) => /2–3 scener/.test(p)));

  // Granskarens slutversion med en dålig prompt: Higgsfield anropas inte.
  db.prepare("UPDATE videos SET status = 'rejected' WHERE status = 'generating'").run();
  reviewedConcept = { ...CONCEPT, video_prompt: dipOnly };
  const before = calls.filter((c) => c.url.endsWith("/reference-to-video")).length;
  setQueuedVideos(product.id, 1);
  await tick();
  reviewedConcept = CONCEPT;
  assert.equal(calls.filter((c) => c.url.endsWith("/reference-to-video")).length, before, "Higgsfield anropades inte");
});

test("Videomodellen går att byta, och priset räknas med", async () => {
  const { setSetting } = await import("../src/db.js");
  const { videoModel, videoModelSek, VIDEO_MODELS } = await import("../src/higgsfield.js");
  assert.equal(videoModel(), "alibaba/wan-3.0/reference-to-video", "standard är oförändrad");
  setSetting("video_model", "bytedance/seedance-2.0/reference-to-video");
  assert.equal(videoModelSek(), VIDEO_MODELS["bytedance/seedance-2.0/reference-to-video"].sek);
  setSetting("video_model", "finns-inte");
  assert.equal(videoModel(), "alibaba/wan-3.0/reference-to-video", "okänd modell faller tillbaka");
  setSetting("video_model", "alibaba/wan-3.0/reference-to-video");
});

test("Texten under videon hålls kort och mänsklig: långa eller AI-klingande texter stoppas", async () => {
  const { captionProblems } = await import("../src/agents/prompt.js");
  const good = "Leriga tassar? Pumpa, vrid, torka – klart på 10 sekunder. 199 kr på vardagshoppen.com #hund #hundliv";
  assert.deepEqual(captionProblems({ instagram: good, facebook: good, tiktok: good }), []);
  const long = "Är du trött på leriga tassar efter promenaden? ".repeat(5) + "#a #b #c #d #e";
  const problems = captionProblems({ facebook: long, tiktok: "Upptäck hemligheten bakom rena tassar 🐶🐾✨" });
  assert.ok(problems.some((p) => /facebook är \d+ tecken/.test(p)), problems.join(" "));
  assert.ok(problems.some((p) => /5 hashtags/.test(p)));
  assert.ok(problems.some((p) => /tiktok låter AI-skriven/.test(p)));
  assert.ok(problems.some((p) => /3 emojis/.test(p)));
});

test("Kroken: eget krokbetyg och kodkoll av första sekunderna, annars beställs ingen video", async () => {
  const { hookProblems } = await import("../src/agents/prompt.js");
  assert.deepEqual(hookProblems(CONCEPT), []);
  const slow = { ...CONCEPT, overlays: [{ from: 1.5, to: 3, text: "Lerig hund igen?" }],
    video_prompt: CONCEPT.video_prompt.replace("Shot 1 (0-2s): Close-up", "Shot 1 (0-2s): Slow pan establishing shot") };
  const problems = hookProblems(slow);
  assert.ok(problems.some((p) => /direkt på 0 s/.test(p)), problems.join(" "));
  assert.ok(problems.some((p) => /börjar långsamt/.test(p)));

  // Granskaren ger hela idén 9/10 men kroken bara 6/10: Higgsfield anropas inte.
  const product = activeProduct();
  db.prepare("UPDATE videos SET status = 'rejected' WHERE status = 'generating'").run();
  reviewedHookScore = 6;
  const before = calls.filter((c) => c.url.endsWith("/reference-to-video")).length;
  setQueuedVideos(product.id, 1);
  await tick();
  reviewedHookScore = 9;
  assert.equal(calls.filter((c) => c.url.endsWith("/reference-to-video")).length, before, "Higgsfield anropades inte");
});
