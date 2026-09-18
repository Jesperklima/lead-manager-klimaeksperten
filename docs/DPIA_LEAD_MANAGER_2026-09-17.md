# DPIA – Lead Manager

**Dokumenttype:** Konsekvensanalyse vedrørende databeskyttelse (DPIA)  
**Produkt:** Lead Manager  
**Version:** 1.1  
**Dato:** 18. september 2026  
**Status:** Udarbejdet – afventer formelt sign-off  
**Dokumentejer:** Skarp Studio / Lead Manager  
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

### 2.1 Rollen fastlægges pr. behandling – ikke pr. kunde

Lead Manager må ikke beskrive rollefordelingen som én fast konstruktion, hvor kunden altid er dataansvarlig og Skarp Studio / Lead Manager altid er databehandler. Efter GDPR afhænger rollen af de faktiske beslutninger om **formål** og **væsentlige hjælpemidler** i den konkrete behandling.

- **Dataansvarlig:** den part, der alene eller sammen med andre bestemmer formål og væsentlige hjælpemidler.
- **Databehandler:** den part, der behandler personoplysninger på vegne af den dataansvarlige og efter dokumenteret instruks. Databehandleren kan træffe almindelige tekniske og organisatoriske valg inden for instruksen, men må ikke selv overtage behandlingsformålet eller væsentlige beslutninger om rækkevidde.
- **Fælles dataansvar:** kan opstå, hvis Skarp Studio / Lead Manager og kunden i fællesskab bestemmer formål og væsentlige hjælpemidler for samme behandling. Rollen følger de faktiske forhold og kan ikke skabes eller fjernes alene ved kontrakttekst.

### 2.2 Behandlingsmodeller

1. **Self-service SaaS:** Kunden vælger egne leads, målgrupper, formål, kontaktpolitik og opfølgning. Skarp Studio / Lead Manager leverer systemet og behandler kundedata efter instruks. Her vil kunden som udgangspunkt være dataansvarlig, og Skarp Studio / Lead Manager databehandler for kundedata.
2. **Managed CRM efter instruks:** Skarp Studio arbejder aktivt i kundens CRM, men kunden fastlægger formål, målgrupper, kontaktpolitik og væsentlige kriterier. Dette kan fortsat være en databehandlerkonstruktion, hvis Skarp Studio reelt handler inden for dokumenteret instruks.
3. **Managed lead research/sourcing:** Hvis Skarp Studio selv vælger eller har selvstændig indflydelse på datakilder, søgekriterier, hvilke personer der indsamles om, berigelsesmetoder eller kvalificeringslogik, kan Skarp Studio være selvstændigt dataansvarlig for sourcing-/berigelsesfasen. Kunden kan derefter være selvstændigt dataansvarlig for sin videre anvendelse.
4. **Fælles kampagne-/leadmodel:** Hvis Skarp Studio og kunden sammen fastlægger kampagnens formål, målgruppe og væsentlige midler, kan der foreligge fælles dataansvar efter artikel 26.
5. **Platformens egne formål:** Skarp Studio / Lead Manager er selvstændigt dataansvarlig for bl.a. konto- og brugeradministration, sikkerhed, misbrugsforebyggelse, fakturering, egne auditlogs og opfyldelse af egne retlige forpligtelser.
6. **Support/impersonation:** Supportadgang til kundedata vil normalt ske som del af databehandlerrollen, når den sker på kundens instruks og alene for kundens formål. Egne sikkerheds- og auditlogs kan samtidig være platformens eget controller-formål.
7. **Produktforbedring:** Kundedata må ikke automatisk genbruges til Skarp Studios eget produktforbedringsformål under henvisning til databehandlerrollen. Hvis Skarp Studio bestemmer et selvstændigt formål, kræves særskilt vurdering af rolle, retsgrundlag, transparens, kompatibilitet og kontrakt.

### 2.3 Kontraktmæssig konsekvens

Rollefordelingen skal dokumenteres pr. service/behandlingsaktivitet:
- artikel 28-databehandleraftale ved reel processorbehandling,
- controller-to-controller-vurdering ved videregivelse mellem selvstændige dataansvarlige,
- artikel 26-arrangement ved fælles dataansvar.

En standard-databehandleraftale må ikke anvendes som juridisk “etiket” på en behandling, der faktisk er selvstændigt eller fælles dataansvar.

### 2.4 Interne ansvar

- Produktejer har ansvar for privacy-by-design og for at juridiske rolleændringer udløser review.
- Platformadministratorer har udvidet adgang til support- og compliancefunktioner.
- Impersonation/supportadgang skal være formålsbundet, mindst muligt, tidsbegrænset hvor praktisk muligt og logget.
- Kundens egne brugere må kun få adgang til autoriserede tenants.
- Managed service skal klassificeres juridisk før behandling starter.

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

## 7. Retsgrundlag, nødvendighed og markedsføring

Det konkrete retsgrundlag skal fastlægges af den part, der er dataansvarlig for den konkrete behandling. At en behandling er B2B, at oplysningerne er offentligt tilgængelige, eller at en person optræder professionelt, er ikke i sig selv et retsgrundlag.

### 7.1 Eksisterende kunder og CRM

Behandling af kontaktpersoner hos eksisterende kunder kan afhængigt af formål og kontekst være baseret på bl.a. legitim interesse, kontraktrelateret administration eller retlig forpligtelse. Artikel 6, stk. 1, litra b, kan ikke uden videre bruges for kontaktpersoner, der ikke selv er part i kontrakten; i sådanne tilfælde vil legitim interesse ofte skulle vurderes særskilt.

### 7.2 B2B lead research og berigelse

Hvor artikel 6, stk. 1, litra f anvendes, skal der foreligge en dokumenteret interesseafvejning (LIA) med tre led:

1. **Legitim interesse:** Interessen skal være konkret, reel og aktuel.
2. **Nødvendighed:** Det skal vurderes, om formålet kan opnås med færre eller mindre indgribende personoplysninger.
3. **Afvejning:** Der skal tages stilling til personens rimelige forventninger, datakilde, professionel rolle, datatyper, omfang, konsekvenser, mulighed for indsigelse og øvrige safeguards.

En generisk formulering som “legitim interesse i salg” er ikke tilstrækkelig dokumentation.

Offentlig tilgængelighed er kun en omstændighed i vurderingen. En offentlig arbejdsmail, LinkedIn-profil eller virksomhedswebside giver ikke i sig selv tilladelse til at indsamle, opbevare eller markedsføre uden yderligere vurdering.

### 7.3 Direkte elektronisk markedsføring

GDPR og markedsføringsloven er to selvstændige lag.

Efter det danske spamforbud må en erhvervsdrivende som udgangspunkt ikke sende elektronisk post med henblik på direkte markedsføring til en bestemt modtager uden forudgående samtykke. Reglen gælder ikke kun private forbrugere; ordlyden omfatter “nogen”.

En eventuel eksisterende-kundefravigelse må kun anvendes efter konkret dokumentation af samtlige betingelser, herunder at kontaktoplysningen blev modtaget i forbindelse med salg, markedsføringen vedrører egne tilsvarende produkter/ydelser, og modtageren havde og fortsat har let og gebyrfri mulighed for at frabede sig markedsføring.

En CRM-status som “kunde” er derfor ikke tilstrækkelig i sig selv.

Lead Manager skal holde følgende adskilt:
- GDPR-grundlag for opbevaring/berigelse,
- tilladelse til den konkrete marketingkanal,
- indsigelse/stopliste,
- artikel 13/14-transparens.

### 7.4 Telefon og andre kanaler

Telefonisk kontakt skal vurderes særskilt efter modtagertype, formål og gældende markedsførings-/forbrugerlovgivning. Lead Manager må ikke antage, at et telefonnummer automatisk må bruges, fordi e-mail er blokeret.

### 7.5 Mailintegration

Kundens OAuth- eller IMAP/SMTP-autorisation er en teknisk adgangsgodkendelse og er ikke i sig selv GDPR-retsgrundlag for al behandling af mailindhold. Formål, nødvendighed, dataminimering, retention og adgang skal stadig vurderes.

---

## 8. Oplysningspligt og transparens

### 8.1 Artikel 13 og artikel 14

- Indsamles oplysninger direkte hos personen, gælder artikel 13.
- Indsamles oplysninger fra andre kilder, gælder artikel 14.

Ved artikel 14 skal den dataansvarlige som udgangspunkt give de krævede oplysninger:
- inden for en rimelig frist og senest én måned efter indsamling,
- hvis oplysningerne skal bruges til kommunikation med personen: senest ved første kommunikation,
- hvis oplysningerne skal videregives: senest ved første videregivelse.

Informationen skal bl.a. omfatte identitet og kontaktoplysninger på den dataansvarlige, formål, retsgrundlag, datakategorier, modtagere, opbevaring, relevante rettigheder, kilde og om oplysningerne stammer fra offentligt tilgængelige kilder.

### 8.2 Undtagelser

Undtagelser fra artikel 14 må ikke anvendes som en generel undtagelse for lead research. Hvis en undtagelse påberåbes, skal den vurderes konkret, dokumenteres og kunne forsvares. En vurdering af “uforholdsmæssig stor indsats” er ikke det samme som, at det er upraktisk eller dyrt.

### 8.3 Managed leads og videregivelse

Hvis Skarp Studio er selvstændigt dataansvarlig for sourcing/berigelse og videregiver et lead til kunden, skal der foretages særskilt vurdering af:
- Skarp Studios oplysningspligt,
- lovligheden af videregivelsen,
- kundens oplysningspligt ved modtagelse,
- om parterne i stedet har fælles dataansvar.

En privacy-meddelelse må ikke bruges som markedsføringsmail eller som påskud til at omgå spamforbuddet.

Lead Manager skal registrere provenance, indsamlingsdato, controller-rolle, notice-status og eventuel konkret undtagelsesbegrundelse.

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

## 12. Databehandlere, underdatabehandlere og selvstændige modtagere

Leverandørens juridiske rolle afhænger også af den behandling, som leverandøren udfører.

Når Skarp Studio / Lead Manager er **dataansvarlig**, kan tekniske leverandører være databehandlere for Skarp Studio / Lead Manager.

Når Skarp Studio / Lead Manager selv er **databehandler for en kunde**, vil de samme tekniske leverandører typisk være **underdatabehandlere** i forhold til kundens data.

Aktuelle væsentlige tekniske leverandører omfatter:
- Supabase – database, auth, Edge Functions og Vault,
- Vercel – hosting og levering,
- OpenAI – AI-assistance,
- Google – Gmail/OAuth hvor relevant,
- Microsoft – Microsoft 365/Graph hvor relevant.

Før bred ekstern lancering skal der for hver relevant behandlingskæde dokumenteres:
- korrekt rolle,
- databehandler-/underdatabehandlergrundlag hvor artikel 28 finder anvendelse,
- instrukser og underdatabehandlerbemyndigelse,
- behandlingssted og eventuelle tredjelandsoverførsler,
- relevant overførselsgrundlag og supplerende foranstaltninger,
- sikkerhed, sletning/returnering og brudhåndtering.

En offentlig DPA eller standardkontrakt er dokumentation, der skal vurderes – ikke automatisk bevis for, at alle konkrete krav er opfyldt.

Google/Gmail restricted scopes håndteres desuden af en særskilt produkt-launch gate.

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
| 14 | Registreret får ikke nødvendig transparens efter art. 13/14 | Middel | Høj | Provenance og notice fields findes; workflow ikke fuldt operationaliseret | Middel | Rød før skalering |
| 15 | Forkert rolleklassifikation mellem kunde og Skarp Studio | Middel | Høj | Juridisk rollematrix, kontraktkrav og feature-review | Middel | Rød før managed skalering |
| 16 | Managed lead videregives uden korrekt controller-to-controller/art. 26-vurdering | Middel | Høj | Rolleklassifikation før serviceaktivering | Middel | Rød før managed skalering |
| 17 | Repository afslører unødigt intern arkitektur | Middel | Middel | Secrets ligger ikke bevidst i repo, Vault anvendes | Middel | Gul |

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
4. **Artikel 13/14-proces:** operationelt workflow fastlægges og dokumenteres med konkrete frister, notice-indhold og undtagelseslogik.
5. **Rolleklassifikation for managed service:** hver managed/hybrid ydelse klassificeres som processor, controller-to-controller eller fælles dataansvar, og kontrakter/onboarding følger klassifikationen.
6. **Authenticated SECURITY DEFINER review:** følsomme funktioner gennemgås og browseradgang fjernes, hvor den ikke er nødvendig.

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

Lead Manager har væsentlige privacy-by-design-kontroller på plads, men den juridiske vurdering kan ikke reduceres til én generel SaaS-rolle. Produktet understøtter både self-service og managed/hybrid behandling, og den faktiske rolle kan derfor skifte mellem behandlinger.

Den nuværende restrisiko vurderes som **middel til høj for managed/hybrid flows, indtil rollefordeling, artikel 13/14-proces og kontraktmodel er operationaliseret**, og som **middel for self-service flows** under de eksisterende tekniske kontroller.

**Konklusion:**

- Intern drift/pilot kan fortsætte under dokumenterede kontroller og begrænset managed anvendelse.
- Self-service SaaS kan juridisk struktureres som klassisk controller/processor, men kun for behandlinger hvor kunden faktisk bestemmer formål og væsentlige midler.
- Managed lead research må ikke automatisk lægges ind under kundens databehandleraftale.
- Før bred managed/hybrid lancering skal rolleklassifikation, art. 13/14, LIA/videregivelse og den korrekte art. 26/28/controller-to-controller kontraktmodel være på plads.
- Bred kommerciel lancering med alle integrationer bør først markeres launch-ready, når de røde blockers er lukket eller fagligt og ledelsesmæssigt accepteret på et dokumenteret grundlag.
- Gmail til brede eksterne kunder forbliver særskilt launch-gated, indtil Google-kravene er dokumenteret opfyldt.

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

- GDPR artikel 4(7)-(8), 5, 6, 12-14, 21, 22, 26, 28, 30, 32 og 35.
- Datatilsynet – Rollefordeling: Dataansvarlig og databehandler; vejledning om dataansvarlige og databehandlere; direkte markedsføring; konsekvensanalyse.
- European Data Protection Board (EDPB) – Guidelines 07/2020 on the concepts of controller and processor in the GDPR.
- Markedsføringsloven § 10 og Forbrugerombudsmandens vejledning/praksis om spamforbuddet.
- EU AI Act, herunder artikel 4 og artikel 50, hvor anvendeligt.
- Lead Managers interne privacy-, AI-governance-, retention- og compliance-kontroller.
