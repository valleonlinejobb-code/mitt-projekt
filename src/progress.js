// Vad research- och promptagenten håller på med just nu, så att kontrollsidan kan fylla pilarna mellan agenterna.
// Sparas bara i minnet. En video som Higgsfield håller på med syns ändå efter en omstart, eftersom den finns i databasen.

// Varje steg: [nyckel, text på kontrollsidan, ungefär hur många sekunder steget tar]. Sekunderna styr bara hur fort pilen fylls.
export const STAGES = {
  research: [
    ["search", "Söker på webben efter andras annonser", 150],
    ["check", "Faktakollar rapporten", 90],
  ],
  prompt: [
    ["ideas", "Skriver tre videoidéer", 60],
    ["review", "Granskar idéerna mot referensvideon", 50],
    ["send", "Skickar prompten till Higgsfield", 5],
    ["render", "Higgsfield gör videon", 240],
    ["download", "Hämtar videon från Higgsfield", 10],
  ],
};

const current = new Map();
const key = (productId, agent) => `${productId}:${agent}`;

/** Agenten börjar på ett nytt steg. Pilen fylls fram till och med steget. */
export function stage(productId, agent, stageKey, detail = "") {
  const index = STAGES[agent].findIndex(([k]) => k === stageKey);
  const previous = current.get(key(productId, agent));
  current.set(key(productId, agent), {
    status: "working",
    stage: index,
    stageStartedAt: new Date().toISOString(),
    runStartedAt: previous?.status === "working" ? previous.runStartedAt : new Date().toISOString(),
    detail,
  });
}

/** Klar: pilen blir helt grön och uppgiften går vidare till nästa agent. */
export const done = (productId, agent, detail = "") =>
  current.set(key(productId, agent), { status: "done", at: new Date().toISOString(), detail });

/** Stoppad utan fel (t.ex. ingen idé var tillräckligt bra). Pilen töms. */
export const stopped = (productId, agent, detail = "") =>
  current.set(key(productId, agent), { status: "stopped", at: new Date().toISOString(), detail });

export const failed = (productId, agent, detail = "") =>
  current.set(key(productId, agent), { status: "error", at: new Date().toISOString(), detail });

export const progressOf = (productId, agent) => current.get(key(productId, agent)) ?? null;
