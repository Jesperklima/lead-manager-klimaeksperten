# Lead Manager SaaS – pakkematrix

Denne fil er source of truth for hvilke funktioner en kunde må se og bruge.

## Pakke 1 · Start

Formål: Leadmotor, enkel CRM-opfølgning og manuel kundekontakt fra CRM.

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
- Forbind kundens egen mailkonto
- Skriv og send mails direkte fra Lead Manager via kundens egen mail
- Fair-use: maks. 100 manuelt sendte mails pr. dag

Ikke inkluderet:
- Mailovervågning og læsning af svar
- Automatisk CRM-opdatering ud fra mailsvar
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
- Systemet læser relevante svar og opdaterer leadstatus/opfølgning
- AI-mailudkast i kundens egen tone of voice
- Tilbud
- Mailstyret Tilbudspipeline
- Aktivitetsrapport
- Godkendelsescenter
- Op til 300 kontaktberigelser pr. måned
- Op til 300 AI-mailudkast pr. måned

Ikke inkluderet:
- Udbuds-/tendersøgning
- Minuba-verifikation

## Pakke 3 · Business

Alt i Pakke 2 plus:

- Opportunity & Tender Hunter
- Minuba-integration
- Minuba-verifikation af tilbudsstatus, ordre og tidligere kundeforhold
- Op til 600 kontaktberigelser pr. måned
- Op til 1.000 AI-mailudkast pr. måned
- Fair-use: maks. 200 manuelt sendte mails pr. dag

## Sikkerhed

Feature-adgang håndhæves både i frontend og backend. En skjult menu er ikke i sig selv en sikkerhedsgrænse.

- Tenant-adgang bindes til Supabase `auth.uid()`.
- Pakke 1 kan sende via egen mail, men kan ikke læse mailhistorik eller tilbudstabeller via REST API.
- Plan og fair-use kan kun ændres af backend/service role.
- Forbrug kan ikke nulstilles af kunden ved at slette CRM-data.
- Kundens Lead Hunter bruger kun kundens egen capability profile, geografi, målgrupper og exclusions.
