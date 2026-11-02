// Berättarrösten. Med ELEVENLABS_API_KEY görs den hos ElevenLabs (mycket mer mänsklig), annars med
// Google Cloud Text-to-Speech (gratis). ElevenLabs-krediterna är få (10 000 per månad på gratisplanen), så:
// - billigaste modellen (Flash v2.5: 0,5 kredit per tecken, en annonsröst på ca 180 tecken ≈ 90 krediter)
// - varje ljud sparas, så samma text med samma röst och takt görs aldrig om (Klipp om blir gratis)
// - ett månadstak: när taket är nått görs rösten med Google i stället (gratis), aldrig mer ElevenLabs
// - inget görs automatiskt: bara när en beställd video klipps, eller när du klipper om med ny text
// - provlyssning och kontrollen när servern startar kostar inga krediter
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db, now, getSetting, MEDIA_DIR } from "./db.js";

const GOOGLE_API = "https://texttospeech.googleapis.com/v1/text:synthesize";
const EL_API = "https://api.elevenlabs.io/v1";
export const EL_MODEL = process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5";
const creditsPerChar = (model = EL_MODEL) => (/flash|turbo/.test(model) ? 0.5 : 1);
// En annonsröst är högst 30 ord. Längre texter görs inte hos ElevenLabs (skydd mot att krediterna töms av misstag).
export const EL_MAX_CHARS = Number(process.env.ELEVENLABS_MAX_CHARS || 350);
const CACHE_DIR = path.join(MEDIA_DIR, "voice-cache");

db.exec(`CREATE TABLE IF NOT EXISTS voice_usage (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  voice TEXT,
  chars INTEGER NOT NULL,
  credits REAL NOT NULL,
  what TEXT
)`);

export const elevenConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY);
export const googleConfigured = () => Boolean(process.env.GOOGLE_TTS_API_KEY);
export const voiceConfigured = () => elevenConfigured() || googleConfigured();
export const voiceProvider = () => (elevenConfigured() ? "elevenlabs" : "google");

// Egna röster, designade i Vardagshoppens ElevenLabs-konto (Voice Design). De fungerar via nyckeln även på gratisplanen.
// Provet hämtas från kontot (gratis).
export const OWN_VOICES = {
  "l1iNkIoIkS6iWcpRwB4J": { name: "Vardagshoppen 1 · kvinna, varm och lugn (egen röst)", own: true },
  "1ea9ipG3XUIaIcYOe0oU": { name: "Vardagshoppen 2 · kvinna, varm och lugn (egen röst)", own: true },
  "PeyckxHZ7dK2og1XssBY": { name: "Vardagshoppen 3 · kvinna, varm och lugn (egen röst)", own: true },
};
// Svenska röster från ElevenLabs röstbibliotek (infödda svenskar). Provlyssningen är deras egna gratis prov.
// Gratisplanen får inte använda biblioteksröster via nyckeln (svarar 402), bara med betalplan.
const LIBRARY_VOICES = {
  "4xkUqaR9MYOJHoaC1Nak": { name: "Sanna · kvinna, glad och vardaglig", preview: "https://storage.googleapis.com/eleven-public-prod/custom/voices/4xkUqaR9MYOJHoaC1Nak/l4PwfhXHwvKzA0G9XP46.mp3" },
  "kPdGSxhZAqy4bmPAf9iJ": { name: "Evelina · kvinna, lugn och varm", preview: "https://storage.googleapis.com/eleven-public-prod/database/user/oNCvJMp3mXbjhQO8EcgVSRoZEv12/voices/kPdGSxhZAqy4bmPAf9iJ/A2ZEj9HQDCioeYPZqwL4.mp3" },
  "QLfvbukvQvrPOx9HXQ3x": { name: "Louise · kvinna, vänlig", preview: "https://storage.googleapis.com/eleven-public-prod/database/user/oNCvJMp3mXbjhQO8EcgVSRoZEv12/voices/QLfvbukvQvrPOx9HXQ3x/ejyOuFwPynyshE2fi2cq.mp3" },
  "4Ct5uMEndw4cJ7q0Jx0l": { name: "Elin · kvinna, tydlig", preview: "https://storage.googleapis.com/eleven-public-prod/database/user/gzzlgU2eOCM4mGVeLO7E5zVABNH3/voices/4Ct5uMEndw4cJ7q0Jx0l/5c2e97c0-0656-47c7-8ed3-edb586056f26.mp3" },
  "a2RZfOPKpyNO38vDv3DD": { name: "Annie · kvinna, lugn reklamröst", preview: "https://storage.googleapis.com/eleven-public-prod/database/user/Nwn2wV6asWcmpAiLdI1YPgnnkJH2/voices/a2RZfOPKpyNO38vDv3DD/GxOemTuA4J9cWq6Zzels.mp3" },
  "aSLKtNoVBZlxQEMsnGL2": { name: "Sanna · kvinna, mjuk berättare", preview: "https://storage.googleapis.com/eleven-public-prod/custom/voices/aSLKtNoVBZlxQEMsnGL2/g7yysxvG83AAWczMihDs.mp3" },
  "x0u3EW21dbrORJzOq1m9": { name: "Adam · man, djup och lugn", preview: "https://storage.googleapis.com/eleven-public-prod/Clk6kdJ10yNzb14pOOqXKi1y5qW2/voices/x0u3EW21dbrORJzOq1m9/ffda0752-26f1-4341-8f31-161771679941.mp3" },
  "6eknYWL7D5Z4nRkDy15t": { name: "Tommy · man, varm", preview: "https://storage.googleapis.com/eleven-public-prod/database/user/OxzjVs83YRcaNqdHRbfyP7zir7f1/voices/6eknYWL7D5Z4nRkDy15t/DJmKx32l40yW3NuIHHf8.mp3" },
  "oJEeOXECH9V31Oci9WHK": { name: "Peter · man, reklamröst (skånsk)", preview: "https://storage.googleapis.com/eleven-public-prod/database/user/4zyOZkjQKNWKGaXK4WckvDaRjsE2/voices/oJEeOXECH9V31Oci9WHK/pFc3wHot7db0LfM0zWDk.mp3" },
};
export const EL_VOICES = { ...OWN_VOICES, ...LIBRARY_VOICES };
const EL_DEFAULT = process.env.ELEVENLABS_VOICE || "l1iNkIoIkS6iWcpRwB4J";
// Gratisplanen: biblioteksrösterna fungerar inte via nyckeln.
const freePlan = () => account.value?.tier === "free";
const usable = (id) => Boolean(EL_VOICES[id]) && (EL_VOICES[id].own || !freePlan());

// Svenska röster hos Google (Chirp 3 HD, gratis upp till 1 miljon tecken per månad).
export const GOOGLE_VOICES = {
  "sv-SE-Chirp3-HD-Aoede": "Aoede · kvinna, lugn",
  "sv-SE-Chirp3-HD-Kore": "Kore · kvinna, tydlig",
  "sv-SE-Chirp3-HD-Leda": "Leda · kvinna, ung och glad",
  "sv-SE-Chirp3-HD-Zephyr": "Zephyr · kvinna, ljus",
  "sv-SE-Chirp3-HD-Despina": "Despina · kvinna, mjuk",
  "sv-SE-Chirp3-HD-Sulafat": "Sulafat · kvinna, varm",
  "sv-SE-Chirp3-HD-Charon": "Charon · man, lugn",
  "sv-SE-Chirp3-HD-Puck": "Puck · man, glad",
  "sv-SE-Chirp3-HD-Orus": "Orus · man, stadig",
  "sv-SE-Chirp3-HD-Iapetus": "Iapetus · man, tydlig",
};
const GOOGLE_DEFAULT = process.env.TTS_VOICE || "sv-SE-Chirp3-HD-Aoede";

/** Rösterna som går att välja just nu: id → namn. */
export function voiceNames() {
  if (!elevenConfigured()) return GOOGLE_VOICES;
  return Object.fromEntries(Object.entries(EL_VOICES).map(([id, v]) => [id, usable(id) ? v.name : `${v.name} (kräver betalplan)`]));
}
export function chosenVoice() {
  if (elevenConfigured()) {
    const voice = getSetting("el_voice", EL_DEFAULT);
    return usable(voice) ? voice : EL_DEFAULT;
  }
  const voice = getSetting("tts_voice", GOOGLE_DEFAULT);
  return GOOGLE_VOICES[voice] ? voice : GOOGLE_DEFAULT;
}
/** Inställningen som sparar valet: ElevenLabs- och Google-valet sparas var för sig. */
export const voiceSettingKey = () => (elevenConfigured() ? "el_voice" : "tts_voice");
/** Provet för en röst: bibliotekets eget, eller för egna röster provet som ElevenLabs sparade (gratis att hämta). */
const previews = {};
export async function elevenPreviewUrl(id) {
  if (!EL_VOICES[id]) return null;
  if (EL_VOICES[id].preview) return EL_VOICES[id].preview;
  if (previews[id] && Date.now() - previews[id].at < 30 * 60_000) return previews[id].url;
  const res = await fetch(`${EL_API}/voices/${encodeURIComponent(id)}`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  const body = await res.json().catch(() => ({}));
  const url = res.ok ? body.preview_url : null;
  previews[id] = { at: Date.now(), url: url || null };
  return url || null;
}

// Hur fort rösten pratar. 1 = vanlig takt. Lite snabbare känns ofta mer som reklam på TikTok.
// En lista, eftersom ett objekt skulle lägga "1" först.
export const SPEED_LIST = [["0.9", "Lugn"], ["1", "Normal"], ["1.1", "Lite snabbare"], ["1.2", "Snabb"]];
export const SPEEDS = Object.fromEntries(SPEED_LIST);
export function chosenSpeed() {
  const speed = String(getSetting("tts_speed", "1"));
  return SPEEDS[speed] ? speed : "1";
}

/** Månadstaket för ElevenLabs i krediter. Standard 9 000 av 10 000, så att det alltid finns lite kvar. */
export const elevenCap = () => Number(getSetting("el_cap_credits", Number(process.env.ELEVENLABS_MONTHLY_CREDITS || 9000)));
const monthStartIso = () => `${new Date().toISOString().slice(0, 8)}01T00:00:00.000Z`;
export const elevenUsedThisMonth = () =>
  db.prepare("SELECT COALESCE(SUM(credits), 0) AS c FROM voice_usage WHERE provider = 'elevenlabs' AND at >= ?").get(monthStartIso()).c;
export const elevenCostOf = (text) => Math.ceil(speakable(text).length * creditsPerChar());

// Kontot hos ElevenLabs (gratis att fråga). Sparas en kort stund så att kontrollsidan inte frågar hela tiden.
let account = { at: 0, value: null };
export async function elevenAccount({ fresh = false } = {}) {
  if (!elevenConfigured()) return null;
  if (!fresh && Date.now() - account.at < 5 * 60_000) return account.value;
  try {
    const res = await fetch(`${EL_API}/user/subscription`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
    const body = await res.json().catch(() => ({}));
    account = {
      at: Date.now(),
      value: res.ok
        ? { ok: true, used: body.character_count, limit: body.character_limit, tier: body.tier, resetsAt: body.next_character_count_reset_unix ? new Date(body.next_character_count_reset_unix * 1000).toISOString() : null }
        : { ok: res.status !== 401 || /permission/i.test(JSON.stringify(body)), status: res.status, error: elevenError(res.status, body) },
    };
  } catch (err) {
    account = { at: Date.now(), value: { ok: false, error: err.message } };
  }
  return account.value;
}

function elevenError(status, body) {
  const detail = body?.detail;
  const message = typeof detail === "string" ? detail : detail?.message || JSON.stringify(body).slice(0, 300);
  const missing = /missing the permission (\w+)/.exec(message)?.[1];
  if (missing) return `ElevenLabs-nyckeln saknar behörigheten ${missing === "text_to_speech" ? "Text to Speech" : missing}. Ändra nyckeln på elevenlabs.io under Developers → API keys (sätt den till Access), eller gör en ny och byt ELEVENLABS_API_KEY i Railway`;
  if (status === 401) return `ElevenLabs tog inte emot nyckeln (${message}). Kolla ELEVENLABS_API_KEY i Railway.`;
  return `ElevenLabs svarade ${status}: ${message}`;
}

async function elevenSpeech(text, voice, speed) {
  const res = await fetch(`${EL_API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: EL_MODEL,
      language_code: "sv",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: Number(speed) },
    }),
  });
  if (!res.ok) {
    const err = new Error(elevenError(res.status, await res.json().catch(() => ({}))));
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function googleSpeech(text, voice, speed) {
  const res = await fetch(GOOGLE_API, {
    method: "POST",
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_TTS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "sv-SE", name: voice },
      audioConfig: { audioEncoding: "MP3", speakingRate: Number(speed) },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.audioContent) throw new Error(`Google Text-to-Speech svarade ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return Buffer.from(body.audioContent, "base64");
}

/** Google-rösten direkt (gratis). Används för provlyssning när ElevenLabs inte är kopplat. */
export const synthesizeGoogle = (text, voice = chosenVoice(), speed = chosenSpeed()) => googleSpeech(text, voice, speed);

const cacheFile = (provider, voice, speed, text) => {
  const key = crypto.createHash("sha256").update([provider, provider === "elevenlabs" ? EL_MODEL : "", voice, speed, text].join("\n")).digest("hex").slice(0, 32);
  return path.join(CACHE_DIR, `${provider}-${key}.mp3`);
};

/**
 * Gör berättarrösten till en annons. Samma text, röst och takt återanvänds från disken (gratis).
 * ElevenLabs används så länge månadstaket räcker; annars Google (gratis) om den nyckeln finns.
 * Returnerar { file, provider, credits, cached, temp, note } där note säger varför ElevenLabs inte användes.
 */
export async function makeVoice(rawText, { what = "" } = {}) {
  const text = speakable(rawText).trim();
  const speed = chosenSpeed();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let note = null;

  if (elevenConfigured()) {
    const voice = chosenVoice();
    const file = cacheFile("elevenlabs", voice, speed, text);
    if (fs.existsSync(file)) return { file, provider: "elevenlabs", credits: 0, cached: true, note };
    const credits = Math.ceil(text.length * creditsPerChar());
    const live = await elevenAccount();
    const liveLeft = live?.limit != null ? live.limit - live.used : Infinity;
    if (text.length > EL_MAX_CHARS) note = `rösttexten är ${text.length} tecken, max ${EL_MAX_CHARS} hos ElevenLabs`;
    else if (elevenUsedThisMonth() + credits > elevenCap()) note = `månadstaket för ElevenLabs (${elevenCap()} krediter) är nått`;
    else if (credits > liveLeft) note = `bara ${liveLeft} krediter kvar hos ElevenLabs`;
    else {
      try {
        fs.writeFileSync(file, await elevenSpeech(text, voice, speed));
        db.prepare("INSERT INTO voice_usage (at, provider, voice, chars, credits, what) VALUES (?, 'elevenlabs', ?, ?, ?, ?)")
          .run(now(), EL_VOICES[voice]?.name.split(" ·")[0] ?? voice, text.length, credits, what);
        account.at = 0; // nästa titt på kontrollsidan hämtar det nya saldot
        return { file, provider: "elevenlabs", credits, cached: false, note };
      } catch (err) {
        if (!googleConfigured()) throw err;
        note = err.status === 402 || /paid|plan|library/i.test(err.message)
          ? `ElevenLabs tillåter inte den här rösten på ert konto (${err.message})`
          : err.message;
      }
    }
    if (!googleConfigured()) throw new Error(`Utan röst: ${note}`);
  }

  // Google: gratis, används när ElevenLabs inte är kopplat eller inte räcker till.
  const voice = elevenConfigured() ? GOOGLE_DEFAULT : chosenVoice();
  // Den sparas inte (den är gratis); temp = filen ska tas bort när videon är klippt.
  const file = path.join(CACHE_DIR, `google-tmp-${crypto.randomBytes(8).toString("hex")}.mp3`);
  fs.writeFileSync(file, await googleSpeech(text, voice, speed));
  db.prepare("INSERT INTO voice_usage (at, provider, voice, chars, credits, what) VALUES (?, 'google', ?, ?, 0, ?)").run(now(), voice, text.length, what);
  return { file, provider: "google", credits: 0, cached: false, temp: true, note: note && `Google-rösten användes eftersom ${note}` };
}

/** Kontrollen när servern startar. Kostar inga krediter: ElevenLabs tillfrågas bara om kontot. */
export async function checkVoice() {
  if (elevenConfigured()) {
    const acc = await elevenAccount({ fresh: true });
    if (!acc?.ok) return { ok: false, error: acc?.error ?? "okänt fel" };
    // Får nyckeln göra röster? En tom text nekas alltid (gratis), men en nyckel utan behörigheten nekas först med 401.
    try {
      const res = await fetch(`${EL_API}/text-to-speech/${encodeURIComponent(chosenVoice())}`, {
        method: "POST",
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text: "", model_id: EL_MODEL }),
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: elevenError(res.status, await res.json().catch(() => ({}))) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
    return { ok: true, provider: "elevenlabs" };
  }
  if (!googleConfigured()) return { ok: false, error: "ELEVENLABS_API_KEY (eller GOOGLE_TTS_API_KEY) saknas i Railway" };
  return googleSpeech("Hej", chosenVoice(), "1").then(() => ({ ok: true, provider: "google" }), (err) => ({ ok: false, error: err.message }));
}

/** Det kontrollsidan visar om rösten: vem som gör den, krediter denna månad, taket och de senaste. */
export async function voiceSummary() {
  if (!elevenConfigured()) return { provider: "google" };
  const live = await elevenAccount();
  return {
    provider: "elevenlabs",
    model: EL_MODEL,
    usedThisMonth: Math.round(elevenUsedThisMonth()),
    cap: elevenCap(),
    perVideo: Math.ceil(180 * creditsPerChar()),
    account: live?.limit != null ? { used: live.used, limit: live.limit, resetsAt: live.resetsAt, tier: live.tier } : null,
    recent: db.prepare("SELECT at, provider, voice, chars, credits, what FROM voice_usage ORDER BY id DESC LIMIT 8").all(),
  };
}

/** Om en text redan finns sparad med vald röst och takt (då kostar Klipp om inget). */
export function voiceCached(rawText) {
  if (!elevenConfigured()) return true;
  return fs.existsSync(cacheFile("elevenlabs", chosenVoice(), chosenSpeed(), speakable(rawText).trim()));
}

/**
 * Skriver om det som rösten annars läser konstigt, så att den låter mer som en människa:
 * webbadresser, "kr" och "%". Texten i bild påverkas inte.
 */
export function speakable(text) {
  return String(text)
    .replace(/\b([\p{L}\d-]+)\.(com|se|nu)\b/giu, "$1 punkt $2")
    .replace(/(\d)\s*kr\b/g, "$1 kronor")
    .replace(/(\d)\s*%/g, "$1 procent")
    .replace(/[−–]\s*(\d+ procent)/g, "$1")
    // "kit" läses annars som engelska "kajt": tasstvättkit, kitet → tasstvättkitt, kittet.
    .replace(/(?<!s)kit(et|ets|s)?\b/giu, (m, end = "") => `${m.slice(0, 3)}t${end}`);
}
