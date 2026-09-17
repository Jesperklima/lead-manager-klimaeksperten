# Lead Manager compliance governance baseline — 2026-09-17

Status: operational compliance baseline for implementation and legal review. This document is not a claim that every external contract, processor agreement or regulatory verification is complete.

## 1. Roles and scope

Lead Manager is a B2B CRM/lead-management service. For customer CRM data, the customer will normally determine why and how prospects, contacts, mail and sales activities are processed and will therefore normally be controller for that processing. Lead Manager acts as processor where it processes that data on the customer's documented instructions. The platform provider may separately be controller for account administration, security, billing, support, abuse prevention and its own statutory obligations.

A purpose-by-purpose controller/processor assessment must be kept current. The role must not be inferred only from which company owns the software.

## 2. Record of processing activities (GDPR Art. 30 working register)

Maintain, per purpose: data categories, data subjects, source, purpose, legal basis or processor instruction, recipients/subprocessors, transfers, retention rule, security controls, system owner and review date.

Core purposes include: tenant/account administration; B2B lead research and enrichment; CRM activities; mail integration; offer/pipeline follow-up; privacy/objection handling; audit/security logs; AI drafting/classification; AI learning examples used for customer-specific writing assistance; integration data from Minuba, Google, Microsoft and Skarp Studio where enabled.

## 3. Lawful-basis and direct-marketing separation

A GDPR legal basis for storing or enriching a B2B contact does not by itself authorise electronic direct marketing. Electronic marketing must pass the separate channel/purpose compliance gate.

Direct marketing by email requires documented permission or another specifically reviewed lawful exception before the send action is approved. Do-not-contact, objections, active stoplist records and documented channel blocks override campaign or sales automation.

Telephone outreach must be reviewed differently for companies versus natural persons/personally owned businesses. The system must not assume that 'phone' is automatically lawful simply because an email is blocked.

## 4. Provenance and Article 14

Personal contact data must have documented provenance. New contact enrichment without a source is marked review-required and must not become a verified prospect automatically.

For personal data not obtained directly from the person, the controller must operate an Article 14 transparency process. Lead Manager therefore stores source/provenance, source-obtained time, notice state and review state. The operational workflow must provide the privacy information within the applicable deadline or at the appropriate first communication/disclosure, subject to any documented exception.

Never invent a source URL merely to satisfy the database. If provenance cannot be reconstructed, quarantine/review is the correct outcome.

## 5. Retention and deletion lifecycle

Retention is purpose-based, not an arbitrary universal GDPR number.

Lead Manager uses a lifecycle queue. Leads that are inactive beyond the configured period or are marked lost/closed/not relevant enter review. After the review window they may be quarantined. After the configured anonymisation window, prospect contact data may be anonymised only if there is no other active lead, active commercial relationship, open offer or documented legal hold requiring retention.

Related personal data, prospect mail content and AI learning material must be minimised on the same principle. Suppression/objection evidence may be kept in minimal form for as long as reasonably necessary to prevent unlawful re-contact. Contract, accounting, dispute and security evidence follows its separate legal retention need and must not be erased merely because a lead was closed.

Every automated retention run must be auditable.

## 6. Data-subject rights

Lead Manager maintains a privacy-request register for access, correction, deletion, restriction, objection and portability where applicable. Requests must have received, due, status, completion and legal-reason fields. Identity should be verified proportionately before disclosure or deletion.

An objection to direct marketing must be actioned immediately in the operational channel controls and stoplist/suppression layer; it must not wait for a general retention job.

## 7. Subprocessors and transfers

The live subprocessor register includes the providers actually used by the platform, currently including Supabase, Vercel, OpenAI and, when enabled, Google and Microsoft. A provider is not marked verified merely because it publishes a DPA.

For each active provider verify: DPA/terms, processing purpose, categories, hosting/region, international-transfer mechanism if applicable, subprocessor terms, deletion/return behaviour, incident notification, security documentation and review date.

## 8. Customer DPA requirements

Before broad external SaaS use, the customer processor agreement should cover at least: documented instructions; confidentiality; appropriate security; subprocessors and change mechanism; data-subject assistance; breach assistance; DPIA/authority assistance; deletion/return on termination; audit/information rights; transfer safeguards; responsibilities for integrations enabled by the customer.

## 9. Incident and breach process

Security/compliance incidents are logged with client, severity, category, status, timestamps, evidence and remediation. Potential personal-data breaches require immediate containment and assessment of confidentiality/integrity/availability impact, affected data subjects, likely consequences and whether notification duties are triggered. Do not wait for the daily retention job.

## 10. Compliance release gate

A release affecting collection, enrichment, outbound communication, AI, credit assessment, retention, authentication, impersonation or new subprocessors must be reviewed against this baseline. Tests must confirm tenant isolation, provenance guard, channel block behaviour, retention exclusions/legal holds, AI human-review rules and no natural-person credit scoring.

## 11. External items that cannot be self-certified in code

The product can enforce controls, but the following still require external completion/evidence: signed/customer DPA, processor/subprocessor contract review, controller-specific legitimate-interest assessment, DPIA sign-off, Google restricted-scope/OAuth verification and any required security assessment, AI-literacy completion records, and legal review of the published privacy/terms text for the final commercial entity and customer model.
