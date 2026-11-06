# Shopify-tema (säkerhetskopia)

Kopior av egna filer i Vardagshoppens Shopify-tema. Butiken läser inte härifrån; filerna laddas upp till temat i Shopify.

- `sections/vs-home.liquid` – startsidan med vinterdesign (tema "Vardagshoppen – vinterdesign", 2 nov 2026).
- `sections/agentuf-home-desktop.liquid` – den äldre startsidan som bara visades på dator.

## Enproduktsbutik (7 nov 2026, tema "Vardagshoppen – enproduktsbutik (förhandsvisa)", id 204931203336)

Kopia av temat som var live ("förbeställning"), ombyggd till en butik för en enda produkt: tasstvättkitet. Inte publicerad.

- `sections/vh-landing.liquid` – ny startsida: topp med produktbild och färgväljare, problemet, lösningen, så gör du (3 steg), fördelar och storlekar, omdömen (bara riktiga, inga finns än), köpdel med färg/storlek/paket och riktig "Lägg i varukorgen", vanliga frågor. Följeknapp på mobilen. Lätta animationer som stängs av vid "minska rörelse". Ingen 3D-modell (ingen riktig modell av produkten finns).
- `templates/index.json` – startsidan består bara av `vh-landing`.
- `sections/agentuf-footer.liquid` – sidfoten utan "Sortiment/Alla produkter".
- `snippets/vh-mobile-drawer.liquid` – mobilmenyn länkar till köpdelen.
- I temat (inte här): menyn heter nu `enprodukt-meny` i `sections/header-group.json`, och "Du kanske också gillar" är borttaget från produktsidan (`templates/product.json`).
