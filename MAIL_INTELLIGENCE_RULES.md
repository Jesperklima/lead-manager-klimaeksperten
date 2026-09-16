# Mail Intelligence Rules – Lead Manager / Klimaeksperten

## Formål
Denne specifikation definerer reglerne for automatisk analyse af mails, der vedrører tilbud, kunder, leads og pipeline.

## 1. Identifikation
Systemet skal forsøge at identificere:
- alle tilbudsnumre (fx "tilbud 2227", "tilbuddet 2227") – ikke kun det første nummer i en mail eller tråd
- tilbudsnumre i emne, mailtekst og vedhæftningsfilnavne; PDF-indhold bruges også når det allerede er sikkert tilgængeligt
- kundenavn og kontaktperson
- mailadresse og telefonnummer
- relevant lead/sag i CRM
- dato og afsender

Hvert fundet tilbudsnummer vurderes selvstændigt. En gammel mailtråd må aldrig i sig selv få nye tilbudsnumre til at blive ignoreret.

Eksempel: En tråd om tilbud 2803-3 får senere vedhæftningerne `Tilbud 2924.pdf` og `Tilbud 2925.pdf`. Resultatet er to nye tilbudskandidater, 2924 og 2925, som begge skal kontrolleres/oprettes separat.

## 2. Klassifikation
### VUNDET
Eksempler: accepteret, godkendt, vi går med tilbuddet, ordren er jeres.
Handling: Markér tilbud som VUNDET og gem mail som aktivitet.

### TABT
Eksempler: vi har valgt en anden, tilbuddet er afslået, ikke interesseret.
Handling: Markér tilbud som TABT og gem begrundelse.

### LANG UDSÆTTELSE
Eksempler: næste år, til foråret, senere næste sæson, projektet er udskudt i længere tid.
Handling:
1. Luk tilbuddet som LUKKET – UDSKUDT.
2. Fjern det fra aktiv tilbudspipeline.
3. Gem årsag og original mail som aktivitet.
4. Markér at sagen kræver ny beregning/genberegning ved eventuel genoptagelse.
5. Opret ikke automatisk et nyt tilbud.
6. Opret kun en fremtidig kundesag/opfølgning, hvis datoen kan udledes med tilstrækkelig sikkerhed.

### KORT AFVENTNING
Eksempler: vender tilbage i næste uge, afventer intern godkendelse, hører fra os snart.
Handling: Behold aktivt tilbud og opret opfølgning.

### UKLAR
Hvis mailens betydning ikke kan fastslås sikkert:
Handling: Opret forslag til godkendelse. Ingen automatisk statusændring.

## 3. Sikkerhedsregler
- Match aldrig alene på et tal uden tilbudskontekst.
- Brug både tilbudsnummer, afsender/modtager, vedhæftninger og eksisterende CRM-data når muligt.
- Normaliser tilbudsnummer før sammenligning.
- Dubletnøglen for tilbud er workspace/client_id + tilbudsnummer. Thread-id eller message-id må ikke bruges som eneste tilbuds-deduplikering.
- Message-id/indholds-hash bruges fortsat til at undgå dobbeltregistrering af samme mailaktivitet, men må ikke skjule nye tilbudsnumre i samme tråd.
- Hvis én mail indeholder flere sikre tilbudsnumre, behandles de som separate tilbud.
- Når et gammelt tilbud opdeles/erstattes af nye tilbudsnumre, bevares historik og relation. De nye numre oprettes separat. Det gamle tilbuds status ændres ikke uden dokumentation.
- Krydstjek mod Minuba read-only data når integrationen er tilgængelig.
- Gem altid forklaring/audit på hvorfor et tilbud eller en status blev foreslået, oprettet, ignoreret som dublet eller sendt til kontrol.
- Ved modstridende signaler: STATUS-UKLAR og manuel godkendelse.
- Lang udsættelse må gerne lukkes automatisk kun ved høj sikkerhed; ellers kræves godkendelse.

## 4. Reconciliation / anden sikkerhedslinje
Den normale mail-ingestion er første sikkerhedslinje. Derudover skal Lead Manager regelmæssigt gennemgå de seneste relevante mails igen og sammenligne alle fundne tilbudsnumre med crm_offers.

Reconciliation skal:
1. Gennemgå relevante indgående og udgående mails i et begrænset lookback-vindue.
2. Udtrække alle tilbudsnumre fra emne, body og vedhæftningsnavne.
3. Kontrollere hvert nummer mod workspace + crm_offers og Minuba, når muligt.
4. Oprette sikkert manglende tilbud eller sende usikre fund til kontrol.
5. Koble nye mails/svar til eksisterende tilbuds dialoglog.
6. Være idempotent: genkørsel må ikke skabe dubletter.
7. Logge fejl, fund, dubletter og oprettelser, så manglende tilbud kan spores.

## 5. Regressionstest
Følgende scenarier skal være dækket:
- ét tilbud i en ny mail
- to eller flere tilbud i samme mail
- nye tilbudsnumre i en gammel mailtråd
- samme tilbud nævnt flere gange uden dublet
- tilbudsnummer fundet i vedhæftningsfilnavn
- gammelt tilbud efterfulgt af nye opdelte/erstatningstilbud
- genkørsel/reconciliation uden dubletter
- konkret testcase: 2803-3 → 2924 + 2925 skal give separate 2924 og 2925

## 6. Gmail-integration
Den produktive automatisering kræver en sikker server-side Gmail OAuth-integration eller tilsvarende mail-webhook/polling. OAuth-tokens og klienthemmeligheder må aldrig ligge i index.html eller i GitHub-koden.
