// Företagsöversikten: ordrar, omsättning och lager från Shopify, kostnader från databasen,
// och företagets egna uppgifter (mål, att göra, utgifter, viktiga länkar).
// Inga siffror hittas på: saknas en koppling visas det som saknas, aldrig exempeldata.
import { db, now, getSetting, stockholmDate } from "./db.js";
import { USD_TO_SEK } from "./costs.js";
import { videoModelSek } from "./higgsfield.js";

db.exec(`
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,            -- YYYY-MM-DD (svensk tid)
  description TEXT NOT NULL,
  category TEXT NOT NULL,        -- se EXPENSE_CATEGORIES
  amount_sek REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  due TEXT,                      -- YYYY-MM-DD eller NULL
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  metric TEXT NOT NULL,          -- revenue | orders
  target REAL NOT NULL,
  start TEXT,                    -- YYYY-MM-DD, NULL = från början
  deadline TEXT                  -- YYYY-MM-DD eller NULL
);
`);

export const EXPENSE_CATEGORIES = {
  annonser: "Annonser",
  abonnemang: "Abonnemang och tjänster",
  material: "Material och förpackning",
  frakt: "Frakt",
  lager: "Lagerinköp",
  ovrigt: "Övrigt",
};

// Startinnehåll första gången: riktiga uppgifter och länkar från projektet (planen 5–11 november 2026), inga siffror.
if (!getSetting("business_seeded", false)) {
  const task = db.prepare("INSERT INTO tasks (title, due, created_at) VALUES (?, ?, ?)");
  for (const [title, due] of [
    ["Publicera temat \"Vardagshoppen – förbeställning\" (Webbutik → Teman → Publicera)", null],
    ["Byt butiksnamnet till Vardagshoppen i Shopify", "2026-11-05"],
    ["Be leverantören om ett DDP-pris till Sverige", "2026-11-06"],
    ["Skicka mejlen till Örnsköldsviks BK och Gårdsbacken (utkasten ligger i Gmail)", "2026-11-06"],
    ["Filma video 1 med kitet", "2026-11-07"],
    ["Skicka mejlen till SSRK, VNKK och Lomsjögården", "2026-11-09"],
    ["Bestäm om Google Workspace ska behållas", "2026-11-11"],
    ["Beställ första lagret (20–30 kit)", null],
  ]) task.run(title, due, now());
  const link = db.prepare("INSERT INTO links (title, url, category, note) VALUES (?, ?, ?, ?)");
  for (const row of [
    ["Butiken", "https://vardagshoppen.com", "Butiken", "Så ser kunderna butiken"],
    ["Shopify admin", "https://admin.shopify.com/store/frostskrapa", "Butiken", "Ordrar, produkter, rabattkoder och teman"],
    ["Shopify: ordrar", "https://admin.shopify.com/store/frostskrapa/orders", "Butiken", ""],
    ["Shopify: rabattkoder", "https://admin.shopify.com/store/frostskrapa/discounts", "Butiken", "FORSTA10 och klubbkoderna"],
    ["Claude (API-saldo)", "https://console.anthropic.com/settings/billing", "Konton och saldon", "Fyll på själv, automatisk påfyllning är av"],
    ["Higgsfield (videosaldo)", "https://open.higgsfield.ai", "Konton och saldon", ""],
    ["ElevenLabs (röst)", "https://elevenlabs.io/app/subscription", "Konton och saldon", ""],
    ["Meta Business Suite", "https://business.facebook.com", "Marknadsföring", "Facebook och Instagram"],
    ["Railway (servern)", "https://railway.com/dashboard", "Teknik", "Där kontrollsidan körs"],
    ["GitHub (koden)", "https://github.com/valleonlinejobb-code/mitt-projekt", "Teknik", ""],
    ["Ung Företagsamhet", "https://ungforetagsamhet.se", "UF", "Regler och tävlingar för UF-företag"],
  ]) link.run(...row);
  const goal = db.prepare("INSERT INTO goals (title, metric, target, start, deadline) VALUES (?, ?, ?, ?, ?)");
  goal.run("Omsättning totalt", "revenue", 1000000, null, null);
  goal.run("Förbeställningar vecka 1", "orders", 5, "2026-11-05", "2026-11-11");
  db.prepare("INSERT INTO settings (key, value) VALUES ('business_seeded', 'true') ON CONFLICT(key) DO NOTHING").run();
}

// ---------- Shopify Admin API ----------
const SHOP = (process.env.SHOPIFY_SHOP || "frostskrapa.myshopify.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";

/** Hur översikten når Shopify: en färdig token, eller en app från Dev Dashboard (klient-id + hemlighet). */
export function shopifyMode() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return "token";
  if (process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) return "app";
  return null;
}

let appToken = null; // { token, expires }
async function accessToken() {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (appToken && appToken.expires > Date.now() + 60_000) return appToken.token;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: process.env.SHOPIFY_CLIENT_ID, client_secret: process.env.SHOPIFY_CLIENT_SECRET }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Shopify godkände inte appen (${res.status}${data.error_description ? `: ${data.error_description}` : ""}). Kolla SHOPIFY_CLIENT_ID och SHOPIFY_CLIENT_SECRET, och att appen är installerad i butiken.`);
  appToken = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return appToken.token;
}

async function shopifyQuery(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new Error("Shopify nekade åtkomst. Appen behöver behörigheterna read_orders, read_products, read_inventory och read_reports.");
  if (!res.ok) throw new Error(`Shopify svarade ${res.status}`);
  if (data.errors?.length) {
    const msg = data.errors.map((e) => e.message).join("; ");
    if (/access denied|ACCESS_DENIED/i.test(msg + JSON.stringify(data.errors))) throw new Error(`Shopify nekade åtkomst (${msg}). Appen behöver read_orders, read_products, read_inventory och read_reports.`);
    throw new Error(`Shopify: ${msg}`);
  }
  return data.data;
}

const money = (set) => Number(set?.shopMoney?.amount ?? 0);

const ORDERS_QUERY = `query Orders($after: String, $query: String) {
  orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true, query: $query) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt test
      displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      discountCodes
      lineItems(first: 30) { nodes { title variantTitle sku currentQuantity variant { inventoryItem { unitCost { amount } } } } }
    }
  }
}`;

const PRODUCTS_QUERY = `query Products($after: String) {
  products(first: 50, after: $after, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle status totalInventory
      featuredMedia { preview { image { url } } }
      variants(first: 100) { nodes { id title sku price inventoryQuantity inventoryPolicy inventoryItem { tracked unitCost { amount } } } }
    }
  }
}`;

/** Gör om en Shopify-order till det översikten behöver. */
function simplifyOrder(o) {
  const items = o.lineItems.nodes.map((li) => ({
    title: li.title, variant: li.variantTitle || "", sku: li.sku || "", quantity: li.currentQuantity,
    unitCost: li.variant?.inventoryItem?.unitCost ? Number(li.variant.inventoryItem.unitCost.amount) : null,
  }));
  return {
    id: o.id, name: o.name, createdAt: o.createdAt, cancelled: Boolean(o.cancelledAt), test: Boolean(o.test),
    financial: o.displayFinancialStatus, fulfillment: o.displayFulfillmentStatus,
    total: money(o.currentTotalPriceSet), shipping: money(o.totalShippingPriceSet), refunded: money(o.totalRefundedSet),
    discountCodes: o.discountCodes ?? [], items,
    units: items.reduce((s, i) => s + i.quantity, 0),
  };
}

let cache = { at: 0, data: null };
const CACHE_MS = 60_000;

/** Ordrar (sedan startdatumet) och produkter med lager. Sparas en minut så att Shopify inte frågas vid varje uppdatering. */
export async function shopifySnapshot({ force = false } = {}) {
  const mode = shopifyMode();
  if (!mode) return { connected: false, mode: null, shop: SHOP, orders: [], products: [], error: null, fetchedAt: null };
  if (!force && cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  try {
    const orders = [];
    let after = null;
    do {
      const page = (await shopifyQuery(ORDERS_QUERY, { after, query: `created_at:>=${businessStart()}` })).orders;
      orders.push(...page.nodes.map(simplifyOrder));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after && orders.length < 2000);
    const products = [];
    after = null;
    do {
      const page = (await shopifyQuery(PRODUCTS_QUERY, { after })).products;
      products.push(...page.nodes.map((p) => ({
        id: p.id, title: p.title, handle: p.handle, status: p.status, totalInventory: p.totalInventory,
        image: p.featuredMedia?.preview?.image?.url ?? null,
        variants: p.variants.nodes.map((v) => ({
          id: v.id, title: v.title, sku: v.sku || "", price: Number(v.price), quantity: v.inventoryQuantity,
          preorder: v.inventoryPolicy === "CONTINUE", tracked: Boolean(v.inventoryItem?.tracked),
          unitCost: v.inventoryItem?.unitCost ? Number(v.inventoryItem.unitCost.amount) : null,
        })),
      })));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    } while (after);
    cache = { at: Date.now(), data: { connected: true, mode, shop: SHOP, orders, products, error: null, fetchedAt: now() } };
    return cache.data;
  } catch (err) {
    // Visa felet, men behåll de senaste riktiga siffrorna om det finns några (med tid för när de hämtades).
    return { connected: false, mode, shop: SHOP, orders: cache.data?.orders ?? [], products: cache.data?.products ?? [], error: err.message, fetchedAt: cache.data?.fetchedAt ?? null, stale: Boolean(cache.data) };
  }
}
export const clearShopifyCache = () => { cache = { at: 0, data: null }; appToken = null; trafficCache = new Map(); };

// ---------- Besökare och köpresa (Shopify Analytics via ShopifyQL) ----------
// Kräver behörigheten read_reports (besök) och read_orders (övergivna kassor). Saknas en behörighet
// visas just den delen som saknad, resten fungerar ändå.
let trafficCache = new Map();
const rowsOf = (r) => (Array.isArray(r?.tableData?.rows) ? r.tableData.rows : null);
const int = (v) => (v == null || v === "" ? 0 : Math.round(Number(v)) || 0);

async function shopifyql(query) {
  const data = await shopifyQuery(`query Q($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { rows } } }`, { q: query });
  const r = data?.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new Error(`ShopifyQL: ${r.parseErrors.join("; ")}`);
  const rows = rowsOf(r);
  if (!rows) throw new Error("Shopify skickade ingen besöksdata.");
  return rows;
}

const scopeHint = (err, scope) => (/nekade|access|denied|scope/i.test(err.message) ? `Appen saknar behörigheten ${scope}. Lägg till den i Dev Dashboard och installera om appen.` : err.message);

/** Besök, köpresa (besök → varukorg → kassa → köp), trafikkällor, enheter och övergivna kassor för en period. */
export async function shopifyTraffic(range, { force = false } = {}) {
  if (!shopifyMode()) return { connected: false, sessions: null, abandoned: null };
  const key = `${range.from}|${range.to}`;
  const hit = trafficCache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const span = `SINCE ${range.from} UNTIL ${range.to}`;
  const out = { connected: true, sessions: null, sessionsError: null, abandoned: null, abandonedError: null };
  try {
    const [funnel] = await shopifyql(`FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout ${span}`);
    const daily = await shopifyql(`FROM sessions SHOW sessions TIMESERIES day ${span}`);
    const sources = await shopifyql(`FROM sessions SHOW sessions GROUP BY referrer_source ${span} ORDER BY sessions DESC LIMIT 8`);
    const devices = await shopifyql(`FROM sessions SHOW sessions GROUP BY session_device_type ${span} ORDER BY sessions DESC LIMIT 5`);
    const f = funnel ?? {};
    const visits = int(f.sessions);
    out.sessions = {
      visits,
      cart: int(f.sessions_with_cart_additions),
      checkout: int(f.sessions_that_reached_checkout),
      purchased: int(f.sessions_that_completed_checkout),
      conversion: visits ? round((int(f.sessions_that_completed_checkout) / visits) * 100) : null,
      daily: daily.map((d) => ({ day: String(d.day ?? "").slice(0, 10), visits: int(d.sessions) })).filter((d) => d.day),
      sources: sources.map((r) => ({ name: r.referrer_source ?? "okänd", visits: int(r.sessions) })).filter((r) => r.visits > 0),
      devices: devices.map((r) => ({ name: r.session_device_type ?? "okänd", visits: int(r.sessions) })).filter((r) => r.visits > 0),
    };
  } catch (err) {
    out.sessionsError = scopeHint(err, "read_reports");
  }
  try {
    const data = await shopifyQuery(`query A($q: String) { abandonedCheckouts(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) {
      nodes { createdAt completedAt totalPriceSet { shopMoney { amount } } lineItems(first: 10) { nodes { title variantTitle quantity } } } } }`,
      { q: `created_at:>=${range.from}` });
    const nodes = data?.abandonedCheckouts?.nodes;
    if (!Array.isArray(nodes)) throw new Error("Shopify skickade inga kassor.");
    const list = nodes
      .filter((c) => !c.completedAt && inRange(stockholmDate(c.createdAt), range.from, range.to))
      .map((c) => ({ createdAt: c.createdAt, value: money(c.totalPriceSet), items: (c.lineItems?.nodes ?? []).map((i) => `${i.quantity} × ${i.variantTitle || i.title}`) }));
    out.abandoned = { count: list.length, value: round(list.reduce((s, c) => s + c.value, 0)), list: list.slice(0, 20) };
  } catch (err) {
    out.abandonedError = scopeHint(err, "read_orders");
  }
  trafficCache.set(key, { at: Date.now(), data: out });
  return out;
}

// ---------- Perioder ----------
/** Från detta datum räknas företagets siffror (standard: när butiken startade). */
export const businessStart = () => String(getSetting("business_start", process.env.BUSINESS_START || "2026-10-01"));
export const lowStockThreshold = () => Number(getSetting("low_stock_threshold", 5));
const DAY = 86_400_000;
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY);

export const PERIODS = { "7d": "7 dagar", "30d": "30 dagar", "90d": "90 dagar", month: "Denna månad", year: "I år", all: "Sedan start" };

/** Periodens första och sista dag (svensk tid, båda med) och perioden före, lika lång. */
export function periodRange(period, today = stockholmDate()) {
  let from;
  if (period === "7d") from = addDays(today, -6);
  else if (period === "90d") from = addDays(today, -89);
  else if (period === "month") from = `${today.slice(0, 8)}01`;
  else if (period === "year") from = `${today.slice(0, 4)}-01-01`;
  else if (period === "all") from = businessStart();
  else from = addDays(today, -29);
  const length = daysBetween(from, today) + 1;
  return { period: PERIODS[period] ? period : "30d", from, to: today, days: length, prevFrom: addDays(from, -length), prevTo: addDays(from, -1) };
}

const inRange = (ymd, from, to) => ymd >= from && ymd <= to;

// ---------- Kostnader ----------
export const PAYMENT_FEE_PCT = Number(process.env.PAYMENT_FEE_PCT ?? 1.6);
export const PAYMENT_FEE_FIXED = Number(process.env.PAYMENT_FEE_FIXED ?? 1.85);

/** Dagens kostnader per sort, i kronor. Lagerinköp räknas inte här (det kostar först när varan säljs). */
function costsByDay(from, to) {
  const days = {};
  const add = (ymd, key, sek) => { if (inRange(ymd, from, to)) (days[ymd] ??= {})[key] = ((days[ymd] ?? {})[key] ?? 0) + sek; };
  for (const c of db.prepare("SELECT at, usd FROM costs").all()) add(stockholmDate(c.at), "claude", c.usd * USD_TO_SEK);
  const perVideo = videoModelSek();
  for (const v of db.prepare("SELECT created_at FROM videos WHERE source = 'ai' AND hf_request_id IS NOT NULL").all()) add(stockholmDate(v.created_at), "higgsfield", perVideo);
  for (const e of db.prepare("SELECT date, amount_sek, category FROM expenses WHERE category != 'lager'").all()) add(e.date, "expenses", e.amount_sek);
  return days;
}

const round = (n) => Math.round(n * 100) / 100;

/** Nyckeltal för en period. orders = riktiga ordrar (ej test, ej makulerade). */
function summarize(orders, costDays, from, to) {
  const list = orders.filter((o) => !o.test && !o.cancelled && inRange(stockholmDate(o.createdAt), from, to));
  const revenue = list.reduce((s, o) => s + o.total, 0);
  let cogs = 0, missingCost = 0;
  for (const o of list) for (const i of o.items) {
    if (i.unitCost == null) missingCost += i.quantity; else cogs += i.unitCost * i.quantity;
  }
  const paid = list.filter((o) => o.total > 0);
  const fees = paid.reduce((s, o) => s + o.total * (PAYMENT_FEE_PCT / 100) + PAYMENT_FEE_FIXED, 0);
  const costs = { cogs, fees, claude: 0, higgsfield: 0, expenses: 0 };
  for (const [ymd, c] of Object.entries(costDays)) {
    if (!inRange(ymd, from, to)) continue;
    for (const k of ["claude", "higgsfield", "expenses"]) costs[k] += c[k] ?? 0;
  }
  const totalCosts = Object.values(costs).reduce((a, b) => a + b, 0);
  return {
    revenue: round(revenue), orders: list.length, units: list.reduce((s, o) => s + o.units, 0),
    aov: list.length ? round(revenue / list.length) : null,
    costs: Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, round(v)])),
    totalCosts: round(totalCosts), result: round(revenue - totalCosts), missingCost,
    // Bruttovinst = omsättning − varukostnad − betalavgifter (det varje såld vara lämnar innan marknadsföring och övrigt).
    gross: round(revenue - cogs - fees),
  };
}

/** En punkt per dag (eller vecka om perioden är lång) med omsättning, kostnader och ordrar. */
function series(orders, costDays, from, to) {
  const span = daysBetween(from, to) + 1;
  const step = span > 120 ? 7 : 1;
  const buckets = [];
  for (let d = from; d <= to; d = addDays(d, step)) buckets.push({ from: d, to: [addDays(d, step - 1), to].sort()[0], revenue: 0, costs: 0, orders: 0 });
  const find = (ymd) => buckets.find((b) => ymd >= b.from && ymd <= b.to);
  for (const o of orders) {
    if (o.test || o.cancelled) continue;
    const b = find(stockholmDate(o.createdAt));
    if (!b) continue;
    b.revenue += o.total; b.orders += 1;
    b.costs += o.total > 0 ? o.total * (PAYMENT_FEE_PCT / 100) + PAYMENT_FEE_FIXED : 0;
    for (const i of o.items) if (i.unitCost != null) b.costs += i.unitCost * i.quantity;
  }
  for (const [ymd, c] of Object.entries(costDays)) {
    const b = find(ymd);
    if (b) b.costs += (c.claude ?? 0) + (c.higgsfield ?? 0) + (c.expenses ?? 0);
  }
  return { step: step === 7 ? "week" : "day", points: buckets.map((b) => ({ ...b, revenue: round(b.revenue), costs: round(b.costs) })) };
}

function goalProgress(goal, orders) {
  const from = goal.start || businessStart();
  const to = goal.deadline || "9999-12-31";
  const list = orders.filter((o) => !o.test && !o.cancelled && inRange(stockholmDate(o.createdAt), from, to));
  const value = goal.metric === "orders" ? list.length : round(list.reduce((s, o) => s + o.total, 0));
  return { ...goal, value, pct: goal.target > 0 ? Math.min(100, (value / goal.target) * 100) : 0 };
}

/** Allt som företagsöversikten visar för en period. */
export async function businessOverview(period = "30d", { force = false } = {}) {
  const shop = await shopifySnapshot({ force });
  const range = periodRange(period);
  const costDays = costsByDay(range.prevFrom < businessStart() ? range.prevFrom : businessStart(), range.to);
  const current = summarize(shop.orders, costDays, range.from, range.to);
  const previous = range.period === "all" ? null : summarize(shop.orders, costDays, range.prevFrom, range.prevTo);
  const threshold = lowStockThreshold();
  const variants = shop.products.filter((p) => p.status === "ACTIVE").flatMap((p) => p.variants.map((v) => ({ ...v, product: p.title })));
  const tracked = variants.filter((v) => v.tracked);
  const stock = {
    threshold,
    units: tracked.reduce((s, v) => s + Math.max(0, v.quantity), 0),
    value: round(tracked.reduce((s, v) => s + Math.max(0, v.quantity) * (v.unitCost ?? 0), 0)),
    missingCost: variants.filter((v) => v.unitCost == null).length,
    variants: variants.length,
    out: tracked.filter((v) => v.quantity <= 0 && !v.preorder).length,
    low: tracked.filter((v) => v.quantity > 0 && v.quantity <= threshold && !v.preorder).length,
    preorder: tracked.filter((v) => v.quantity <= 0 && v.preorder).length,
  };
  const realOrders = shop.orders.filter((o) => !o.test);
  const traffic = await shopifyTraffic(range, { force });
  return {
    range,
    periods: PERIODS,
    shopify: { connected: shop.connected, mode: shop.mode, shop: shop.shop, error: shop.error, fetchedAt: shop.fetchedAt, stale: Boolean(shop.stale) },
    current, previous, traffic,
    series: series(shop.orders, costDays, range.from, range.to),
    stock,
    products: shop.products,
    orders: realOrders.slice(0, 500),
    unfulfilled: realOrders.filter((o) => !o.cancelled && ["UNFULFILLED", "PARTIALLY_FULFILLED", "ON_HOLD"].includes(o.fulfillment)).length,
    fees: { pct: PAYMENT_FEE_PCT, fixed: PAYMENT_FEE_FIXED },
    higgsfieldPerVideo: videoModelSek(),
    goals: db.prepare("SELECT * FROM goals ORDER BY id").all().map((g) => goalProgress(g, shop.orders)),
    tasks: db.prepare("SELECT * FROM tasks ORDER BY done, due IS NULL, due, id").all(),
    links: db.prepare("SELECT * FROM links ORDER BY category, id").all(),
    expenses: db.prepare("SELECT * FROM expenses ORDER BY date DESC, id DESC").all(),
    expenseCategories: EXPENSE_CATEGORIES,
    businessStart: businessStart(),
    today: stockholmDate(),
  };
}

// ---------- Ändringar från sidan ----------
const ymd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) ? String(s) : null);
const text = (s, max = 200) => String(s ?? "").trim().slice(0, max);

export function addExpense(body) {
  const amount = Number(String(body.amount_sek ?? "").replace(",", "."));
  const date = ymd(body.date), description = text(body.description);
  if (!date || !description || !Number.isFinite(amount) || amount <= 0) throw new Error("Fyll i datum, vad det gäller och ett belopp över 0 kr");
  if (!EXPENSE_CATEGORIES[body.category]) throw new Error("Välj en kategori");
  return Number(db.prepare("INSERT INTO expenses (date, description, category, amount_sek, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(date, description, body.category, round(amount), now()).lastInsertRowid);
}

export function addTask(body) {
  const title = text(body.title);
  if (!title) throw new Error("Skriv vad som ska göras");
  return Number(db.prepare("INSERT INTO tasks (title, due, created_at) VALUES (?, ?, ?)").run(title, ymd(body.due), now()).lastInsertRowid);
}

export function addLink(body) {
  const title = text(body.title, 80), url = text(body.url, 500);
  if (!title || !/^https:\/\/\S+$/.test(url)) throw new Error("Skriv ett namn och en adress som börjar med https://");
  return Number(db.prepare("INSERT INTO links (title, url, category, note) VALUES (?, ?, ?, ?)")
    .run(title, url, text(body.category, 40) || "Övrigt", text(body.note)).lastInsertRowid);
}

export function addGoal(body) {
  const title = text(body.title, 80), target = Number(body.target);
  if (!title || !["revenue", "orders"].includes(body.metric) || !(target > 0)) throw new Error("Skriv ett namn, välj vad som mäts och ett mål över 0");
  return Number(db.prepare("INSERT INTO goals (title, metric, target, start, deadline) VALUES (?, ?, ?, ?, ?)")
    .run(title, body.metric, target, ymd(body.start), ymd(body.deadline)).lastInsertRowid);
}
