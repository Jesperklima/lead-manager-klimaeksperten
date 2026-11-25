# Automatisk dato i tilbudsopfølgning

Mailvinduet indsætter én dansk opfølgningssætning før den afsluttende hilsen. Den valgte kalenderdato er fælles for tekst, afsendelsesanmodning og den eksisterende serverbaserede lagring i tilbudspipelinen. Ingen databasemigration er nødvendig.

`followup-date-v1.js` håndterer kalenderdatoer, Europe/Copenhagen, formatering og idempotent opdatering af sætningen. Åbning, skabelonvalg, indtastning og +7/+14 udløser opdatering. Øvrig tekst bevares under datoændringer. Begge afsendelsesveje kontrollerer datoen og læser tekst/dato igen efter asynkrone kontroller. Tomme/ugyldige datoer blokerer afsendelse.

Produktionsgrundlaget blev kontrolleret mod Vercel-deployment `dpl_DUNVYTYR8qjfijNqmsWobnwKYgXB`. Tre kildefiler (`api/app.js`, `index.html`, `offer-mail-pdf-v1.js`) indeholdt allerede nyere produktionsrettelser end GitHub main `cfe40e2`. Disse rettelser er bevaret i denne ændring. Alle andre 80 produktionsfiler matchede den lokale GitHub-kopi med SHA-1. Supabase-funktioner ændres ikke.

Test: `node scripts/test-followup-date.js` kører de faktiske skabelon-, genvejs- og afsendelsesfunktioner med stubbet netværk. Dækker de to aktive Supabase-skabeloner, fremtidige skabeloner, standardtekst, skabelonskift, manuelle ændringer, dubletter, ugyldige datoer, sommertid, årsskifte, skudår og ændringer under PDF-kontrol. Samme test er kørt med amerikansk og UTC+14 lokal tidszone. Eksisterende regressionstests for mails, datoer, OAuth, modtagere, historik, UI og performance består. Ingen kundemails afsendes af testene.
