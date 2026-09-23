// scripts/quality/check-platform-subscription-access-boundary.mjs
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION ACCESS BOUNDARY
// -----------------------------------------------------------------------------
// Garante uma única autoridade para capacidades pagas no Angular:
//
// backend entitlement -> users/{uid} projection -> realtime user listener ->
// PlatformSubscriptionAccessService -> AccessControlService -> guards/features.
//
// O frontend não pode fabricar role/tier/isSubscriber por patch local, e guards
// genéricos não podem voltar a interpretar user.role como prova financeira.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error(
      '[platform-subscription-access-boundary] ' + label + ': ' + fragment
    );
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error(
      '[platform-subscription-access-boundary] ' + label + ': ' + fragment
    );
  }
}

const access = read(
  'src/app/core/services/subscriptions/platform-subscription-access.service.ts'
);
for (const fragment of [
  'PlatformSubscriptionAccessService',
  'this.currentUserStore.user$',
  'evaluatePlatformSubscriptionProjection',
  'hasMinimumPlatformSubscriptionRole',
  'readonly state$',
  'readonly role$',
  'hasAtLeast$(',
]) {
  requireIncludes(
    access,
    fragment,
    'canonical paid access service drift'
  );
}
for (const forbidden of [
  'currentUserStore.patch(',
  'synchronizeRuntimeAliases(',
]) {
  forbidIncludes(
    access,
    forbidden,
    'paid access service must never mutate server-managed billing aliases'
  );
}

const reconciliation = read(
  'src/app/payments-core/application/platform-subscription-reconciliation.service.ts'
);
for (const fragment of [
  'PlatformSubscriptionReconciliationService',
  'getMyBillingSnapshot$()',
  'this.currentUserStore.user$',
]) {
  requireIncludes(
    reconciliation,
    fragment,
    'bootstrap reconciliation drift'
  );
}
for (const forbidden of [
  'currentUserStore.patch(',
  'applySnapshot(',
]) {
  forbidIncludes(
    reconciliation,
    forbidden,
    'bootstrap reconciliation must project through backend + realtime listener'
  );
}

const roleGuard = read(
  'src/app/core/guards/access-guard/role.guard.ts'
);
for (const fragment of [
  'AccessControlService',
  'access.hasAny$(allowed)',
  'normalizeAllowedRoles',
  "source:',",
  "'AccessControlService'",
]) {
  requireIncludes(
    roleGuard,
    fragment,
    'generic role guard must use canonical access authority'
  );
}
for (const forbidden of [
  'FirestoreUserQueryService',
  'getUserOnce$(',
  'allowedNormalized.includes(',
  'roleFromStore',
  "user?.role || ''",
]) {
  forbidIncludes(
    roleGuard,
    forbidden,
    'generic role guard contains a parallel role authority'
  );
}

const accessControl = read(
  'src/app/core/services/autentication/auth/access-control.service.ts'
);
for (const fragment of [
  'PlatformSubscriptionAccessService',
  'this.subscriptionAccess.state$',
  'subscriptionState.active && subscriptionState.role',
  'hasAtLeast$(min: UserRole)',
  'hasAny$(allowed: UserRole[])',
]) {
  requireIncludes(
    accessControl,
    fragment,
    'AccessControlService paid-role derivation drift'
  );
}

for (const guardPath of [
  'src/app/core/guards/access-guard/basic.guard.ts',
  'src/app/core/guards/access-guard/premium.guard.ts',
  'src/app/core/guards/access-guard/vip.guard.ts',
]) {
  const guard = read(guardPath);
  requireIncludes(
    guard,
    'AccessControlService',
    guardPath + ' must consume AccessControlService'
  );
  requireIncludes(
    guard,
    'this.access.hasAtLeast$(',
    guardPath + ' must derive paid capability canonically'
  );
}

const legacySubscription = read(
  'src/app/core/services/subscriptions/subscription.service.ts'
);
for (const fragment of [
  'PlatformSubscriptionAccessService',
  'this.subscriptionAccess.state$',
  'hasMinimumPlatformSubscriptionRole',
]) {
  requireIncludes(
    legacySubscription,
    fragment,
    'legacy SubscriptionService must remain an alias of canonical paid access'
  );
}

const currentUserStore = read(
  'src/app/core/services/autentication/auth/current-user-store.service.ts'
);
for (const fragment of [
  "'role'",
  "'tier'",
  "'isSubscriber'",
  "'monthlyPayer'",
  "'billingProjectionVersion'",
  "'subscriptionStatus'",
  "'subscriptionScope'",
  "'subscriptionStartedAt'",
  "'subscriptionEndsAt'",
  "'subscriptionExpires'",
  "'billingUpdatedAt'",
]) {
  requireIncludes(
    currentUserStore,
    fragment,
    'server-managed billing field escaped CurrentUserStore patch protection'
  );
}

const userEffects = read(
  'src/app/store/effects/effects.user/user.effects.ts'
);
for (const fragment of [
  'this.firestoreUserQuery.getUser(uid)',
  'this.currentUserStore.set(safeUser)',
  'observeUserChanges$',
]) {
  requireIncludes(
    userEffects,
    fragment,
    'realtime users/{uid} projection path drift'
  );
}

const backendSnapshot = read(
  'functions/src/payments/application/get-my-billing-snapshot.handler.ts'
);
for (const fragment of [
  'reconcilePlatformSubscriptionAccess(uid)',
  "entitlements: ['platform_subscription']",
  'PLATFORM_SUBSCRIPTION_PROJECTION_VERSION',
]) {
  requireIncludes(
    backendSnapshot,
    fragment,
    'backend billing snapshot must remain entitlement-authoritative'
  );
}

console.log(
  '[platform-subscription-access-boundary] OK: paid roles flow from backend entitlement through the realtime canonical projection, with no local billing-role authority.'
);
