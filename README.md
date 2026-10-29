# Agent UF – marknadsföringsagenter

Fem AI-agenter per produkt som tillsammans gör och publicerar reklamvideor, styrda från en enkel kontrollsida.

| Agent | Vad den gör |
|---|---|
| Researchagent | Söker på webben efter hur andra företag gör sina annonser och annonsvideor. En faktakontroll stryker sedan allt som saknar källa, så att promptagenten bara får verifierade fakta (med länk) och tydligt märkta bedömningar. Den läser också svenska kunders recensioner och samlar deras klagomål, invändningar och egna ord under **Kundernas röst**, som promptagenten bygger krokar på och svarsagenten använder för att bemöta vanliga frågor. Rapporten visas på kontrollsidan som rutor med klickbara källor, med de viktigaste lärdomarna överst. Körs när du beställer videor (högst var tredje dag) eller när du trycker Kör research. |
| Promptagent | Gör de videor du beställer, en i taget. Den skriver tre idéer utifrån produktbilden, researchen och annonstipsen (`src/agents/reference-ad.md`), med före/efter, text i bild, en berättartext och en slutbild. En granskare betygsätter dem och skriver om den bästa. Bara en idé med minst 8/10, där pris, rabattkoder och procent stämmer med **Aktuella erbjudanden**, blir en video hos Higgsfield. Annars stoppas kön, så att inga pengar går till en dålig annons. |
| Resultat | Innan promptagenten skriver idéer hämtar den (gratis) hur de publicerade videorna har gått på Facebook och Instagram: visningar, krokgrad (andel som tittar minst 3 s), hur många som tittar klart och snittid. Den bästa videon blir "vinnare", och en av de nya idéerna blir en variant av den med ny krok. Siffrorna syns i videohistoriken. |
| A/B-test och varianter | **A/B-test** gör 3 videor med samma budskap men olika krok-typer. När de är publicerade visar kontrollsidan krokgrad per video och utser en vinnare (minst 300 visningar var). **Beställ variant** gör en ny version av en video med ny krok eller miljö. Vid godkännandet väljer du vilka kanaler videon ska läggas upp på. |
| Egen mobilfilm | Ladda upp en egen film (2–90 s) på kontrollsidan. Klippagenten tittar på bilder ur filmen och skriver text i bild, berättarröst, slutbild och inläggstexter (1–2 Claude-anrop, ca 3 kr). Ingen Higgsfield-kostnad. |
| Klippare | När videon kommer tillbaka lägger servern på (med ffmpeg, gratis) Vardagshoppens logga och namn, priset, text i bild, en slutbild på 3 s med pris, erbjudanden och vardagshoppen.com, och en svensk kvinnoröst (Google Text-to-Speech). Videomodellen kan inte skriva text eller logotyper själv. |
| Instagram | Publicerar godkända videor som Reels (max en per dag) och skriver svar på kommentarer och DM. |
| Facebook | Publicerar godkända videor på sidan (max en per dag) och skriver svar på kommentarer och Messenger. |
| TikTok | Publicerar godkända videor (max en per dag). TikTok har inget API för kommentarssvar. |

Ingenting publiceras innan du har tryckt **Godkänn** på kontrollsidan. Kanaler som inte är kopplade än hamnar under **Lägg upp själv**, där du laddar ner videon och kopierar texten. Svar på kommentarer och DM är utkast som du skickar, tills du slår på autosvar. Klagomål och oklara frågor lämnas alltid åt dig.

**Inga pengar spenderas utan att du har bett om det.** Videor och research görs bara när du trycker **Beställ videor** och väljer hur många videor (1–10). Sidan visar ungefärlig kostnad och frågar en gång till innan beställningen läggs. Högst 10 videor kan ligga i kön, och om något går fel töms kön så att inga fler försök kostar pengar.

**Välj produkt.** Överst på kontrollsidan väljer du vilken produkt agenterna gör reklam för. Bara den produkten får videor och inlägg. **Hämta nya produkter från butiken** lägger till butikens publicerade produkter (från `SHOPIFY_STORE_URL/products.json`, ingen nyckel behövs). Det du redan har skrivit om en produkt skrivs aldrig över. Byter du produkt töms kön för den förra, och kanalagenterna fortsätter som de var. Research och videor sparas per produkt. Under **Produktinfo** kan du skriva extra instruktioner till agenterna för just den produkten.

**Research återanvänds.** Researchen sparas per produkt och används till alla videor du beställer. Ny research görs bara automatiskt när den är äldre än `RESEARCH_EVERY_DAYS` (standard 3 dagar), eller när du trycker **Kör research**.

Kanalagenterna (Instagram, Facebook, TikTok) startas och stoppas med **Starta**/**Stoppa**. De publicerar bara videor du har godkänt. När Instagram- eller Facebook-agenten är på läser den kommentarer och DM var tionde minut och skriver svarsutkast med Claude, vilket kostar några öre per meddelande.

## Kostnad per månad (uppskattning)

| Vad | Ungefär |
|---|---|
| Railway (Hobby) | 55 kr |
| Claude API: en video ca 5–10 kr. Researchen är gratis med Gemini (annars ca 8–15 kr med Sonnet 5.5) | 50–200 kr |
| Gemini API (researchen) | 0 kr: gratisnivån, med 500 gratis Google-sökningar per dag |
| Higgsfield, en video om 10 s per dag (Wan 3.0) | ca 2 kr per video, 60–100 kr |
| Google Text-to-Speech (berättarrösten) | 0 kr: 1 miljon tecken per månad är gratis, en video använder ca 200 |

Du betalar bara för de videor du beställer. Taket `MAX_VIDEOS_PER_MONTH` (standard 35) är ett extra skydd.

Kontrollsidan visar under **Vad Claude har kostat** vad varje jobb faktiskt kostade, räknat från Claudes svar (tokens och webbsökningar), och vad månaden har kostat per agent. Knapparnas priser är snittet av de tre senaste jobben av samma sort. Där finns också ett **månadstak** (standard 300 kr): när det är nått görs inga fler Claude-anrop förrän du höjer det.

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
| `META_APP_ID`, `META_APP_SECRET` | för IG/FB | Appens id och hemlighet (App settings → Basic). Då kan du trycka **Koppla Facebook** på kontrollsidan i stället för att klistra in nycklar. `META_LOGIN_CONFIG_ID` (valfri) = konfigurationens id om appen använder Facebook-inloggning för företag. Lägg till `<PUBLIC_URL>/meta/callback` som giltig OAuth-omdirigering. |
| `META_PAGE_ID`, `META_PAGE_TOKEN`, `META_IG_USER_ID` | för IG/FB | Gamla sättet, används om Koppla Facebook inte är gjort. Se nedan. |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN` | för TikTok | Se nedan. |
| `TIKTOK_PRIVACY` | nej | `SELF_ONLY` tills TikTok har granskat appen, sedan `PUBLIC_TO_EVERYONE`. |
| `CLAUDE_MODEL` | nej | Standard `claude-opus-5-5`. |
| `HIGGSFIELD_MODEL` | nej | Videomodellen innan du har valt en på kontrollsidan (rutan **Videomodell**: Wan 3.0, Wan 3.0 Prime eller Seedance 2.0). Standard `alibaba/wan-3.0/reference-to-video`. |
| `VIDEO_SECONDS`, `VIDEO_RESOLUTION` | nej | Standard `10` och `720p`. |
| `MAX_VIDEOS_PER_MONTH` | nej | Standard `35`. |
| `MIN_VIDEO_SCORE` | nej | Lägsta betyg (1–10) en idé måste få innan videon beställs. Standard `8`. |
| `RESEARCH_EVERY_DAYS` | nej | Hur gammal researchen får vara innan en beställning kör ny. Standard `3`. |
| `COST_PER_VIDEO_SEK`, `COST_PER_RESEARCH_SEK`, `COST_PER_CLIP_SEK` | nej | Kostnaderna som visas på knapparna innan det finns riktiga siffror. Standard `8`, `12` och `3`. |
| `GEMINI_API_KEY` | nej, men gör researchen gratis | Från aistudio.google.com → Get API key → Create API key. Inget kort behövs. Med nyckeln görs researchen med Gemini och Google-sökning i stället för Claude. Videoidéer, granskning och kundsvar använder fortfarande Claude. |
| `GEMINI_MODEL` | nej | Standard `gemini-2.5-flash`. Gratis Google-sökning finns bara på 2.5 Flash och 2.5 Flash-Lite. |
| `RESEARCH_MODEL` | nej | Claude-modellen för researchen när `GEMINI_API_KEY` saknas. Standard `claude-sonnet-5-5` (billigare). Videoidéer och granskning använder `CLAUDE_MODEL`. |
| `CLAUDE_BUDGET_SEK` | nej | Månadstaket för Claude innan du har ändrat det på sidan. Standard `300`. |
| `USD_TO_SEK` | nej | Växelkursen för kostnaderna. Standard `10.5`. |
| `GOOGLE_TTS_API_KEY` | för rösten | API-nyckel från Google Cloud med **Cloud Text-to-Speech API** påslaget. Utan den görs videorna utan berättarröst. |
| `TTS_VOICE` | nej | Rösten. Standard `sv-SE-Chirp3-HD-Aoede` (svensk kvinnoröst). Andra kvinnoröster: `sv-SE-Chirp3-HD-Kore`, `sv-SE-Chirp3-HD-Leda`. |
| `SHOPIFY_STORE_URL` | nej | Butikens adress för att hämta produkter. Standard `https://vardagshoppen.com`. |
| `INBOX_EVERY_MINUTES` | nej | Hur ofta kommentarer och DM hämtas. Standard `10`. |

### Instagram och Facebook

1. Gör Instagram-kontot till ett **företagskonto** och koppla det till en **Facebook-sida** för Agent UF.
2. Skapa en app på developers.facebook.com (typ *Business*) och lägg till **Instagram** och **Messenger**.
3. Ge appen behörigheterna `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_engagement`, `pages_messaging`, `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_messages`, `read_insights` och `instagram_manage_insights` (de två sista för resultaten).
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
