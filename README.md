# Agent UF – marknadsföringsagenter

Fem AI-agenter per produkt som tillsammans gör och publicerar reklamvideor, styrda från en enkel kontrollsida.

| Agent | Vad den gör |
|---|---|
| Researchagent | Söker på webben efter hur andra företag gör sina annonser och annonsvideor. En faktakontroll stryker sedan allt som saknar källa, så att promptagenten bara får verifierade fakta (med länk) och tydligt märkta bedömningar. Körs när du beställer videor (högst var tredje dag) eller när du trycker Kör research. |
| Promptagent | Gör de videor du beställer, en i taget. Den skriver tre idéer utifrån produktbilden, researchen och referensvideon (`src/agents/reference-ad.md`). En granskare betygsätter dem och skriver om den bästa. Bara en idé med minst 8/10 blir en video hos Higgsfield. Annars stoppas kön, så att inga pengar går till en dålig annons. |
| Instagram | Publicerar godkända videor som Reels (max en per dag) och skriver svar på kommentarer och DM. |
| Facebook | Publicerar godkända videor på sidan (max en per dag) och skriver svar på kommentarer och Messenger. |
| TikTok | Publicerar godkända videor (max en per dag). TikTok har inget API för kommentarssvar. |

Ingenting publiceras innan du har tryckt **Godkänn** på kontrollsidan. Kanaler som inte är kopplade än hamnar under **Lägg upp själv**, där du laddar ner videon och kopierar texten. Svar på kommentarer och DM är utkast som du skickar, tills du slår på autosvar. Klagomål och oklara frågor lämnas alltid åt dig.

**Inga pengar spenderas utan att du har bett om det.** Videor och research görs bara när du trycker **Beställ videor** och väljer hur många videor (1–10). Sidan visar ungefärlig kostnad och frågar en gång till innan beställningen läggs. Högst 10 videor kan ligga i kön, och om något går fel töms kön så att inga fler försök kostar pengar.

Kanalagenterna (Instagram, Facebook, TikTok) startas och stoppas med **Starta**/**Stoppa**. De publicerar bara videor du har godkänt. När Instagram- eller Facebook-agenten är på läser den kommentarer och DM var tionde minut och skriver svarsutkast med Claude, vilket kostar några öre per meddelande.

## Kostnad per månad (uppskattning)

| Vad | Ungefär |
|---|---|
| Railway (Hobby) | 55 kr |
| Claude API | 100–200 kr |
| Higgsfield, en video om 10 s per dag (Wan 3.0) | ca 2 kr per video, 60–100 kr |

Du betalar bara för de videor du beställer. Taket `MAX_VIDEOS_PER_MONTH` (standard 35) är ett extra skydd.

## Sätta upp på Railway

1. Railway → **New Project → Deploy from GitHub repo** → välj `mitt-projekt`.
2. Lägg till en **Volume** på tjänsten och montera den på `/data`.
3. **Settings → Networking → Generate Domain**. Adressen blir din kontrollsida.
4. Lägg in variablerna nedan under **Variables**. Railway startar om automatiskt.
5. Öppna adressen, logga in med lösenordet (användarnamnet spelar ingen roll) och beställ en första video.

### Variabler

| Variabel | Krävs | Beskrivning |
|---|---|---|
| `CONTROL_PASSWORD` | ja | Lösenord till kontrollsidan. |
| `DATA_DIR` | ja | `/data` (samma som volymen). |
| `PUBLIC_URL` | ja | Din Railway-adress, t.ex. `https://agent-uf.up.railway.app`. Instagram och Facebook hämtar videorna därifrån. |
| `ANTHROPIC_API_KEY` | ja | Från console.anthropic.com → API Keys. |
| `HF_API_KEY` | ja | Från Higgsfield API (open.higgsfield.ai) → Create API key. Klistra in hela nyckeln. (Alternativt `HF_API_KEY_ID` + `HF_API_KEY_SECRET` om du fick två delar.) Fyll på några dollar. |
| `META_PAGE_ID`, `META_PAGE_TOKEN`, `META_IG_USER_ID` | för IG/FB | Se nedan. |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN` | för TikTok | Se nedan. |
| `TIKTOK_PRIVACY` | nej | `SELF_ONLY` tills TikTok har granskat appen, sedan `PUBLIC_TO_EVERYONE`. |
| `CLAUDE_MODEL` | nej | Standard `claude-opus-5-5`. |
| `HIGGSFIELD_MODEL` | nej | Standard `alibaba/wan-3.0/reference-to-video`. |
| `VIDEO_SECONDS`, `VIDEO_RESOLUTION` | nej | Standard `10` och `720p`. |
| `MAX_VIDEOS_PER_MONTH` | nej | Standard `35`. |
| `MIN_VIDEO_SCORE` | nej | Lägsta betyg (1–10) en idé måste få innan videon beställs. Standard `8`. |
| `RESEARCH_EVERY_DAYS` | nej | Hur gammal researchen får vara innan en beställning kör ny. Standard `3`. |
| `COST_PER_VIDEO_SEK`, `COST_PER_RESEARCH_SEK` | nej | Kostnaderna som visas på knapparna. Standard `4` och `5`. |
| `INBOX_EVERY_MINUTES` | nej | Hur ofta kommentarer och DM hämtas. Standard `10`. |

### Instagram och Facebook

1. Gör Instagram-kontot till ett **företagskonto** och koppla det till en **Facebook-sida** för Agent UF.
2. Skapa en app på developers.facebook.com (typ *Business*) och lägg till **Instagram** och **Messenger**.
3. Ge appen behörigheterna `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `pages_messaging`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments` och `instagram_manage_messages`.
4. Ta fram en **långlivad sidtoken** (Graph API Explorer → välj sidan → förläng i Access Token Debugger) → `META_PAGE_TOKEN`.
5. `META_PAGE_ID` är sidans id. `META_IG_USER_ID` får du med `GET /{sid-id}?fields=instagram_business_account`.

Så länge appen är i utvecklingsläge fungerar den för dina egna konton. För att svara på DM från vanliga kunder måste Meta granska appen (App Review), vilket brukar ta några dagar.

### TikTok

1. Skapa en app på developers.tiktok.com och lägg till **Login Kit** och **Content Posting API** (Direct Post).
2. Logga in med Agent UF:s TikTok-konto via appen och spara refresh-token → `TIKTOK_REFRESH_TOKEN`.
3. Innan TikTok har granskat appen blir alla inlägg privata. Ansök om granskning; under tiden kan du lägga upp själv från kontrollsidan.

## Köra lokalt

```bash
npm install
CONTROL_PASSWORD=test ANTHROPIC_API_KEY=... npm start
# öppna http://localhost:3000
```

Kräver Node 22.13 eller senare (använder inbyggda `node:sqlite`).
