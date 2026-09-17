# DPIA – Lead Manager

**Dokumenttype:** Konsekvensanalyse vedrørende databeskyttelse (DPIA)  
**Produkt:** Lead Manager  
**Version:** 1.0  
**Dato:** 17. september 2026  
**Status:** Udarbejdet – afventer formelt sign-off  
**Dokumentejer:** Lead Manager / Klimaeksperten ApS  
**Review:** Skal genvurderes ved væsentlige ændringer i datakilder, AI-funktioner, mailintegrationer, kreditfunktioner eller kundetyper.

> Denne DPIA er et operationelt compliance-dokument for Lead Manager. Den beskriver den aktuelle løsning og de kendte risici og kontroller. Den er ikke en juridisk garanti eller myndighedsgodkendelse.

---

## 1. Formål og baggrund

Lead Manager er et B2B CRM- og lead management-system, der hjælper virksomheder med at finde, berige, prioritere og følge op på erhvervsleads. Systemet kan indsamle virksomheds- og kontaktoplysninger fra offentligt tilgængelige kilder, udbud, referater, kundens egne mailsystemer og integrerede systemer som Minuba og sociale medie-/kampagneflows.

Systemet anvender AI til bl.a. klassifikation, opsummering, prioritering, mailudkast og salgsassistance. AI må ikke sende mails automatisk uden menneskelig handling og må ikke træffe juridisk bindende afgørelser om personer. Personlig kreditvurdering af fysiske personer er ikke tilladt i produktets AI-governance.

Denne DPIA gennemføres, fordi løsningen kombinerer flere behandlingsformer, som samlet kan medføre forhøjet risiko for registreredes rettigheder og frihedsrettigheder, herunder:

- systematisk indsamling og berigelse af erhvervskontaktdata,
- profilering/prioritering af leads,
- behandling af mailhistorik,
- integrationer til eksterne platforme,
- anvendelse af AI på CRM-data,
- behandling af data om kontaktpersoner, som ikke nødvendigvis selv har afgivet oplysningerne direkte.

DPIA'en følger GDPR artikel 35-principperne og EDPB's DPIA-struktur: beskrivelse af behandling, nødvendighed/proportionalitet, vurdering af risici og dokumentation af mitigerende foranstaltninger.

---

## 2. Roller og ansvar

### 2.1 Dataansvarlig og databehandler

Lead Manager kan anvendes i to roller:

1. **Klimaeksperten/Lead Manager som dataansvarlig** for egne leads, egne kontaktdata, egne mailflows og egen salgsaktivitet.
2. **Lead Manager som databehandler** for eksterne kunder, hvor kunden er dataansvarlig for egne leads, kontaktpersoner, mails og behandlingsformål.

Rollefordelingen skal fremgå af kundeaftale/databehandleraftale.

### 2.2 Interne ansvar

- Produktejer har ansvar for produktets privacy-by-design og sikkerhed.
- Platformadministratorer har udvidet adgang til support- og compliancefunktioner.
- Impersonation/supportadgang skal være begrænset, logget og anvendt efter behov.
- Kundens egne brugere må kun få adgang til deres egen tenant.

---

## 3. Registrerede personer

Systemet kan behandle oplysninger om:

- medarbejdere, ledere og kontaktpersoner i virksomheder,
- potentielle B2B-kunder,
- eksisterende kunder og leverandørkontakter,
- brugere af Lead Manager,
- personer der optræder i mailkorrespondance,
- kontaktpersoner omtalt i udbud, offentlige dokumenter, referater og andre erhvervsrelaterede kilder.

Systemet er designet til B2B og ikke til privatkundeleads.

---

## 4. Kategorier af personoplysninger

### 4.1 Almindelige personoplysninger

Lead Manager kan behandle:

- navn,
- jobtitel og rolle,
- arbejdsmail,
- arbejds- og direkte telefonnummer,
- LinkedIn-/professionel profil-URL,
- virksomhedstilknytning,
- adresse og lokationsoplysninger knyttet til arbejdssted,
- mailhistorik, emnelinjer og brødtekst,
- CRM-noter og kontaktforsøg,
- oplysninger om møder, tilbud og opfølgninger,
- kilde/provenance for kontaktoplysninger,
- brugeraktivitet og systemlogning.

### 4.2 Virksomhedsoplysninger

CVR, branche, medarbejderantal, virksomhedsadresse, hjemmeside, kreditoplysninger om juridiske personer og andre rene virksomhedsdata er ikke i sig selv personoplysninger, men kan blive personhenførbare ved enkeltmandsvirksomheder eller sammenkobling med en fysisk person.

### 4.3 Følsomme oplysninger

Lead Manager er ikke designet til at behandle særlige kategorier af personoplysninger efter GDPR artikel 9. AI-governance fastslår, at følsomme personoplysninger ikke må anvendes i AI-prompts som standard.

Hvis systemet utilsigtet modtager følsomme oplysninger i mails eller noter, skal dataminimering, sletning og adgangsbegrænsning anvendes.

---

## 5. Datakilder

Data kan komme fra:

- kundens egne CRM-data,
- kundens mailkonto,
- kundens egen hjemmeside eller kampagneformularer,
- offentlige virksomhedsregistre,
- offentlige hjemmesider,
- offentlige udbud,
- offentlige referater og dagsordener,
- professionelle virksomhedsprofiler,
- Minuba eller andre kundesystemer,
- Skarp Studio/marketingintegrationer,
- manuelt indtastede oplysninger.

Lead Manager må ikke opfinde eller gætte kontaktoplysninger. Systemet har en guard mod inferred/gættede e-mailadresser. Data uden dokumenterbar kilde skal markeres til review eller slettes/anonymiseres efter gældende regler.

---

## 6. Formål med behandlingen

Behandlingen har følgende hovedformål:

- identificere relevante B2B-leads,
- dokumentere virksomheder med sandsynligt eller dokumenteret behov,
- berige leads med verificerede kontaktoplysninger,
- prioritere salgsarbejde,
- håndtere opfølgning og pipeline,
- dokumentere maildialog og salgsaktivitet,
- udarbejde AI-assisterede mailudkast,
- reducere glemte opfølgninger,
- krydstjekke eksisterende kunder og tilbud,
- understøtte compliance, retention og audit.

AI anvendes som beslutningsstøtte og skrive-/analyseværktøj, ikke som autonom beslutningstager med juridisk eller tilsvarende væsentlig virkning for registrerede.

---

## 7. Retsgrundlag og vurdering

Det konkrete retsgrundlag afhænger af behandlingens type og kundens rolle.

### 7.1 CRM og eksisterende kunder

Behandling kan typisk være nødvendig for kontrakt, aftaleopfyldelse, legitim interesse eller retlig forpligtelse afhængigt af den konkrete situation.

### 7.2 B2B lead research

Offentligt tilgængelige erhvervskontaktdata kan behandles på baggrund af legitim interesse, når der er et reelt erhvervsmæssigt formål, behandlingen er nødvendig, forventelig og proportional, og den registreredes interesser ikke vejer tungere.

Der skal foretages og vedligeholdes en særskilt LIA for lead research/prospecting.

### 7.3 Direkte markedsføring

GDPR-retsgrundlag og markedsføringsregler er separate krav. At der findes et GDPR-grundlag betyder ikke automatisk, at en e-mail må sendes som direkte markedsføring.

Lead Manager har derfor en særskilt marketing-gate, som blokerer kolde salgs-/marketingmails uden dokumenteret tilladelse eller relevant lovlig undtagelse.

### 7.4 Mailintegration

Kunden autoriserer selv mailintegration via OAuth eller IMAP/SMTP. Adgangen skal begrænses til de scopes/funktioner, der er nødvendige for de valgte CRM-funktioner.

---

## 8. Artikel 14 og transparens

Når personoplysninger ikke er indsamlet direkte fra personen, kan GDPR artikel 14 medføre oplysningspligt.

Lead Manager understøtter dette ved at registrere:

- kilde/provenance,
- dato for indsamling,
- status for artikel 14-information,
- retention-review,
- review-required status ved manglende dokumentation.

Artikel 14-flowet må ikke implementeres som automatisk kold marketingmail. Oplysningspligt og markedsføring skal holdes adskilt.

---

## 9. AI-behandling

### 9.1 AI-funktioner

AI kan anvendes til:

- tekstklassifikation,
- opsummering,
- lead- og opportunity-analyse,
- mailudkast og omskrivning,
- salgsassistance,
- forslag til næste handling.

### 9.2 Bindende governance-regler

Følgende kontroller er fastsat i Lead Managers governance:

- menneskelig review er påkrævet,
- AI må ikke sende mails uden brugerens godkendelse/handling,
- AI må ikke træffe juridisk bindende eller tilsvarende væsentlige afgørelser,
- personlig kreditvurdering af fysiske personer er ikke tilladt,
- følsomme data i prompts er ikke tilladt som standard,
- AI-outputs skal kunne tilsidesættes af brugeren.

### 9.3 AI-learning

Lead Manager kan gemme eksempler på forskellen mellem AI-udkast og endelig brugerredigering for at forbedre tone og kvalitet. Disse data er underlagt retention og dataminimering og må ikke blive et ubegrænset historisk tekstarkiv.

---

## 10. Automatiseret profilering og beslutninger

Leadscore og prioritering anvendes som salgsstøtte.

De må ikke anvendes til automatisk at træffe afgørelser om en fysisk persons rettigheder, adgang til ydelser, kredit, ansættelse eller andre forhold med juridisk eller tilsvarende væsentlig effekt.

Leadscore vedrører primært virksomhedens salgspotentiale og relevans, ikke personens værdi eller egenskaber.

---

## 11. Kreditvurdering

Systemets kreditfunktion må anvendes på juridiske personer/virksomheder inden for de dokumenterede rammer.

Personligt ejede virksomheder og situationer, hvor kreditvurdering reelt bliver en vurdering af en fysisk person, skal gå til manuel vurdering og må ikke automatisk scores af AI.

---

## 12. Databehandlere og underdatabehandlere

Aktuelle væsentlige leverandører omfatter:

- Supabase – database, auth, Edge Functions og Vault,
- Vercel – hosting og levering,
- OpenAI – AI-assistance,
- Google – Gmail/OAuth hvor relevant,
- Microsoft – Microsoft 365/Graph hvor relevant.

Før bred ekstern lancering skal DPA-status, overførselsgrundlag og relevante vilkår være dokumenteret og reviewet for hver leverandør.

Google/Gmail bruger restricted scopes, og bred ekstern Gmail-lancering holdes blokeret, indtil nødvendig OAuth-verifikation og sikkerhedsassessment er dokumenteret.

---

## 13. Dataflow

Forenklet dataflow:

1. En kilde, integration eller bruger identificerer en virksomhed.
2. Virksomhedsdata oprettes i kundens tenant.
3. Kontaktpersoner beriges fra dokumenterede kilder.
4. Kilde/provenance gemmes.
5. Lead analyseres og prioriteres.
6. Bruger tager stilling til kontakt og opfølgning.
7. Mail sendes kun gennem godkendt/valgt kanal.
8. Mail og CRM-hændelser journalføres.
9. Data gennemgår retention/review.
10. Data slettes/anonymiseres, når formål eller retention udløber, medmindre et andet legitimt behov fortsat gælder.

---

## 14. Adgangskontrol og tenant-isolation

Lead Manager er multi-tenant.

Tekniske kontroller omfatter:

- Row Level Security på CRM-tabeller,
- tenant-bundet adgangskontrol,
- platform-admin checks,
- service-only funktioner til følsomme operationer,
- ingen anonym adgang til SECURITY DEFINER-funktioner,
- separate tenant-refresh-tokens til mailintegrationer,
- secrets i Vault/server-side frem for browserkode,
- audit af cross-tenant RPC'er.

Smoke-tests har bekræftet, at almindelige kunder ikke kan læse en anden kundes tenant via den nye mail-launch status.

---

## 15. Retention og sletning

Lead Manager har et automatiseret retention-flow.

Kontroller omfatter:

- retention queue,
- review-dato,
- quarantine-status,
- anonymisering af prospect-kontaktdata,
- særskilt retention for AI-learning data,
- stop for anonymisering hvis aktivt lead/åbent tilbud giver fortsat behandlingsbehov,
- dagligt cronjob for retention.

Retention skal løbende testes med syntetiske cases, herunder legal hold/åbne tilbud og fuld overgang fra review til anonymisering.

---

## 16. Registreredes rettigheder

Systemet skal understøtte:

- indsigt,
- rettelse,
- sletning,
- begrænsning,
- indsigelse,
- dokumentation af anmodninger,
- håndtering inden for gældende frister.

Der findes en privacy-request struktur i systemet, men den operationelle proces og ansvarlig ejer skal være dokumenteret og testet.

---

## 17. Sikkerhedsforanstaltninger

Nuværende kontroller omfatter bl.a.:

- RLS/tenant-isolation,
- OAuth-tokens og passwords i Vault,
- rotation af tidligere hardcodede webhook-secrets,
- central mail-compliance-gate,
- no-inferred-email guard,
- security headers,
- menneskelig AI-godkendelse,
- audit/compliance-dashboard,
- provenance-review,
- automatisk retention.

Kendte sikkerhedsopgaver, som stadig kræver handling:

- leaked-password protection i Supabase Auth er ikke aktiveret,
- authenticated SECURITY DEFINER-funktioner skal afslutningsvis reviewes én for én,
- `pg_net` ligger fortsat i `public` schema,
- repository-visibility bør vurderes og forventes gjort privat før kommerciel skalering,
- impersonation/supportadgang skal have fuld audit-log og mindst mulig adgangstid.

---

## 18. Risikovurderingsmetode

Risiko vurderes som kombination af:

- **Sandsynlighed:** Lav / Middel / Høj
- **Konsekvens:** Lav / Middel / Høj

Samlet niveau:

- **Grøn:** lav/rest-risiko accepterbar,
- **Gul:** kræver løbende kontrol/forbedring,
- **Rød:** skal reduceres før bred ekstern lancering eller den konkrete funktion aktiveres.

---

## 19. Risikomatrix

| # | Risiko | Sandsynlighed | Konsekvens | Kontroller | Restrisiko | Status |
|---|---|---|---|---|---|---|
| 1 | Kontaktdata uden dokumenterbar kilde | Middel | Middel | Provenance guard, review_required, source fields, no inferred email | Lav-middel | Gul |
| 2 | Kold marketingmail sendes uden lovligt grundlag | Middel | Høj | Central marketing-gate, permissions, suppressions, outbound checks | Lav-middel | Gul |
| 3 | AI sender forkert/uhensigtsmæssig mail autonomt | Lav | Høj | Human review, ingen automatisk AI-send, approval flow | Lav | Grøn |
| 4 | AI træffer væsentlig afgørelse om person | Lav | Høj | Governance forbyder legal-effect decisions og personlig AI-kreditscoring | Lav | Grøn |
| 5 | Cross-tenant adgang til anden kundes data | Lav | Høj | RLS, tenant checks, RPC audit, test af almindelig kunde | Lav | Grøn |
| 6 | OAuth-/mail-token lækkes | Lav-middel | Høj | Vault, server-side tokenhåndtering, platform OAuth-model, disconnect-delete | Lav-middel | Gul |
| 7 | For bred Gmail-adgang før ekstern Google-godkendelse | Middel | Høj | Launch-gate blokerer bred ekstern aktivering | Lav | Rød indtil ekstern godkendelse |
| 8 | For lang opbevaring af leads/mailtekst | Middel | Middel | Retention queue, cron, quarantine, anonymisering | Lav-middel | Gul |
| 9 | Forkert eller gammel kontaktinformation bruges | Middel | Middel | Verified/source fields, review, enrichment-status | Lav-middel | Gul |
| 10 | Følsomme data havner i AI-prompt | Lav-middel | Høj | Governance-forbud, dataminimering, brugerproces | Lav-middel | Gul |
| 11 | Support/impersonation misbruges | Lav | Høj | Admin-only funktion, logging under udbygning | Middel | Gul |
| 12 | Kompromitterede passwords accepteres | Middel | Høj | Auth eksisterer, men leaked-password protection mangler | Middel | Rød |
| 13 | Leverandør/DPA/transfer-grundlag er utilstrækkeligt dokumenteret | Middel | Høj | Subprocessor-register findes, status markeres ikke falsk verificeret | Middel | Rød |
| 14 | Registreret får ikke nødvendig transparens efter art. 14 | Middel | Middel-høj | Provenance og notice fields findes; workflow ikke fuldt operationaliseret | Middel | Gul/Rød før skalering |
| 15 | Repository afslører unødigt intern arkitektur | Middel | Middel | Secrets ligger ikke bevidst i repo, Vault anvendes | Middel | Gul |

---

## 20. Nødvendighed og proportionalitet

### 20.1 Er behandlingen nødvendig?

Ja, i det omfang data er nødvendige for B2B lead management, kontakt, tilbudsopfølgning og CRM-drift. Systemet skal undgå data, der ikke understøtter det konkrete erhvervsformål.

### 20.2 Kan formålet opnås med færre data?

Ja i nogle flows. Derfor skal produktet løbende:

- bruge færrest mulige OAuth-scopes,
- undgå persondata hvor virksomhedsdata er tilstrækkelige,
- undgå at gemme hele mailhistorikker hvis metadata/sammenfatning er nok,
- minimere AI-prompts,
- slette/anonymisere data når formålet bortfalder.

### 20.3 Balance over for registrerede

Risikoreduktionen baseres på:

- B2B-kontekst,
- professionel rolle frem for privat profil,
- dokumenteret kilde,
- begrænset formål,
- indsigelses-/suppression-mekanismer,
- retention,
- ingen gættede e-mails,
- ingen autonom AI-beslutning med væsentlig effekt.

---

## 21. Røde launch-blockers

Følgende skal være lukket eller eksplicit accepteret af ansvarlig ledelse før bred kommerciel lancering:

1. **Google OAuth/CASA:** relevant Google-verifikation og sikkerhedsassessment dokumenteret før bred Gmail-lancering.
2. **Leaked password protection:** aktiveres eller der dokumenteres et tilsvarende kompenserende sikkerhedsniveau.
3. **Subprocessor review:** DPA, transfer-grundlag og relevante vilkår verificeres for aktive kerneleverandører.
4. **Artikel 14-proces:** operationelt workflow fastlægges og dokumenteres.
5. **Authenticated SECURITY DEFINER review:** følsomme funktioner gennemgås og browseradgang fjernes, hvor den ikke er nødvendig.

---

## 22. Gule forbedringspunkter

- Review og løsning af 21 eksisterende kontakter uden fuld provenance.
- Gennemfør AI-literacy/træning og registrer reviewdato.
- Flyt/vurder `pg_net` uden at bryde nødvendige jobs.
- Gør repository private før bred kommerciel skalering.
- Gennemfør fuld retention-smoketest med syntetisk data.
- Hærd impersonation med begrundelse, sessionstid og auditlog.
- Gennemgå alle outbound-mailveje mod den centrale compliance-gate.

---

## 23. Samlet vurdering

Lead Manager har væsentlige privacy-by-design kontroller på plads, herunder tenant-isolation, provenance, marketing-gate, human-in-the-loop AI, retention, Vault-baseret secret-håndtering og compliance-monitorering.

Den nuværende restrisiko vurderes som **middel**, primært fordi enkelte eksterne og operationelle krav endnu ikke er endeligt lukket: Google-verifikation, leverandør/DPA-review, leaked-password protection og fuld operationalisering af artikel 14.

**Konklusion:**

- Intern drift/pilot kan fortsætte under de eksisterende kontroller.
- Bred kommerciel lancering med alle integrationer bør først markeres som fuldt launch-ready, når de røde blockers er lukket eller formelt accepteret med dokumenteret begrundelse.
- Gmail til brede eksterne kunder skal fortsat være launch-gated, indtil Google-kravene er dokumenteret opfyldt.

---

## 24. Sign-off

**DPIA udarbejdet:** 17. september 2026  
**Status:** Udarbejdet – afventer sign-off

**Dataansvarlig / Produktejer**  
Navn: ______________________________  
Dato: ______________________________  
Godkendelse: ________________________

**Privacy / juridisk review**  
Navn: ______________________________  
Dato: ______________________________  
Bemærkninger: _______________________

**Teknisk sikkerhedsreview**  
Navn: ______________________________  
Dato: ______________________________  
Bemærkninger: _______________________

---

## 25. Review-trigger

DPIA'en skal genåbnes ved bl.a.:

- nye AI-modeller eller nye autonome funktioner,
- ændring af menneskelig godkendelse,
- nye datakilder,
- behandling af private forbrugere,
- nye kreditfunktioner,
- behandling af følsomme oplysninger,
- større ændringer i mailadgang/scopes,
- nye subprocessorer,
- større sikkerhedshændelser,
- ændret formål eller væsentligt større skala.

---

## 26. Referencer

- GDPR artikel 35 – Data Protection Impact Assessment.
- European Data Protection Board (EDPB) – Guidelines on DPIA and high-risk processing.
- EDPB – DPIA template/explainer, 2026.
- Lead Managers interne privacy-, AI-governance-, retention- og compliance-kontroller.
