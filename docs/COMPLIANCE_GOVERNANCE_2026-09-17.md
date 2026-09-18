# Lead Manager compliance governance baseline — 2026-09-18

**Version:** 1.1  
**Ejer:** Skarp Studio / Lead Manager  
**Status:** Operationel compliance-baseline for produktdesign, drift, kundeaftaler og juridisk review. Dokumentet er ikke en erklæring om, at alle eksterne aftaler, overførselsgrundlag eller myndigheds-/leverandørverifikationer er afsluttet.

## 1. Rollefordeling er behandlingsspecifik

Lead Manager understøtter self-service, managed service og hybridmodeller. Rollen som dataansvarlig, fælles dataansvarlig eller databehandler skal derfor fastlægges pr. behandlingsaktivitet.

- Kunden er typisk dataansvarlig, når kunden selv fastlægger formål, målgruppe, kontaktpolitik og væsentlige kriterier, mens Lead Manager alene udfører behandling efter instruks.
- Skarp Studio / Lead Manager kan være selvstændigt dataansvarlig for managed lead sourcing/berigelse, hvis Skarp Studio selv fastlægger formål eller væsentlige midler.
- Fælles dataansvar kan foreligge, hvis Skarp Studio og kunden sammen bestemmer formål og væsentlige hjælpemidler for samme behandling.
- Skarp Studio / Lead Manager er selvstændigt dataansvarlig for egne platformformål som konto-/brugeradministration, sikkerhed, misbrugsforebyggelse, fakturering, egne auditlogs og retlige forpligtelser.

Kontraktens titel afgør ikke rollen. Den faktiske beslutningskompetence gør.

Den detaljerede beslutningsmodel findes i `docs/LEGAL_ROLE_AND_PROCESSING_MATRIX_2026-09-18.md`.

## 2. Art. 30-fortegnelser

Der skal sondres mellem:
- **dataansvarliges fortegnelse** efter artikel 30, stk. 1, for Skarp Studios egne controller-formål og eventuelle managed controller-aktiviteter,
- **databehandlerens fortegnelse** efter artikel 30, stk. 2, for kategorier af behandling udført på vegne af kunder.

For hver aktivitet registreres som minimum: rolle, formål/instruks, kategorier af registrerede og data, kilder, modtagere, subprocessorer, eventuelle overførsler, retention, sikkerhedsforanstaltninger, systemejer og reviewdato.

## 3. Retsgrundlag og LIA

En dataansvarlig, der anvender artikel 6, stk. 1, litra f, skal kunne dokumentere:
1. en konkret, reel og aktuel legitim interesse,
2. nødvendighed og mindre indgribende alternativer,
3. interesseafvejning over for den registreredes rettigheder og rimelige forventninger.

“B2B”, “offentlig kilde” eller “salg” er ikke selvstændige retsgrundlag.

## 4. Direkte markedsføring

GDPR-retsgrundlag og kanalregler efter markedsføringsloven vurderes separat.

Elektronisk post med direkte markedsføring må som udgangspunkt ikke sendes til en bestemt modtager uden forudgående samtykke. Offentlig arbejdsmail er ikke samtykke. En eventuel eksisterende-kundefravigelse må kun anvendes, når alle lovens konkrete betingelser er dokumenteret. En CRM-status “kunde” er ikke nok.

Stopliste, indsigelse og do-not-contact skal teknisk overtrumfe salgsautomatisering.

Telefonisk kontakt og andre kanaler skal vurderes separat; systemet må ikke falde tilbage til telefon alene fordi e-mail er blokeret.

## 5. Provenance, artikel 13 og artikel 14

Personhenførbare B2B-kontaktdata skal have dokumenteret provenance.

- Direkte indsamling hos personen: artikel 13.
- Indirekte indsamling: artikel 14.

Ved artikel 14 skal information som udgangspunkt gives senest én måned efter indsamling, ved første kommunikation hvis tidligere, eller ved første videregivelse hvis tidligere.

Eventuelle undtagelser skal vurderes konkret og dokumenteres. Lead Manager må ikke have en generel “offentlig kilde = ingen notice”-regel.

Ved managed sourcing skal der registreres, **hvem der var dataansvarlig ved indsamlingen**, så notice-ansvaret ikke falder mellem Skarp Studio og kunden.

## 6. Managed lead delivery

Hvis Skarp Studio indsamler og beriger leads som selvstændigt dataansvarlig og derefter leverer dem til kunden, skal følgende være dokumenteret:
- Skarp Studios retsgrundlag,
- Skarp Studios oplysningspligt,
- lovligheden/formålet med videregivelsen,
- kundens retsgrundlag ved modtagelse,
- kundens egen transparensforpligtelse,
- vurdering af om der i stedet foreligger fælles dataansvar.

En databehandleraftale må ikke anvendes som erstatning for denne analyse.

## 7. Retention og sletning

Retention er formåls- og rollebaseret. Der findes ikke én universel GDPR-frist.

Lead Manager anvender review, karantæne og anonymisering. Automatisk sletning/anonymisering skal respektere aktive formål, retlige opbevaringskrav, tvister, sikkerhedsbehov og dokumenteret stopliste/indsigelsesbevis.

Når Skarp Studio er databehandler, skal sletning/returnering ved ophør følge kundens instruks og artikel 28-aftalen. Når Skarp Studio er selvstændigt dataansvarlig, følger retention Skarp Studios eget dokumenterede formål og retsgrundlag.

## 8. Registreredes rettigheder

Rettighedsansvaret følger controllerrollen.

- I processorflows assisterer Lead Manager kunden i at opfylde rettigheder.
- I Skarp Studios egne controllerflows skal Skarp Studio selv kunne modtage og håndtere anmodninger.
- Ved fælles dataansvar skal artikel 26-arrangementet fastlægge den praktiske ansvarsfordeling uden at begrænse den registreredes lovbestemte rettigheder.

Direkte-marketingindsigelser implementeres straks i kanal-/stoplistelaget.

## 9. Databehandlere, underdatabehandlere og andre modtagere

Når Skarp Studio er dataansvarlig, kan Supabase, Vercel, OpenAI, Google og Microsoft være databehandlere afhængigt af funktionen.

Når Skarp Studio er databehandler for kunden, vil relevante tekniske leverandører typisk være underdatabehandlere.

For hver kæde verificeres: rolle, aftalegrundlag, instruks, subprocessorbemyndigelse, behandlingssted, internationale overførsler, sikkerhed, sletning/returnering, incident-varsling og reviewdato.

## 10. Kontraktmodel

Eksterne kunder må ikke alle få samme juridiske bilag uden klassifikation.

Mindstekategorier:
- `self_service_processor`
- `managed_processor`
- `managed_controller_to_controller`
- `joint_controller`
- `hybrid`

Processorflows kræver artikel 28-aftale. Fælles dataansvar kræver artikel 26-arrangement. Controller-to-controller-flow kræver selvstændige retsgrundlag og vurdering af videregivelse/modtagelse.

## 11. Incident og brud

Sikkerheds-/compliance-hændelser logges straks. Mulige persondatasikkerhedsbrud kræver vurdering af fortrolighed, integritet og tilgængelighed, berørte personer/data, sandsynlige konsekvenser, containment og eventuelle anmeldelses-/underretningsforpligtelser.

Processor skal kunne bistå kunden med kundens brudsvurdering og varsle uden unødig forsinkelse efter aftalen og artikel 28.

## 12. AI-governance og AI Act

AI er beslutningsstøtte. Human review, no-autonomous-send, forbud mod personlig AI-kreditscoring og dataminimering er bindende produktkontroller.

AI-literacy skal ikke være en symbolsk checkbox. Der skal træffes proportionale foranstaltninger til at understøtte medarbejderes og relevante operatørers AI-kompetence.

Siden 2. august 2026 gælder AI Act artikel 50-transparenskrav for visse AI-systemer. Lead Manager skal derfor vurdere feature-for-feature:
- direkte AI-interaktion med fysiske personer,
- genereret/manipuleret indhold,
- eventuelle public-interest-tekster,
- om menneskelig redaktionel kontrol og ansvar ændrer den konkrete disclosure-pligt.

## 13. DPIA og ændringsstyring

DPIA er en controllerforpligtelse. Lead Managers produkt-DPIA er en platform-/designbaseline og erstatter ikke kundens egen vurdering, hvis kundens konkrete behandling sandsynligvis medfører høj risiko.

Når Skarp Studio er selvstændigt eller fælles dataansvarlig i managed flows, skal Skarp Studio selv vurdere og om nødvendigt gennemføre DPIA for den konkrete behandling.

Materiale ændringer i kilder, autonomi, profilering, mailadgang, kredit, managed service, subprocessorer eller skala genåbner DPIA-/rolle-review.

## 14. Compliance release gate

En release må ikke alene passere tekniske tests. Følgende juridiske invariants skal også være opfyldt:
- behandlingsrolle kendt,
- retsgrundlag/instruks kendt,
- artikel 13/14 ansvar kendt,
- marketingkanal tilladt,
- provenance tilgængelig,
- retention definieret,
- rettighedsansvar defineret,
- leverandørrolle/aftalegrundlag kendt,
- AI-autonomi og transparens vurderet.

## 15. Eksterne forhold der ikke kan “kodes grønne”

Følgende kræver reel dokumentation og kan ikke selv-certificeres i software:
- juridisk identitet og kontaktoplysninger for den kommercielle udbyder,
- kunde-/service-specifik rolleklassifikation,
- artikel 26/28/controller-to-controller kontrakter,
- LIA’er,
- DPIA-sign-off hvor relevant,
- subprocessor- og transferreview,
- Google restricted-scope/OAuth-verifikation og evt. sikkerhedsassessment,
- AI-literacy records,
- ekstern juridisk review af endelig kommerciel privacy notice, vilkår og DPA.

**Primære retskilder:** GDPR art. 4(7)-(8), 5, 6, 12-14, 21, 22, 26, 28, 30, 32, 33-35; EDPB Guidelines 07/2020; Datatilsynets vejledninger om roller, direkte markedsføring og konsekvensanalyse; markedsføringsloven § 10; EU AI Act art. 4 og 50.
