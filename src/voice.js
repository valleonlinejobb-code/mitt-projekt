// Berättarrösten: en svensk kvinnoröst från Google Cloud Text-to-Speech.
// De första 1 miljon tecknen per månad är gratis (Chirp 3 HD), och en speakertext är ca 200 tecken.
// Utan GOOGLE_TTS_API_KEY görs videorna utan berättarröst.
const API = "https://texttospeech.googleapis.com/v1/text:synthesize";
const VOICE = process.env.TTS_VOICE || "sv-SE-Chirp3-HD-Aoede";

export const voiceConfigured = () => Boolean(process.env.GOOGLE_TTS_API_KEY);

/** Gör om texten till tal. Returnerar en MP3 som Buffer. */
export async function synthesizeVoice(text) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "X-Goog-Api-Key": process.env.GOOGLE_TTS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: "sv-SE", name: VOICE },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.audioContent) throw new Error(`Google Text-to-Speech svarade ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return Buffer.from(body.audioContent, "base64");
}
