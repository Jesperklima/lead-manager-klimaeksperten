# Lead Manager SaaS – pakkematrix

Denne fil er source of truth for hvilke funktioner en kunde må se og bruge.

## Pakke 1 · Start

Formål: Leadmotor og enkel CRM-opfølgning.

- Dashboard
- Alle leads
- Lead pipeline
- Kalender til lead-opfølgning
- Aktivitetslog
- Lead Manager basis
- Autonomous Lead Hunter
- Lead Analyzer / Lead Enricher
- Op til 100 leverede leads pr. måned
- Maks. 4 Lead Hunter-kørsler pr. dag
- Op til 150 kontaktberigelser pr. måned

Ikke inkluderet:
- Mailovervågning
- Direkte mailafsendelse
- AI-mailassistent
- Tilbud
- Tilbudspipeline
- Aktivitetsrapport
- Mailgodkendelser
- Udbuds-/tendersøgning
- Minuba

## Pakke 2 · Pro

Alt i Pakke 1 plus:

- Mailovervågning og mailhistorik
- Direkte mailafsendelse med manuel godkendelse
- AI-mailudkast i kundens egen tone of voice
- Tilbud
- Tilbudspipeline
- Aktivitetsrapport
- Godkendelsescenter
- Op til 300 kontaktberigelser pr. måned
- Op til 300 AI-mailudkast pr. måned
- Fair-use: maks. 100 manuelle mails pr. dag

Ikke inkluderet:
- Udbuds-/tendersøgning
- Minuba

## Pakke 3 · Business

Alt i Pakke 2 plus:

- Opportunity & Tender Hunter
- Minuba-integration
- Op til 600 kontaktberigelser pr. måned
- Op til 1.000 AI-mailudkast pr. måned
- Fair-use: maks. 200 manuelle mails pr. dag

## Sikkerhed

Feature-adgang håndhæves både i frontend og backend. En skjult menu er ikke i sig selv en sikkerhedsgrænse.

- Tenant-adgang bindes til Supabase `auth.uid()`.
- Pakke 1 kan ikke læse eller ændre mail- eller tilbudstabeller via REST API.
- Plan og fair-use kan kun ændres af backend/service role.
- Forbrug kan ikke nulstilles af kunden ved at slette CRM-data.
- Kundens Lead Hunter bruger kun kundens egen capability profile, geografi, målgrupper og exclusions.
