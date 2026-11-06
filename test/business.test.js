// Företagsöversikten: inga påhittade siffror utan Shopify, och rätt omsättning, kostnader och lager med Shopify.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-uf-business-"));
delete process.env.SHOPIFY_ADMIN_TOKEN;
const { businessOverview, addExpense, addTask, periodRange, clearShopifyCache } = await import("../src/business.js");
const { db, stockholmDate } = await import("../src/db.js");

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const order = (n, daysAgo, total, extra = {}) => ({
  id: `gid://shopify/Order/${n}`, name: `#${n}`, createdAt: iso(daysAgo), cancelledAt: null, test: false,
  displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED",
  currentTotalPriceSet: { shopMoney: { amount: String(total) } }, totalShippingPriceSet: { shopMoney: { amount: "29" } }, totalRefundedSet: { shopMoney: { amount: "0" } },
  discountCodes: [], lineItems: { nodes: [{ title: "Tasstvättkit", variantTitle: "M / Hallkit", sku: "TASS-M", currentQuantity: 1, variant: { inventoryItem: { unitCost: { amount: "40" } } } }] },
  ...extra,
});

test("Utan Shopify: ingen omsättning hittas på, och kopplingen visas som saknad", async () => {
  const o = await businessOverview("30d");
  assert.equal(o.shopify.connected, false);
  assert.equal(o.current.revenue, 0);
  assert.equal(o.orders.length, 0);
  assert.equal(o.products.length, 0);
  // Startinnehållet är riktiga uppgifter och mål, inga siffror.
  assert.ok(o.tasks.length > 0 && o.goals.some((g) => g.target === 1000000));
});

test("Egna utgifter räknas i kostnaderna, men inte lagerinköp", async () => {
  addExpense({ date: stockholmDate(), description: "Annons", category: "annonser", amount_sek: "100" });
  addExpense({ date: stockholmDate(), description: "20 kit", category: "lager", amount_sek: "800" });
  assert.throws(() => addExpense({ date: "igår", description: "x", category: "ovrigt", amount_sek: 5 }));
  assert.throws(() => addTask({ title: " " }));
  const o = await businessOverview("7d");
  assert.equal(o.current.costs.expenses, 100);
  db.prepare("DELETE FROM expenses").run();
});

test("Med Shopify: omsättning, varukostnad, avgifter, makulerade ordrar och lagerstatus", async () => {
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_test";
  clearShopifyCache();
  const orders = [
    order(1001, 1, 228),
    order(1002, 2, 378, { displayFulfillmentStatus: "UNFULFILLED" }),
    order(1003, 3, 228, { cancelledAt: iso(2) }),
    order(1004, 4, 228, { test: true }),
    order(1005, 40, 228), // perioden före
  ];
  const products = [{ id: "gid://shopify/Product/1", title: "Kit", handle: "kit", status: "ACTIVE", totalInventory: 3, featuredMedia: null, variants: { nodes: [
    { id: "v1", title: "S", sku: "S", price: "199", inventoryQuantity: 2, inventoryPolicy: "DENY", inventoryItem: { tracked: true, unitCost: { amount: "40" } } },
    { id: "v2", title: "M", sku: "M", price: "199", inventoryQuantity: 0, inventoryPolicy: "DENY", inventoryItem: { tracked: true, unitCost: null } },
    { id: "v3", title: "L", sku: "L", price: "199", inventoryQuantity: 0, inventoryPolicy: "CONTINUE", inventoryItem: { tracked: true, unitCost: { amount: "40" } } },
    { id: "v4", title: "XL", sku: "XL", price: "199", inventoryQuantity: 20, inventoryPolicy: "DENY", inventoryItem: { tracked: true, unitCost: { amount: "40" } } },
  ] } }];
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), token: init.headers["X-Shopify-Access-Token"] });
    const q = JSON.parse(init.body).query;
    const data = q.includes("orders(") ? { orders: { pageInfo: { hasNextPage: false }, nodes: orders } } : { products: { pageInfo: { hasNextPage: false }, nodes: products } };
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const o = await businessOverview("30d", { force: true });
    assert.ok(seen.every((s) => s.url.startsWith("https://frostskrapa.myshopify.com/admin/api/") && s.token === "shpat_test"));
    assert.equal(o.shopify.connected, true);
    assert.equal(o.current.orders, 2, "makulerade och testordrar räknas inte");
    assert.equal(o.current.revenue, 606);
    assert.equal(o.current.costs.cogs, 80);
    assert.equal(o.current.costs.fees, Math.round((606 * 0.016 + 2 * 1.85) * 100) / 100);
    assert.equal(o.current.result, Math.round((606 - o.current.totalCosts) * 100) / 100);
    assert.equal(o.previous.orders, 1);
    assert.equal(o.unfulfilled, 1);
    assert.deepEqual([o.stock.out, o.stock.low, o.stock.preorder, o.stock.units, o.stock.missingCost], [1, 1, 1, 22, 1]);
    assert.equal(o.series.points.reduce((s, p) => s + p.orders, 0), 2);
    const goal = o.goals.find((g) => g.target === 1000000);
    assert.equal(goal.value, 606, "målet räknas från startdatumet, utan makulerade och testordrar");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    clearShopifyCache();
  }
});

test("Shopify fel: felet visas och inga siffror hittas på", async () => {
  process.env.SHOPIFY_ADMIN_TOKEN = "fel";
  clearShopifyCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  try {
    const o = await businessOverview("30d", { force: true });
    assert.equal(o.shopify.connected, false);
    assert.match(o.shopify.error, /nekade/);
    assert.equal(o.current.revenue, 0);
  } finally { globalThis.fetch = realFetch; delete process.env.SHOPIFY_ADMIN_TOKEN; }
});

test("Perioderna: 7 dagar inklusive idag, och lika lång period före", () => {
  const r = periodRange("7d", "2026-11-04");
  assert.deepEqual([r.from, r.to, r.days, r.prevFrom, r.prevTo], ["2026-10-29", "2026-11-04", 7, "2026-10-22", "2026-10-28"]);
  assert.equal(periodRange("month", "2026-11-04").from, "2026-11-01");
});

test("Besökare och köp: riktiga siffror från ShopifyQL, och saknad behörighet visas tydligt", async () => {
  process.env.SHOPIFY_ADMIN_TOKEN = "shpat_test";
  clearShopifyCache();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    let data;
    if (query.includes("shopifyqlQuery")) {
      const q = variables.q;
      const rows = q.includes("TIMESERIES") ? [{ day: "2026-11-01", sessions: "5" }]
        : q.includes("referrer_source") ? [{ referrer_source: "direct", sessions: "40" }, { referrer_source: "social", sessions: "10" }]
        : q.includes("device") ? [{ session_device_type: "mobile", sessions: "30" }]
        : [{ sessions: "50", sessions_with_cart_additions: "6", sessions_that_reached_checkout: "4", sessions_that_completed_checkout: "1" }];
      data = { shopifyqlQuery: { parseErrors: [], tableData: { rows } } };
    } else if (query.includes("abandonedCheckouts")) {
      return new Response(JSON.stringify({ errors: [{ message: "Access denied for abandonedCheckouts field." }] }), { headers: { "Content-Type": "application/json" } });
    } else if (query.includes("orders(")) data = { orders: { pageInfo: { hasNextPage: false }, nodes: [] } };
    else data = { products: { pageInfo: { hasNextPage: false }, nodes: [] } };
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const o = await businessOverview("30d", { force: true });
    const s = o.traffic.sessions;
    assert.deepEqual([s.visits, s.cart, s.checkout, s.purchased], [50, 6, 4, 1]);
    assert.equal(s.conversion, 2);
    assert.equal(s.sources[0].name, "direct");
    assert.equal(o.traffic.abandoned, null, "inga påhittade kassor när behörighet saknas");
    assert.match(o.traffic.abandonedError, /read_orders/);
    assert.equal(o.current.gross, 0);
  } finally { globalThis.fetch = realFetch; delete process.env.SHOPIFY_ADMIN_TOKEN; clearShopifyCache(); }
});
