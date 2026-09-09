# Minuba Assistant

Privat, read-only MCP-forbindelse mellem ChatGPT og Klimaekspertens Minuba.

## Formål

Gør det muligt at have et fast ChatGPT-projekt til Minuba-spørgsmål, hvor nye chats kan slå live op i Minuba uden at gå gennem Lead Managers brugerflade.

## Sikkerhedsgrænse

Denne mappe og dens forbindelse er designet til at være uafhængig af Lead Managers aktive Minuba-token.

- Ingen læsning af Lead Managers access/refresh tokens.
- Ingen skrivning til Lead Managers OAuth-tabeller.
- Ingen mutationer i Minuba.
- Ingen ændringer på Lead Managers `main`-branch eller produktion er nødvendige for løsningen.

## Verificerede Minuba-data i v0.1

- `Client` med adresser.
- `Order` med `state=proposal` for aktive tilbud.
- `Order` med `state=new|started|delayed|completed|closed` for ordrer.

Der tilføjes ikke ukendte Minuba-endpoints ud fra gæt.

## MCP-værktøjer

- `search(query)` – standard read-only søgning.
- `fetch(id)` – standard read-only hentning af én konkret post.
- `connection_status()` – viser status for Minuba Assistants egen forbindelse.

## Separat OAuth

Miljøvariabler:

```text
PUBLIC_BASE_URL=https://<assistant-host>
MINUBA_ASSISTANT_CLIENT_ID=<separat Minuba OAuth client id>
MINUBA_ASSISTANT_CLIENT_SECRET=<separat Minuba OAuth client secret>
MINUBA_ASSISTANT_REDIRECT_URI=https://<assistant-host>/oauth/callback
MINUBA_ASSISTANT_SCOPE=Administrator
```

OAuth-flow:

1. Åbn `/connect`.
2. Godkend den separate Minuba Assistant-integration hos Minuba.
3. Minuba sender callback til `/oauth/callback`.
4. Assistenten gemmer sit eget access/refresh-token og fornyer access-token automatisk.

Den første OAuth-godkendelse kan ikke erstattes af at kopiere Lead Managers token uden at koble de to integrationers token-livscyklus sammen.

## Før produktion

Den nuværende branch er et isoleret scaffold. Tokenlageret i `src/server.ts` er med vilje kun in-memory, så udviklingsversionen ikke skriver credentials ind i Lead Managers eksisterende database. Før permanent deployment skal Minuba Assistant have sit eget persistente, krypterede tokenlager (helst separat Supabase-projekt eller anden dedikeret secret/database storage).

## ChatGPT-projekt

Brug teksten i `PROJECT_INSTRUCTIONS.md` som projektinstruks. Når MCP-serveren er hostet og tilføjet som privat ChatGPT-plugin/connector, kan nye chats i projektet bruge Minuba-værktøjerne direkte.
