// Gemensam hjälpfunktion för alla agenter som pratar med Claude.
import Anthropic from "@anthropic-ai/sdk";
import { recordCost, spentThisMonthSek, claudeBudgetSek } from "./costs.js";

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
 * @param {string} [opts.agent]      vilken agent som frågar (för kostnaden på kontrollsidan)
 * @param {"research"|"video"|"clip"|"reply"} [opts.task]  vilket jobb anropet hör till
 * @param {string} [opts.run]        samma run för alla anrop i ett jobb (se newRun)
 * @param {number} [opts.productId]
 */
export async function askClaude({ system, prompt, schema, webSearch = false, maxSearches = 6, effort = "medium", withSources = false, images = [], agent = "okänd", task = "reply", run = null, productId = null }) {
  // Månadstaket stoppar alla Claude-anrop innan pengarna går åt.
  const budget = claudeBudgetSek();
  if (budget > 0 && spentThisMonthSek() >= budget) {
    throw new Error(`Månadens tak för Claude (${budget} kr) är nått. Höj taket på kontrollsidan om du vill fortsätta.`);
  }
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
  // Varje svar kostar, även fortsättningar och svar som sedan blir fel, så allt räknas ihop och sparas.
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 0 } };
  let model = MODEL;
  try {
    // Webbsökning kan pausa turen (pause_turn) – då skickar vi tillbaka den så Claude fortsätter.
    // Varje fortsättning skickar hela texten igen och kostar lika mycket input som allt dittills.
    for (let i = 0; i < 4; i++) {
      response = await client.beta.messages.create({ ...params, messages });
      model = response.model || model;
      for (const key of ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]) usage[key] += response.usage?.[key] ?? 0;
      usage.server_tool_use.web_search_requests += response.usage?.server_tool_use?.web_search_requests ?? 0;
      content.push(...response.content);
      if (response.stop_reason !== "pause_turn") break;
      messages = [...params.messages, { role: "assistant", content: [...content] }];
    }
  } finally {
    if (usage.input_tokens || usage.output_tokens) recordCost({ productId, agent, task, run, model, usage });
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
