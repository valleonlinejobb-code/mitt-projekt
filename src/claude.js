// Gemensam hjälpfunktion för alla agenter som pratar med Claude.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // läser ANTHROPIC_API_KEY
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/**
 * Skickar en fråga till Claude och returnerar texten (eller JSON om `schema` anges).
 * @param {object} opts
 * @param {string} opts.system
 * @param {string} opts.prompt
 * @param {object} [opts.schema]     JSON-schema för strukturerat svar
 * @param {boolean} [opts.webSearch] låt Claude söka på webben
 * @param {number} [opts.maxSearches] hur många webbsökningar Claude får göra
 * @param {"low"|"medium"|"high"} [opts.effort]
 * @param {(string|{data:string, media_type:string})[]} [opts.images]  bilder som Claude ska titta på (länkar eller base64)
 * @param {boolean} [opts.withSources] returnera { text, sources } med webbsidorna Claude citerade
 */
export async function askClaude({ system, prompt, schema, webSearch = false, maxSearches = 6, effort = "medium", withSources = false, images = [] }) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{
      role: "user",
      content: [
        // En bild är en länk eller { data, media_type } (base64), t.ex. bilder ur en egen film.
        ...images.map((img) => ({ type: "image", source: typeof img === "string" ? { type: "url", url: img } : { type: "base64", ...img } })),
        { type: "text", text: prompt },
      ],
    }],
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  if (webSearch) params.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: maxSearches }];

  let messages = params.messages;
  let response;
  const content = [];
  // Webbsökning kan pausa turen (pause_turn) – då skickar vi tillbaka den så Claude fortsätter.
  for (let i = 0; i < 4; i++) {
    response = await client.beta.messages.create({ ...params, messages });
    content.push(...response.content);
    if (response.stop_reason !== "pause_turn") break;
    messages = [...params.messages, { role: "assistant", content: [...content] }];
  }

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude avböjde: ${response.stop_details?.explanation ?? "okänd anledning"}`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Claudes svar blev för långt och klipptes av");

  const textBlocks = (schema ? response.content : content).filter((b) => b.type === "text");
  const text = textBlocks.map((b) => b.text).join("").trim();
  if (schema) return JSON.parse(text);
  if (!withSources) return text;
  const sources = new Map();
  for (const c of textBlocks.flatMap((b) => b.citations ?? [])) if (c.url) sources.set(c.url, c.title || c.url);
  return { text, sources: [...sources].map(([url, title]) => ({ url, title })) };
}
