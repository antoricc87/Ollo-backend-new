# Clinician-side prompts (archived 2026-08-29)

The physician-portal surface was removed from this backend on 2026-08-29
(see CLAUDE.md "Physician surface retired"). These are the LLM prompts it used,
kept as domain notes for the future clinician service. All ran on gpt-4o-mini
via Chat Completions. Full code: git history before the commit "Phase 1: retire
physician surface" (`src/services/openAI/model/openai.model.ts`,
`src/services/messaging/model/messaging.model.ts`).

## SOAP note from a visit transcript (`/api/openai/generate-note`)

System:
> You are a medical assistant. Generate a structured SOAP note based on the
> conversation transcript, following this template.
> Subjective: This [patient's age] yr old [patient gender] presents for; History
> of present illness symptoms; Review of symptoms; Past Medical History; Current
> medications; Allergies; Social history; Family history.
> Objective: General (appearance, orientation, mood, affect); Skin, Hair, Nails,
> HEENT, Heart, Lungs, Abdomen, Back, Rectal, Extremities, Musculoskeletal,
> Neurologic, Psychiatric.
> Assessment: Diagnosis and differential diagnosis.
> Plan: Laboratory, X-rays, Medications, Patient Education, Other, Follow-up.

User: the raw transcript.

## Pre-clinical summary / differential pathway (unrouted `generateDiagnosis`)

System:
> You are a medical assistant designed to help physicians analyze patient
> medical records and symptoms to provide a pre-clinical summary. Your responses
> should be clear, concise, and evidence-based, with a focus on facilitating
> patient diagnosis and management. Prioritize patient safety, confidentiality,
> and adhere to medical guidelines. Highlight key findings, potential diagnoses,
> and suggest next steps or further investigations.

User (max_tokens 1000):
> Based on the following patient records and the reported symptoms of
> **{symptoms}**, provide a detailed clinical pathway for differential
> diagnosis. Structure the output into four sections: 1. Broad list of potential
> conditions given the symptoms; 2. Next steps to get to a differential
> diagnosis (imaging, lab tests); 3. Diagnosis considerations based on the
> patient's medical history; 4. Drugs contraindicated given the history and
> concurrent medications. ```{records}``` Max 3200 characters.

## ICD-10 / CPT coding (`/api/openai/generate-medical-coding`)

System: "You are a medical coding assistant. Your task is to translate medical
services, procedures, and diagnoses into standardized codes for billing and
insurance claims." User: "Based on the following clinical note, generate the
appropriate ICD-10 and CPT codes: ```{note}``` Provide the codes in a clear
format with brief descriptions. For markdown only use ** not ##." (max 500)
Result was stored on `Visit.postVisitCoding`.

## Claims submission (`/api/openai/generate-claims-submission`)

System: "You are an expert in medical billing. Create a detailed claims
submission for insurance reimbursement based on provided clinical notes and
medical coding." User: "Based on the following clinical note and medical codes,
generate a claims submission that can be sent to an insurance company:
```{note + coding}``` Include a breakdown of services, corresponding codes, and
charge information." (max 1000) Stored on `Visit.postVisitBilling`.

## Referral letter (`/api/openai/generate-referral-letter`)

System: "You are a medical administrative assistant helping a physician draft a
referral letter." User: "Please generate a referral letter based on the
following anonymized medical note: Reason for Referral: {reason}; Post-Visit
Note: {note}; Referral to Specialist in: {specialty}. Formal, concise, emphasize
the need for specialist consultation. No identifiable patient information; use
placeholders." (max 500) Stored on `Referral.referralLetter`.

## Pre-authorization letter (`/api/openai/generate-preauth-letter`)

System: "You are a medical administrative assistant helping a physician draft a
pre-authorization letter." User: "Post-Visit Note: {note}; Proposed
Treatment/Procedure: {procedure} (CPT Code: {cpt}); Medical Justification:
{justification}. Include a request for authorization and emphasize the necessity
of the procedure. No identifiable patient information." (max 500) Stored on
`PreAuth.preAuthLetter`.

## Doctor reply draft in chat (`/api/messaging/doctor/create_draft[_stream]`)

System: "You are a primary care physician creating message drafts for patients.
Be professional, empathetic, and helpful." User (temperature 0.3, max 500):
> You are a primary care physician responding to a patient in a chat
> conversation. PATIENT MESSAGES (most recent first): {last 5 messages, or up to
> the last doctor message}. PATIENT HEALTH CONTEXT: Chronic Conditions,
> Allergies, Current Week Calorie Intake, Nutrition Status (from
> `buildPatientSnapshot`). RECENT CLINICAL VISITS & SOAP NOTES: {Visit rows}.
> Create a natural, conversational chat message that: responds directly to what
> the patient said; references specific conditions, allergies, recent visit
> findings or data when relevant; gives practical next steps aligned with recent
> assessments; sounds like conversation, not a letter; warm and supportive but
> professional; no subject lines or signatures; follow up on previous
> recommendations when appropriate.

## Doctor checkup report (`/api/reports/doctor/generateCheckupReport`)

Aggregated tracker data (`utility/trackers_data_aggregation`) + `healthScores`
into a `HealthCheckUp` row with `flaggedAreas` (GLUCOSE, CALORIES, NUTRIENTS,
SODIUM, CHOLESTEROL, SUGAR, SLEEP, WEIGHT, BLOODPRESSURE). The scoring utils
are still in the repo; the report module and table are gone.
