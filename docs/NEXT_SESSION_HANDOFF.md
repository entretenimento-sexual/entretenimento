# Next Session Handoff

## Current project

- Repository: `entretenimento-sexual/entretenimento`
- Local path usually used: `C:\entretenimento`
- Firebase project: `entretenimento-sexual`
- Current stable branch: `main`
- Recent integration branch merged into `main`: `fix/onboarding-registration-architecture`

## Current status

The onboarding/registration package was consolidated into `main` through PR #14.

Merged package summary:

1. registration route cleanup;
2. email verification before profile completion;
3. registration flow state centralized through dedicated data-access services/guards;
4. Google/social login aligned with the same verification-first rule;
5. CTAs in account, online users, nearby profiles and layout shell aligned to the onboarding order;
6. `/register/welcome` mobile polish;
7. `/perfil` initial visual polish after signup;
8. router diagnostics adjusted to avoid false redirect-loop reports during legitimate guard redirects.

## Last known validation

Validated locally after merging into `main`:

```powershell
cd C:\entretenimento
git checkout main
git pull origin main
npm.cmd run build
npm.cmd run functions:build
git status
```

Observed result:

- `ng build` completed successfully;
- `functions:build` completed successfully;
- `main` was up to date with `origin/main`;
- working tree was clean.

Manual smoke test completed before the final merge:

- user registration completed;
- e-mail verification succeeded;
- user reached `/perfil` with the authenticated shell loaded;
- `/register/welcome` and `/perfil` were visually checked.

## Current cleanup branch

Active cleanup branch:

```text
chore/post-merge-cleanup
```

Purpose:

- update project handoff after the onboarding merge;
- remove stale guidance that could mislead the next session;
- avoid new product logic until `main` is confirmed stable after the merge.

## Recommended next steps

1. Validate the cleanup branch after this documentation update:

```powershell
git pull origin chore/post-merge-cleanup
npm.cmd run build
npm.cmd run functions:build
git status
```

2. If validation is clean, open a small PR:

```text
base: main
head: chore/post-merge-cleanup
title: docs: update handoff after onboarding merge
```

3. Next product branch should be small and isolated. Recommended options:

```text
polish/profile-mobile-details
chore/test-infra-providers
feat(compliance-adult-consent-v2)
```

## Known non-blocking debt

The existing `.spec` suite still has older structural debt around providers/mocks for Firebase, Store and Angular Material. It was not used as a release blocker for the onboarding merge.

Recommended future branch:

```text
chore/test-infra-providers
```

Target:

- normalize Firebase test providers;
- normalize NgRx Store mocks;
- remove stale expectations from pre-refactor specs;
- make `npm.cmd run test` meaningful again.

## Firestore rules note

Only deploy rules when a file under `firestore-rules/` or generated `firestore.rules` changed:

```powershell
npm.cmd run rules:build
npm.cmd run rules:check
firebase deploy --only firestore:rules --project entretenimento-sexual
```

## Work-machine safety checklist

Before editing from another machine:

```powershell
cd C:\entretenimento
git status
git pull origin main
npm.cmd run build
```

Before pushing any branch:

```powershell
git status
npm.cmd run build
npm.cmd run functions:build
```

Do not run emulators unless the goal is explicitly local Firebase isolation. Current validation is against the real Firebase project and deployed rules.
