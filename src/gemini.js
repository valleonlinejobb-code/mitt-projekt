// Googles Gemini för researchen: gratisnivån räcker, och Google-sökning ingår (ägarens val 2026-10-29).
// Gratis Google-sökning finns bara på Gemini 2.5 Flash och Flash-Lite (500 sökfrågor per dag).
// Utan GEMINI_API_KEY körs researchen med Claude som förut.
const API = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

// Google skickar länkar som går via deras omdirigering och slutar fungera efter ett tag, så vi slår upp den riktiga adressen.
async function realUrl(uri) {
  try {
    const res = await fetch(uri, { method: "HEAD", redirect: "manual" });
    return res.headers.get("location") || uri;
  } catch {
    return uri;
  }
}

/**
 * Skickar en fråga till Gemini och returnerar texten, eller { text, sources } med `withSources`.
 * Med `search` söker Gemini på Google, och varje mening som bygger på en sökning får "(källa: URL)" efter sig.
 */
export async function askGemini({ system, prompt, search = false, withSources = false, model = GEMINI_MODEL }) {
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      ...(search ? { tools: [{ google_search: {} }] } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini svarade ${res.status}: ${body.error?.message ?? JSON.stringify(body).slice(0, 300)}`);
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini gav inget svar (${candidate?.finishReason ?? body.promptFeedback?.blockReason ?? "okänd anledning"})`);

  const grounding = candidate.groundingMetadata ?? {};
  const urls = await Promise.all((grounding.groundingChunks ?? []).map((c) => (c.web?.uri ? realUrl(c.web.uri) : null)));
  const sources = [...new Map(urls.map((url, i) => [url, grounding.groundingChunks[i].web?.title || url])).entries()]
    .filter(([url]) => url).map(([url, title]) => ({ url, title }));

  // Platserna i texten räknas i byte (UTF-8), så källorna sätts in i en Buffer, bakifrån så att platserna inte flyttas.
  let bytes = Buffer.from(text);
  const supports = [...(grounding.groundingSupports ?? [])].sort((a, b) => (b.segment?.endIndex ?? 0) - (a.segment?.endIndex ?? 0));
  for (const s of supports) {
    const cited = [...new Set((s.groundingChunkIndices ?? []).map((i) => urls[i]).filter(Boolean))];
    const end = s.segment?.endIndex;
    if (!cited.length || end == null || end > bytes.length) continue;
    bytes = Buffer.concat([bytes.subarray(0, end), Buffer.from(` (källa: ${cited.join(", ")})`), bytes.subarray(end)]);
  }
  const cited = bytes.toString();
  return withSources ? { text: cited, sources } : cited;
}
