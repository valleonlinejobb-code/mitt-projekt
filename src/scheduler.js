// Motorn: varje minut kollar den vilka agenter som är påslagna och om de har något att göra.
import { db, now, log, CHANNELS } from "./db.js";
import { researchDue, runResearch } from "./agents/research.js";
import { videoDue, createVideo, pollVideos } from "./agents/prompt.js";
import { postDue, publish, checkInbox } from "./agents/social.js";

const INBOX_EVERY_MS = Number(process.env.INBOX_EVERY_MINUTES || 10) * 60_000;
const lastInboxCheck = {};
const busy = new Set();

/** Kör ett agentjobb, sparar fel på agenten så att de syns på kontrollsidan. */
async function runAgent(product, kind, job) {
  const key = `${product?.id}:${kind}`;
  if (busy.has(key)) return;
  busy.add(key);
  try {
    await job();
    if (product) db.prepare("UPDATE agents SET last_run_at = ?, last_error = NULL WHERE product_id = ? AND kind = ?").run(now(), product.id, kind);
  } catch (err) {
    if (product) db.prepare("UPDATE agents SET last_error = ? WHERE product_id = ? AND kind = ?").run(err.message, product.id, kind);
    log(product?.id ?? null, kind, `Fel: ${err.message}`);
  } finally {
    busy.delete(key);
  }
}

const isRunning = (productId, kind) =>
  Boolean(db.prepare("SELECT running FROM agents WHERE product_id = ? AND kind = ?").get(productId, kind)?.running);

/** "Kör nu"-knappen: gör agentens jobb direkt, även om det redan är gjort idag. */
export function runNow(productId, kind) {
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
  if (!product) throw new Error("Produkten finns inte");
  const jobs = {
    research: () => runResearch(product),
    prompt: () => createVideo(product),
    instagram: () => publish(product, "instagram").then(() => checkInbox("instagram")),
    facebook: () => publish(product, "facebook").then(() => checkInbox("facebook")),
    tiktok: () => publish(product, "tiktok"),
  };
  runAgent(product, kind, jobs[kind]); // körs i bakgrunden
}

export async function tick() {
  await runAgent(null, "videopoll", pollVideos);

  for (const product of db.prepare("SELECT * FROM products").all()) {
    if (isRunning(product.id, "research") && researchDue(product)) {
      await runAgent(product, "research", () => runResearch(product));
    }
    if (isRunning(product.id, "prompt") && videoDue(product)) {
      await runAgent(product, "prompt", () => createVideo(product));
    }
    for (const channel of CHANNELS) {
      if (isRunning(product.id, channel) && postDue(product, channel)) {
        await runAgent(product, channel, () => publish(product, channel));
      }
    }
  }

  // Kommentarer och DM gäller hela kontot, inte en produkt.
  for (const channel of ["instagram", "facebook"]) {
    const anyRunning = db.prepare("SELECT 1 FROM agents WHERE kind = ? AND running = 1").get(channel);
    if (!anyRunning || Date.now() - (lastInboxCheck[channel] ?? 0) < INBOX_EVERY_MS) continue;
    lastInboxCheck[channel] = Date.now();
    await runAgent(null, `inbox-${channel}`, () => checkInbox(channel));
  }
}

export function startScheduler() {
  let running = false;
  const loop = async () => {
    if (running) return;
    running = true;
    try { await tick(); } finally { running = false; }
  };
  setInterval(loop, 60_000);
  setTimeout(loop, 5_000);
}
