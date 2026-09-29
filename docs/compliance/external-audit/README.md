# External pre-production audit

Status: **SUBMISSION PACKAGE READY / PRODUCTION BLOCKED**

This package is the canonical handoff for independent review before any public
production launch. It does not replace the repository's technical gates. It
adds three independent external approvals:

1. security;
2. privacy + moderation;
3. legal review focused on the adult-content and advertising business model.

## Release identity

The auditor must review a fixed commit SHA. The approval is invalid if code,
Rules, Functions, moderation policy, age authority, privacy behavior, billing,
promotion/advertising behavior, or public Terms/Policies change afterwards
without impact review.

## Required deliverables

Each reviewer must return, at minimum:

- reviewer/firm identity and professional role;
- review date;
- repository SHA reviewed;
- scope and exclusions;
- methodology;
- findings with severity;
- evidence/reproduction notes where applicable;
- remediation requirements;
- residual risks accepted or explicitly rejected;
- final disposition: APPROVED, APPROVED_WITH_CONDITIONS, or REJECTED.

Production requires **APPROVED** in all three tracks. Conditional approval does
not unlock public production unless every condition has been resolved and the
reviewer issues a final APPROVED disposition.

## Tracks

- [Security review](./security-scope.md)
- [Privacy and moderation review](./privacy-moderation-scope.md)
- [Adult-model and advertising legal review](./legal-adult-advertising-scope.md)
- [Approval record](./approvals.json)

## Technical enforcement

`npm run external-audit:check` validates the approval record.

`validate:prod` includes that gate. Therefore `deploy:prod`, which already
depends on `validate:prod`, remains blocked while any audit is pending,
conditional, rejected, expired, or attached to a different SHA.

Do not bypass this gate with manual Firebase deploy commands for public launch.
