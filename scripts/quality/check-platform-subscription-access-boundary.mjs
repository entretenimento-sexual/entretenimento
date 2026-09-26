// scripts/quality/check-platform-subscription-access-boundary.mjs
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION ACCESS BOUNDARY
// -----------------------------------------------------------------------------
// Garante uma única autoridade para capacidades pagas no Angular:
//
// backend entitlement -> users/{uid} projection -> realtime user listener ->
// PlatformSubscriptionAccessService -> AccessControlService -> features/rotas ativas.
//
// O frontend não pode fabricar role/tier/isSubscriber por patch local. Guards
// comerciais antigos não fazem parte do grafo carregável e não são autoridade.
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

const profilePhotos = read(
  'src/app/media/photos/profile-photos/profile-photos.component.ts'
);
for (const forbidden of [
  'PlatformSubscriptionAccessService',
  'subscriptionAccess',
  'canUsePhotoDate',
  'notifyPhotoDateUpgrade',
  'monthlyPayer',
  'hasPhotoDateAccess(',
  "subscriptionStatus !== 'active'",
]) {
  forbidIncludes(
    profilePhotos,
    forbidden,
    'displayDate is organizational metadata and must not carry commercial gating'
  );
}
requireIncludes(
  profilePhotos,
  'updatePhotoDisplayDate(',
  'displayDate editing must remain available to the owner'
);

const usersPhotosRules = read('firestore-rules/users_photos.rules');
requireIncludes(
  usersPhotosRules,
  'validDisplayDate()',
  'displayDate Rules must preserve data validation'
);
for (const forbidden of [
  'isActiveSubscriber(userId)',
  'activeSubscriptionRank',
  'hasPaidPhotoDateAccess',
  'monthlyPayer',
  'subscriptionStatus',
  'user.role ==',
]) {
  forbidIncludes(
    usersPhotosRules,
    forbidden,
    'displayDate Rules must remain independent from commercial state'
  );
}

const photoPublicationContract = read(
  'src/app/core/interfaces/media/i-photo-publication-config.ts'
);
requireIncludes(
  photoPublicationContract,
  "export type TPhotoPublishableVisibility = 'FRIENDS' | 'PUBLIC';",
  'photo write contract must not expose reserved paid audiences'
);
requireIncludes(
  photoPublicationContract,
  "export type TPhotoPublishableCommentsPolicy =",
  'photo write comments contract must remain explicit'
);

const videoPublicationContract = read(
  'src/app/core/interfaces/media/i-video-publication-config.ts'
);
requireIncludes(
  videoPublicationContract,
  "export type TVideoPublishableVisibility = 'FRIENDS' | 'PUBLIC';",
  'video write contract must not expose reserved paid audiences'
);

const mediaAudiencePolicy = read(
  'functions/src/media/application/media-publication-audience.policy.ts'
);
for (const fragment of [
  "'SUBSCRIBERS'",
  "'PREMIUM'",
  "'UNAVAILABLE_ENTITLEMENT'",
  'resolveMediaPublicationVisibility',
  'resolvePhotoCommentsPolicy',
]) {
  requireIncludes(
    mediaAudiencePolicy,
    fragment,
    'reserved paid media audiences must remain fail-closed'
  );
}

for (const relativePath of [
  'functions/src/media/application/manage-photo-publication.handler.ts',
  'functions/src/media/application/manage-video-publication.handler.ts',
]) {
  const source = read(relativePath);
  requireIncludes(
    source,
    'resolveMediaPublicationVisibility',
    'media publication handlers must use canonical audience availability'
  );
  for (const forbidden of [
    "text === 'SUBSCRIBERS'",
    "text === 'PREMIUM'",
  ]) {
    forbidIncludes(
      source,
      forbidden,
      'handlers must not directly accept reserved paid audiences'
    );
  }
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
