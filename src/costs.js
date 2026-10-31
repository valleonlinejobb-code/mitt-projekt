// Vad Claude faktiskt kostar: varje anrop räknas från svaret (tokens och webbsökningar) och sparas,
// så att kontrollsidan visar riktiga kronor i stället för gissningar.
import crypto from "node:crypto";
import { db, now, getSetting, stockholmDate } from "./db.js";

// Dollar per miljon tokens (Anthropics listpriser). Okända modeller räknas som Opus 5.5 hellre än för billigt.
const PRICES = [
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/fable/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/opus/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/sonnet/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/haiku-5/, { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  [/haiku/, { input: 1, output: 5, cacheRead: 0.1 }],
];
const SEARCH_USD = 0.01; // 10 dollar per 1000 webbsökningar
export const USD_TO_SEK = Number(process.env.USD_TO_SEK || 10.5);

// Ungefärliga kostnader innan det finns riktiga siffror (kronor). Ersätts av snittet av de senaste jobben.
const DEFAULT_SEK = {
  video: Number(process.env.COST_PER_VIDEO_SEK || 8),
  research: Number(process.env.COST_PER_RESEARCH_SEK || 12),
  clip: Number(process.env.COST_PER_CLIP_SEK || 3),
};

const priceOf = (model = "") => PRICES.find(([re]) => re.test(model))?.[1] ?? PRICES[0][1];

/** Kostnaden i dollar för ett svar från Claude. */
export function usdOf(usage, model) {
  const p = priceOf(model);
  const input = (usage.input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0);
  return (input * p.input + (usage.cache_read_input_tokens ?? 0) * p.cacheRead + (usage.output_tokens ?? 0) * p.output) / 1e6
    + (usage.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD;
}

export const newRun = () => crypto.randomUUID();

export function recordCost({ productId = null, agent, task, run = null, model, usage }) {
  const usd = usdOf(usage, model);
  db.prepare(`INSERT INTO costs (at, product_id, agent, task, run, model, input_tokens, output_tokens, searches, usd)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    now(), productId, agent, task, run, model ?? null,
    (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    usage.output_tokens ?? 0, usage.server_tool_use?.web_search_requests ?? 0, usd,
  );
  return usd;
}

const sek = (usd) => Math.round(usd * USD_TO_SEK * 10) / 10;
// Månaden räknas i svensk tid, från den 1:a. Sommartid (+02:00) räknas med, så att inget hamnar i fel månad.
const monthStart = () => {
  const first = `${stockholmDate().slice(0, 8)}01`;
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Stockholm", timeZoneName: "longOffset" })
    .formatToParts(new Date(`${first}T12:00:00Z`)).find((p) => p.type === "timeZoneName").value.replace("GMT", "") || "+00:00";
  return new Date(`${first}T00:00:00${offset}`).toISOString();
};

export const spentThisMonthSek = () => sek(db.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM costs WHERE at >= ?").get(monthStart()).usd);

/** Månadstaket för Claude i kronor. 0 = inget tak. */
export const claudeBudgetSek = () => Number(getSetting("claude_budget_sek", Number(process.env.CLAUDE_BUDGET_SEK || 300)));

/** Vad ett jobb brukar kosta: snittet av de 3 senaste, annars en uppskattning. */
export function estimateSek(task) {
  const runs = db.prepare(`SELECT SUM(usd) AS usd FROM costs WHERE task = ? AND run IS NOT NULL
    GROUP BY run ORDER BY MAX(id) DESC LIMIT 3`).all(task);
  if (!runs.length) return DEFAULT_SEK[task];
  return Math.max(1, Math.round(sek(runs.reduce((a, r) => a + r.usd, 0) / runs.length)));
}

/** Det kontrollsidan visar: månadens kostnad per agent och de senaste jobben. */
export function spendSummary() {
  const since = monthStart();
  const byAgent = db.prepare(`SELECT agent, COUNT(*) AS calls, SUM(searches) AS searches, SUM(usd) AS usd
    FROM costs WHERE at >= ? GROUP BY agent ORDER BY usd DESC`).all(since);
  const runs = db.prepare(`SELECT task, MIN(at) AS at, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens,
    SUM(output_tokens) AS output_tokens, SUM(searches) AS searches, SUM(usd) AS usd
    FROM costs GROUP BY COALESCE(run, id) ORDER BY MAX(id) DESC LIMIT 10`).all();
  return {
    monthSek: spentThisMonthSek(),
    budgetSek: claudeBudgetSek(),
    byAgent: byAgent.map((a) => ({ agent: a.agent, calls: a.calls, searches: a.searches, sek: sek(a.usd) })),
    recent: runs.map((r) => ({ ...r, usd: undefined, sek: sek(r.usd) })),
  };
}
