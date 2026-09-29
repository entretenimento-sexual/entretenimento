# External security review scope

The reviewer should treat the platform as an adult social/media application
with Firebase/GCP backend, Angular frontend, user-generated media, account
lifecycle, payments/subscriptions, and paid Promotion/Boost placements.

## Required review areas

- authentication/session lifecycle, account suspension and canonical sign-out;
- authorization boundaries in Firestore Rules, Storage Rules and Functions;
- bilateral blocking and direct/deep-link access;
- adult-access authority and failure-closed behavior;
- upload pipeline, media decode/re-encode, MIME/size/pixel limits and quotas;
- signed/temporary media access and leakage of private storage paths/tokens;
- moderation quarantine and protected evidence namespaces;
- admin/backend-only collections and privilege escalation paths;
- callable App Check, rate limits, abuse controls and replay/idempotency;
- Promotion/Boost commercial authority, advertiser authorization and billing-only-backend rules;
- payment/webhook authenticity, idempotency and entitlement transitions;
- secrets/configuration handling;
- dependency/supply-chain review;
- logging/telemetry privacy and accidental sensitive-data exposure;
- OWASP-style web risks, XSS/injection/open redirect/CSRF assumptions;
- denial-of-service and cost-abuse surfaces;
- rollback and incident containment.

## Adversarial scenarios

At minimum test:

- blocked user attempting direct document/deep-link/media access;
- suspended/expired-age account using cached projections;
- forged client fields for moderation, official context, commercial authority,
  subscription/entitlement or age;
- quarantined content requested through viewer/share/discovery/profile routes;
- upload format confusion and oversized/decompression-bomb-like images;
- forged/replayed paid-placement or billing requests;
- horizontal access to another user's private media;
- client attempts to read moderation evidence/legal-review collections.

The report should identify concrete exploitability, not only code-style issues.
