// Googles Gemini för researchen (ägarens val 2026-10-29): själva modellen är gratis på gratisnivån.
// Gemini 2.5 Flash är stängd för nya användare, och på Gemini 3 ingår Google-sökning inte i gratisnivån.
// Därför söker vi med Tavily (1 000 gratis sökningar per månad, inget kort) när TAVILY_API_KEY finns,
// och låter Gemini läsa träffarna. Utan Tavily används Googles egen sökning, som bara fungerar med betalning påslagen.
// Utan GEMINI_API_KEY körs researchen med Claude som förut.
const API = "https://generativelanguage.googleapis.com/v1beta/models";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
export const tavilyConfigured = () => Boolean(process.env.TAVILY_API_KEY);

async function generate(model, body) {
  const res = await fetch(`${API}/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint = body.tools && !tavilyConfigured()
      ? " Google-sökning ingår inte i Geminis gratisnivå. Lägg in TAVILY_API_KEY i Railway, så söker researchen gratis med Tavily."
      : "";
    throw new Error(`Gemini svarade ${res.status}: ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}${hint}`);
  }
  const candidate = json.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini gav inget svar (${candidate?.finishReason ?? json.promptFeedback?.blockReason ?? "okänd anledning"})`);
  return { text, candidate };
}

const ask = (model, system, prompt, extra = {}) =>
  generate(model, { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], ...extra });

// ---------- Sökning med Tavily ----------

async function tavilySearch(query) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
    // Sidans text följer med (samma pris, 1 sökning), så att Gemini läser källan och inte bara ett kort utdrag.
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_raw_content: "text" }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Tavily svarade ${res.status}: ${json.detail?.error ?? json.error ?? JSON.stringify(json).slice(0, 200)}`);
  return json.results ?? [];
}

// Gemini skriver sökfrågorna, Tavily söker, och Gemini skriver svaret utifrån träffarna med (källa: URL).
async function askWithTavily({ model, system, prompt, maxSearches }) {
  const { text: plan } = await ask(model,
    "Du planerar webbsökningar åt en researcher. Skriv korta, olika sökfrågor (svenska eller engelska) som tillsammans täcker uppgiften.",
    `Uppgift:\n${prompt}\n\nSkriv högst ${maxSearches} sökfrågor.`,
    { generationConfig: { responseMimeType: "application/json", responseSchema: {
      type: "OBJECT", properties: { queries: { type: "ARRAY", items: { type: "STRING" } } }, required: ["queries"],
    } } });
  const queries = (JSON.parse(plan).queries ?? []).slice(0, maxSearches);
  // En sökning som misslyckas stoppar inte de andra.
  const settled = await Promise.allSettled(queries.map(tavilySearch));
  const results = [...new Map(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))
    .filter((r) => r.url).map((r) => [r.url, { ...r, text: (r.raw_content || r.content || "").replace(/\s+/g, " ").trim() }])).values()]
    .filter((r) => r.text);
  // Utan träffar blir rapporten tom gissning, så då stoppas researchen med ett tydligt fel.
  if (!results.length) {
    const failed = settled.find((s) => s.status === "rejected");
    throw new Error(`Sökningen gav inga träffar (${queries.length} sökningar)${failed ? `: ${failed.reason.message}` : ""}`);
  }
  const found = results.map((r) => `### ${r.title || r.url}\nURL: ${r.url}\n${r.text.slice(0, 2500)}`).join("\n\n");
  const { text } = await ask(model,
    `${system}\nDu har bara de här sökträffarna att gå på. Skriv (källa: URL) direkt efter varje påstående som bygger på en träff, med träffens exakta URL.`,
    `${prompt}\n\nSökträffar (${queries.length} sökningar):\n\n${found || "(inga träffar)"}`);
  // Alla sidor som lästes är källor, med ett utdrag så att faktakollen kan jämföra påståendena med vad sidan säger.
  // Citerade sidor får ett längre utdrag, så att siffrorna i rapporten går att hitta i det.
  const sources = results.map((r) => ({ url: r.url, title: r.title || r.url, excerpt: r.text.slice(0, text.includes(r.url) ? 2000 : 400) }));
  return { text, sources, searches: queries.length };
}

// ---------- Sökning med Google (kräver betalning påslagen) ----------

// Google skickar länkar som går via deras omdirigering och slutar fungera efter ett tag, så vi slår upp den riktiga adressen.
async function realUrl(uri) {
  try {
    const res = await fetch(uri, { method: "HEAD", redirect: "manual" });
    return res.headers.get("location") || uri;
  } catch {
    return uri;
  }
}

async function askWithGoogle({ model, system, prompt }) {
  const { text, candidate } = await ask(model, system, prompt, { tools: [{ google_search: {} }] });
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
  return { text: bytes.toString(), sources };
}

/**
 * Skickar en fråga till Gemini och returnerar texten, eller { text, sources } med `withSources`.
 * Med `search` söker den på webben (Tavily om nyckeln finns, annars Google), och påståenden får "(källa: URL)".
 */
export async function askGemini({ system, prompt, search = false, maxSearches = 6, withSources = false, model = GEMINI_MODEL }) {
  const result = !search
    ? { text: (await ask(model, system, prompt)).text, sources: [] }
    : tavilyConfigured()
      ? await askWithTavily({ model, system, prompt, maxSearches })
      : await askWithGoogle({ model, system, prompt });
  return withSources ? result : result.text;
}
