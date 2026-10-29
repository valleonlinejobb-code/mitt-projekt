// Instagram och Facebook via Metas Graph API.
// Kräver: META_PAGE_ID, META_PAGE_TOKEN (långlivad sidtoken), META_IG_USER_ID (Instagram-företagskontots id).
const GRAPH = process.env.META_GRAPH_URL || `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

const pageId = () => process.env.META_PAGE_ID;
const igId = () => process.env.META_IG_USER_ID;
const token = () => pageToken ?? process.env.META_PAGE_TOKEN;
let pageToken;

export const facebookConfigured = () => Boolean(pageId() && token());
export const instagramConfigured = () => Boolean(pageId() && token() && igId());

/**
 * Meta kräver en sidnyckel (page token) för att lägga upp på sidan. Om META_PAGE_TOKEN råkar vara
 * en användarnyckel (den som syns i Graph API Explorer) byter vi den mot sidans egen nyckel.
 */
async function ensurePageToken() {
  if (pageToken) return;
  const url = new URL(`${GRAPH}/${pageId()}`);
  url.searchParams.set("fields", "access_token");
  url.searchParams.set("access_token", process.env.META_PAGE_TOKEN);
  const body = await fetch(url).then((r) => r.json()).catch(() => ({}));
  pageToken = body.access_token || process.env.META_PAGE_TOKEN;
}

async function graph(method, path, params = {}) {
  await ensurePageToken();
  const url = new URL(`${GRAPH}/${path}`);
  const init = { method };
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", token());
  } else {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify({ ...params, access_token: token() });
  }
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Meta: ${body.error?.message ?? res.status}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function publishInstagramReel(videoUrl, caption) {
  const { id: containerId } = await graph("POST", `${igId()}/media`, {
    media_type: "REELS", video_url: videoUrl, caption, share_to_feed: true,
  });
  // Instagram behöver bearbeta videon innan den kan publiceras.
  for (let i = 0; i < 40; i++) {
    const { status_code } = await graph("GET", containerId, { fields: "status_code" });
    if (status_code === "FINISHED") break;
    if (status_code === "ERROR" || status_code === "EXPIRED") throw new Error(`Instagram kunde inte bearbeta videon (${status_code})`);
    await sleep(15000);
  }
  const { id } = await graph("POST", `${igId()}/media_publish`, { creation_id: containerId });
  return id;
}

export async function publishFacebookVideo(videoUrl, description) {
  const { id } = await graph("POST", `${pageId()}/videos`, { file_url: videoUrl, description });
  return id;
}

let igUsername;
/** Nya kommentarer på våra senaste inlägg. Returnerar [{externalId, replyTo, author, text}] */
export async function fetchInstagramComments() {
  igUsername ??= (await graph("GET", igId(), { fields: "username" })).username;
  const { data = [] } = await graph("GET", `${igId()}/media`, {
    fields: "id,comments.limit(25){id,text,username}", limit: "10",
  });
  return data.flatMap((m) => m.comments?.data ?? [])
    .filter((c) => c.username !== igUsername)
    .map((c) => ({ externalId: `ig-c-${c.id}`, replyTo: c.id, author: c.username, text: c.text }));
}

export async function fetchFacebookComments() {
  const { data = [] } = await graph("GET", `${pageId()}/feed`, {
    fields: "id,comments.limit(25){id,message,from}", limit: "10",
  });
  return data.flatMap((p) => p.comments?.data ?? [])
    .filter((c) => c.from?.id !== pageId() && c.message)
    .map((c) => ({ externalId: `fb-c-${c.id}`, replyTo: c.id, author: c.from?.name, text: c.message }));
}

/** Senaste meddelandet i varje DM-konversation, om det kommer från en kund. */
export async function fetchDirectMessages(platform) {
  const ownIds = [pageId(), igId()];
  const { data = [] } = await graph("GET", `${pageId()}/conversations`, {
    platform, fields: "messages.limit(1){id,message,from}", limit: "20",
  });
  return data.map((c) => c.messages?.data?.[0])
    .filter((m) => m?.message && !ownIds.includes(m.from?.id))
    .map((m) => ({
      externalId: `${platform}-dm-${m.id}`, replyTo: m.from.id,
      author: m.from.username ?? m.from.name, text: m.message,
    }));
}

export async function replyToInstagramComment(commentId, message) {
  await graph("POST", `${commentId}/replies`, { message });
}

export async function replyToFacebookComment(commentId, message) {
  await graph("POST", `${commentId}/comments`, { message });
}

export async function sendDirectMessage(recipientId, text) {
  await graph("POST", `${pageId()}/messages`, {
    recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE",
  });
}

/** Hur en Facebook-video har gått: visningar, hur många som stannade och hur länge. Gratis att hämta. */
export async function fetchFacebookVideoStats(videoId) {
  const { data = [] } = await graph("GET", `${videoId}/video_insights`, {
    metric: "total_video_impressions,total_video_views,total_video_10s_views,total_video_complete_views,total_video_avg_time_watched",
  });
  const v = Object.fromEntries(data.map((m) => [m.name, Number(m.values?.[0]?.value ?? 0)]));
  return {
    impressions: v.total_video_impressions ?? 0,
    views: v.total_video_views ?? 0, // minst 3 sekunder
    views10s: v.total_video_10s_views ?? 0,
    completeViews: v.total_video_complete_views ?? 0,
    avgSeconds: (v.total_video_avg_time_watched ?? 0) / 1000,
  };
}

export async function fetchInstagramReelStats(mediaId) {
  const { data = [] } = await graph("GET", `${mediaId}/insights`, { metric: "reach,views,likes,comments,shares,saved,ig_reels_avg_watch_time" });
  const v = Object.fromEntries(data.map((m) => [m.name, Number(m.values?.[0]?.value ?? 0)]));
  return { impressions: v.reach ?? 0, views: v.views ?? 0, likes: v.likes, comments: v.comments, shares: v.shares, saves: v.saved, avgSeconds: (v.ig_reels_avg_watch_time ?? 0) / 1000 };
}

const NEEDED_FOR_FACEBOOK = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];

async function debugToken(t) {
  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set("input_token", t);
  url.searchParams.set("access_token", t);
  const body = await fetch(url).then((r) => r.json()).catch((e) => ({ error: { message: e.message } }));
  return body.data ?? { error: body.error?.message ?? "okänt fel" };
}

/** Kontrollerar Facebook-kopplingen och säger på svenska vad som saknas. Visar aldrig själva nycklarna. */
export async function diagnoseMeta() {
  const raw = process.env.META_PAGE_TOKEN;
  if (!pageId() || !raw) return { ok: false, lines: ["✗ META_PAGE_ID eller META_PAGE_TOKEN saknas i Railway."] };
  const lines = [];
  const info = await debugToken(raw);
  if (info.error || info.is_valid === false) {
    return { ok: false, lines: [`✗ Nyckeln i Railway fungerar inte: ${info.error?.message ?? info.error ?? "ogiltig eller utgången"}. Gör en ny nyckel.`] };
  }
  lines.push(`Nyckeln i Railway är en ${info.type === "PAGE" ? "sidnyckel" : info.type === "USER" ? "användarnyckel" : info.type}${info.expires_at ? `, gäller till ${new Date(info.expires_at * 1000).toISOString().slice(0, 10)}` : ", går inte ut"}.`);

  if (info.type === "USER") {
    const url = new URL(`${GRAPH}/me/accounts`);
    url.searchParams.set("fields", "id,name,tasks");
    url.searchParams.set("access_token", raw);
    const { data = [], error } = await fetch(url).then((r) => r.json()).catch(() => ({}));
    const page = data.find((p) => p.id === pageId());
    if (error) lines.push(`✗ Kunde inte läsa dina sidor: ${error.message}`);
    else if (!page) lines.push(`✗ Nyckeln ser inte sidan med id ${pageId()}. Välj sidan Vardagshoppen när du godkänner i Facebook-rutan.`);
    else {
      lines.push(`✓ Nyckeln ser sidan ${page.name}.`);
      const tasks = page.tasks ?? [];
      lines.push(tasks.includes("CREATE_CONTENT") ? "✓ Ditt konto får skapa inlägg på sidan." : `✗ Ditt konto saknar rätten att skapa inlägg på sidan (har: ${tasks.join(", ") || "inga"}). Du behöver full kontroll över sidan.`);
    }
  }

  await ensurePageToken();
  const pageInfo = pageToken && pageToken !== raw ? await debugToken(pageToken) : info;
  lines.push(pageInfo.type === "PAGE" ? "✓ Agenten använder sidans egen nyckel." : "✗ Agenten fick ingen sidnyckel. Kolla att du valde sidan Vardagshoppen.");
  const scopes = pageInfo.scopes ?? info.scopes ?? [];
  for (const s of NEEDED_FOR_FACEBOOK) lines.push(`${scopes.includes(s) ? "✓" : "✗"} ${s}`);
  const missing = NEEDED_FOR_FACEBOOK.filter((s) => !scopes.includes(s));
  if (missing.length) lines.push(`Lägg till ${missing.join(", ")} i Graph API Explorer, tryck Generate Access Token och lägg den nya nyckeln i META_PAGE_TOKEN.`);
  const ok = !lines.some((l) => l.startsWith("✗"));
  if (ok) lines.push("Allt ser rätt ut. Tryck Försök igen på videon.");
  return { ok, lines };
}
