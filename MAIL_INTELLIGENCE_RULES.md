# Mail Intelligence Rules – Lead Manager / Klimaeksperten

## Formål
Denne specifikation definerer reglerne for automatisk analyse af mails, der vedrører tilbud, kunder, leads og pipeline.

## 1. Identifikation
Systemet skal forsøge at identificere:
- tilbudsnummer (fx "tilbud 2227", "tilbuddet 2227")
- kundenavn og kontaktperson
- mailadresse og telefonnummer
- relevant lead/sag i CRM
- dato og afsender

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
- Brug både tilbudsnummer, afsender/modtager og eksisterende CRM-data når muligt.
- Gem altid forklaring på hvorfor en status blev foreslået eller ændret.
- Ved modstridende signaler: STATUS-UKLAR og manuel godkendelse.
- Dubletter skal ignoreres via mail-id/message-id eller indholds-hash.
- Lang udsættelse må gerne lukkes automatisk kun ved høj sikkerhed; ellers kræves godkendelse.

## 4. Eksempel
Mail: "Denne sag er udskudt til foråret næste år"
Kontekst: tilbud 2227
Resultat: LUKKET – UDSKUDT
Note: "Kræver ny beregning ved genoptagelse"

## 5. Gmail-integration
Den produktive automatisering kræver en sikker server-side Gmail OAuth-integration eller tilsvarende mail-webhook/polling. OAuth-tokens og klienthemmeligheder må aldrig ligge i index.html eller i GitHub-koden.
