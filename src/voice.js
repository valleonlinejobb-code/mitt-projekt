// Berättarrösten: en svensk kvinnoröst från Google Cloud Text-to-Speech.
// De första 1 miljon tecknen per månad är gratis (Chirp 3 HD), och en speakertext är ca 200 tecken.
// Utan GOOGLE_TTS_API_KEY görs videorna utan berättarröst.
const API = "https://texttospeech.googleapis.com/v1/text:synthesize";
import { getSetting } from "./db.js";

// Svenska röster som ägaren kan välja och provlyssna på på kontrollsidan (Chirp 3 HD, samma pris: gratis upp till 1 miljon tecken).
export const VOICES = {
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
const DEFAULT_VOICE = process.env.TTS_VOICE || "sv-SE-Chirp3-HD-Aoede";
export function chosenVoice() {
  const voice = getSetting("tts_voice", DEFAULT_VOICE);
  return VOICES[voice] || voice === DEFAULT_VOICE ? voice : DEFAULT_VOICE;
}

// Hur fort rösten pratar. 1 = Googles vanliga takt. Lite snabbare känns ofta mer som reklam på TikTok.
// En lista, eftersom ett objekt skulle lägga "1" först.
export const SPEED_LIST = [["0.9", "Lugn"], ["1", "Normal"], ["1.1", "Lite snabbare"], ["1.2", "Snabb"]];
export const SPEEDS = Object.fromEntries(SPEED_LIST);
export function chosenSpeed() {
  const speed = String(getSetting("tts_speed", "1"));
  return SPEEDS[speed] ? speed : "1";
}

export const voiceConfigured = () => Boolean(process.env.GOOGLE_TTS_API_KEY);

/** Gör om texten till tal med den valda rösten och takten (eller andra för provlyssning). Returnerar en MP3 som Buffer. */
export async function synthesizeVoice(text, voice = chosenVoice(), speed = chosenSpeed()) {
  const res = await fetch(API, {
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
