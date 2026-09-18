# Lead Manager – juridisk rolle- og behandlingsmatrix

**Version:** 1.0  
**Dato:** 18. september 2026  
**Ejer:** Skarp Studio / Lead Manager  
**Status:** Bindende compliance-baseline for produktdesign og kontrakter; kræver ekstern juridisk sign-off før bred kommerciel lancering.

## 1. Grundregel

Rollen som dataansvarlig, fælles dataansvarlig eller databehandler fastlægges **for den konkrete behandlingsaktivitet**. Den kan ikke afgøres alene ud fra, hvem der ejer Lead Manager, hvem der fakturerer kunden, eller hvad parterne kalder sig i kontrakten.

- En **dataansvarlig** bestemmer formålet med behandlingen og de væsentlige hjælpemidler.
- En **databehandler** behandler personoplysninger på vegne af en dataansvarlig og efter dokumenteret instruks. Databehandleren kan træffe praktiske/tekniske valg inden for instruksen, men må ikke selv overtage formålet eller væsentlige beslutninger om behandlingen.
- **Fælles dataansvar** kan foreligge, når to eller flere parter i fællesskab bestemmer formål og væsentlige hjælpemidler for samme behandling. Det opstår som følge af de faktiske forhold og kan ikke vælges eller fravælges alene ved kontrakt.

## 2. Behandlingsmodeller

| Model | Faktisk behandling | Primær juridisk rolle | Dokumentkrav |
|---|---|---|---|
| Self-service SaaS | Kunden indlæser egne data, vælger målgrupper, kriterier, formål og opfølgning. Lead Manager hoster, sikrer og udfører funktioner på kundens instruks. | Kunden: dataansvarlig. Skarp Studio / Lead Manager: databehandler for kundedata. | Art. 28-databehandleraftale, instruks, underdatabehandlerliste, sikkerheds-/tilsynsdokumentation. |
| Managed CRM-administration | Skarp Studio arbejder i kundens CRM, men kunden fastlægger formål, målgrupper, kontaktpolitik og væsentlige kriterier. | Som udgangspunkt kunden: dataansvarlig; Skarp Studio / Lead Manager: databehandler for den instruerede behandling. | Art. 28-aftale plus præcis beskrivelse af instrukser og beføjelser. |
| Managed lead research | Skarp Studio vælger eller har selvstændig indflydelse på kilder, sourcing-metode, søgekriterier, berigelse eller kvalificering og producerer leads til kunden. | Skal vurderes konkret. Skarp Studio kan være selvstændigt dataansvarlig for sourcing-/berigelsesfasen. Kunden kan være selvstændigt dataansvarlig for efterfølgende brug. | Retsgrundlag/LIA hos hver dataansvarlig, transparens efter art. 13/14, controller-to-controller-vurdering af videregivelse. DPA alene er ikke tilstrækkelig. |
| Fælles kampagne-/leadmodel | Skarp Studio og kunden beslutter sammen kampagnens formål, målgruppe, væsentlige kriterier og hvordan leaddata skal bruges. | Muligt fælles dataansvar for den fælles behandling. | Art. 26-arrangement med transparent ansvarsfordeling og tilgængeliggørelse af det væsentlige indhold for registrerede. |
| Platformdrift | Konto, login, sikkerhed, misbrugsforebyggelse, fakturering, platformlogning, egne juridiske krav. | Skarp Studio / Lead Manager er selvstændigt dataansvarlig for egne formål. | Eget behandlingsgrundlag, art. 13/14-information, Art. 30-register, retention og rettighedsproces. |
| Support/impersonation | Support får adgang til kundedata for at løse kundens sag. | Normalt del af databehandlerrollen, hvis adgang sker på kundens instruks og alene til kundens formål. Eventuelle egne sikkerheds-/auditlogs kan være platformens eget controller-formål. | Formålsbegrænset adgang, logging, mindst mulig adgang, audit og kontraktuel regulering. |
| Produktforbedring med kundedata | Kundedata anvendes til at forbedre Lead Manager ud over den konkrete kundes tjeneste. | Kan ikke automatisk rummes i databehandlerrollen. Hvis Skarp Studio bestemmer eget produktforbedringsformål, er der et selvstændigt controller-spørgsmål. | Særskilt vurdering af formål, retsgrundlag, kompatibilitet, transparens, kontrakt og dataminimering. Ingen genbrug blot fordi data teknisk er tilgængelige. |
| Kundespecifik AI-læring | Eksempler bruges kun til den pågældende kundes skrivehjælp og efter kundens instruks. | Kan være databehandling på kundens vegne, hvis formål og rammer er kundestyrede. | DPA-instruks, retention, adgangsbegrænsning og klar afgrænsning fra generel modeltræning. |

## 3. Beslutningstest før behandling starter

For hver ny feature, integration eller managed service skal følgende besvares skriftligt:

1. Hvem bestemmer **hvorfor** personoplysningerne behandles?
2. Hvem beslutter **hvilke personer/kategorier** der skal omfattes?
3. Hvem vælger **hvilke datakilder** der anvendes?
4. Hvem fastlægger **hvilke oplysninger** der indsamles og beriges?
5. Hvem bestemmer **hvor længe** data skal opbevares?
6. Hvem bestemmer **om og hvordan** den registrerede kontaktes?
7. Må Skarp Studio bruge oplysningerne til et **eget formål**, som kunden ikke har instrueret?
8. Er Skarp Studios valg kun tekniske/praktiske midler inden for kundens instruks, eller er de væsentlige for formål og rækkevidde?
9. Hvem håndterer art. 13/14-information, indsigelser, sletning og andre rettigheder?
10. Hvem bærer ansvaret for retsgrundlag og reglerne om direkte markedsføring?

Hvis svarene viser selvstændig beslutningskompetence hos Skarp Studio over formål eller væsentlige hjælpemidler, må behandlingen ikke beskrives som ren databehandling.

## 4. Offentlige B2B-data

At oplysninger er offentligt tilgængelige, erhvervsrelaterede eller fundet på en virksomheds hjemmeside betyder **ikke**, at GDPR ophører med at gælde, hvis oplysningerne vedrører en identificeret eller identificerbar fysisk person.

Offentlig tilgængelighed:
- er en relevant omstændighed i vurdering af rimelige forventninger og proportionalitet,
- kan være relevant for oplysningspligtens indhold,
- er ikke i sig selv et retsgrundlag,
- er ikke i sig selv samtykke til elektronisk markedsføring,
- ophæver ikke krav om dataminimering, korrekthed, transparens, indsigelse og retention.

## 5. Retsgrundlag og LIA

Ved behandling baseret på GDPR artikel 6, stk. 1, litra f, skal den dataansvarlige kunne dokumentere en egentlig interesseafvejning:

1. **Legitim interesse:** præcis, reel og aktuel interesse – ikke hypotetisk.
2. **Nødvendighed:** hvorfor behandlingen er nødvendig, og om formålet kan opnås mindre indgribende.
3. **Afvejning:** den registreredes interesser, rettigheder, rimelige forventninger, datatyper, relation, kilde, omfang, konsekvenser og safeguards.

En generisk sætning om “legitim interesse i salg” er ikke tilstrækkelig som dokumentation.

## 6. Direkte elektronisk markedsføring

GDPR og markedsføringsloven skal vurderes separat.

For elektronisk post med direkte markedsføring gælder det danske spamforbud som udgangspunkt over for **nogen**, herunder erhvervsmæssige modtagere. En offentlig arbejdsmail eller et legitimt GDPR-grundlag er ikke i sig selv tilladelse til at sende markedsføring.

Lead Manager må derfor kun godkende elektronisk direkte markedsføring, når den konkrete kanalregel er dokumenteret, fx:
- gyldigt forudgående samtykke; eller
- en konkret vurderet eksisterende-kundefravigelse, hvor alle lovens betingelser er opfyldt, herunder egne tilsvarende produkter/ydelser og reel, let og gebyrfri fravalgsmulighed ved indsamling og ved hver efterfølgende henvendelse.

En “kunde”-status alene er ikke nok.

## 7. Oplysningspligt

- Data indsamlet **direkte** hos personen: art. 13.
- Data indsamlet **indirekte**: art. 14.

Ved art. 14 skal den dataansvarlige som udgangspunkt give information:
- inden for en rimelig frist og senest én måned efter indsamling,
- hvis data bruges til kommunikation: senest ved første kommunikation,
- hvis data videregives: senest ved første videregivelse.

Undtagelser må ikke anvendes som standardregel. De skal vurderes og dokumenteres konkret.

## 8. Managed leads og videregivelse

Hvis Skarp Studio er selvstændigt dataansvarlig for at finde og berige et lead og derefter afleverer personoplysninger til kunden, er der ikke blot tale om “behandling på kundens vegne”. Der skal vurderes:
- Skarp Studios eget retsgrundlag for indsamling/berigelse,
- Skarp Studios art. 14-forpligtelse,
- lovligheden og formålet med videregivelsen,
- kundens eget retsgrundlag ved modtagelse og efterfølgende behandling,
- om parterne faktisk har fælles dataansvar for dele af flowet.

## 9. Kontraktmæssig konsekvens

Før ekstern kundeaktivering skal serviceformen klassificeres som mindst én af:
- `self_service_processor`
- `managed_processor`
- `managed_controller_to_controller`
- `joint_controller`
- `hybrid`

Kontrakter, onboarding, privacy-information og systemets compliance-flow skal følge den faktiske klassifikation. En standard-DPA må ikke bruges til at “løse” en behandling, der reelt er controller-to-controller eller fælles dataansvar.

## 10. Review

Rollefordelingen skal genvurderes ved ændring i:
- leadmotorens autonomi,
- nye datakilder,
- managed service-ydelser,
- fælles kampagner,
- AI-baseret kvalificering,
- produktforbedring med kundedata,
- nye former for videregivelse,
- nye marketingkanaler,
- kredit-/profileringfunktioner.

**Kilder:** GDPR art. 4(7)-(8), 13, 14, 26, 28 og 30; Datatilsynets vejledning om dataansvarlige og databehandlere; EDPB Guidelines 07/2020.
