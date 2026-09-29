# External privacy and moderation review scope

Review the platform's data flows and moderation model as a high-sensitivity
adult platform.

## Privacy

Review against LGPD principles and current ANPD regulations/guidance, including:

- lawful bases and purpose limitation by data category;
- minimization of identity, age-verification and moderation evidence data;
- sensitive-data classification;
- data inventory and controller/operator responsibilities;
- retention and deletion schedules;
- user rights workflows;
- account deletion versus legal/moderation holds;
- international transfers and third-party processors;
- security incident response and notification decision process;
- privacy-by-design for age assurance;
- logs, analytics, Sentry/telemetry and support tooling;
- access controls for moderators, admins and legal/compliance reviewers.

The age-assurance review should specifically evaluate reliability,
proportionality, privacy preservation, contestability and whether raw documents
or provider evidence are retained unnecessarily.

## Moderation

Review:

- distinction between adult consensual nudity/sex and prohibited content;
- child/minor exposure and suspected sexual content involving minors;
- immediate content-level quarantine;
- evidence preservation without continuing public distribution;
- non-consensual intimate/sexual content;
- illegal-content escalation;
- duplicate/abusive reporting resistance;
- human review and contestation;
- user notifications;
- moderator access minimization;
- legal-review handoff and audit trail;
- preservation versus disclosure to authorities;
- automation thresholds and safeguards against whole-profile punishment from a
  single content report.

The reviewer should compare implementation with
`docs/moderation-evidence-and-legal-requests.md` and test whether frontend,
Functions, Rules and Storage all enforce the same authority boundaries.
