// Instagram och Facebook via Metas Graph API.
// Kräver: META_PAGE_ID, META_PAGE_TOKEN (långlivad sidtoken), META_IG_USER_ID (Instagram-företagskontots id).
const GRAPH = process.env.META_GRAPH_URL || `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;

const pageId = () => process.env.META_PAGE_ID;
const igId = () => process.env.META_IG_USER_ID;
const token = () => process.env.META_PAGE_TOKEN;

export const facebookConfigured = () => Boolean(pageId() && token());
export const instagramConfigured = () => Boolean(pageId() && token() && igId());

async function graph(method, path, params = {}) {
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
