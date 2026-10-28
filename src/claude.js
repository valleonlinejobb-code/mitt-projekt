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
 * @param {"low"|"medium"|"high"} [opts.effort]
 */
export async function askClaude({ system, prompt, schema, webSearch = false, effort = "medium" }) {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: prompt }],
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  };
  if (webSearch) params.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }];

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

  const text = (schema ? response.content : content).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return schema ? JSON.parse(text) : text;
}
