// scripts/quality/check-media-notification-distribution-boundary.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[media-notification-distribution] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[media-notification-distribution] ' + label + ': ' + fragment);
  }
}

const policy = read('functions/src/media/application/media-notification-distribution.policy.ts');
const trigger = read('functions/src/media/application/distribute-approved-media-notifications.trigger.ts');
const push = read('functions/src/notifications/sendNotification.ts');
const preference = read('functions/src/notifications/notification-preference.policy.ts');
const shadow = read('functions/src/media/application/media-trend-score-shadow.policy.ts');
const rules = read('firestore-rules/notifications.rules');

for (const fragment of [
  'MEDIA_NOTIFICATION_MAX_RECIPIENTS_PER_PUBLICATION',
  'MEDIA_NOTIFICATION_MAX_PER_RECIPIENT_WINDOW',
  'MEDIA_NOTIFICATION_MAX_PER_OWNER_RECIPIENT_WINDOW',
  'buildMediaDistributionNotificationId',
  'evaluateMediaNotificationCaps',
  'canReceiveMediaDistributionNotification',
]) requireIncludes(policy, fragment, 'policy drift');

for (const fragment of [
  'shouldDistributeApprovedMedia',
  'public_profiles/{ownerUid}/{mediaCollection}/{mediaId}',
  'notificationPreferences?.media',
  'transaction.create(notificationRef',
  'users/${ownerUid}/friends/${recipientUid}',
  'users/${recipientUid}/friends/${ownerUid}',
  'users/${ownerUid}/blocks/${recipientUid}',
  'users/${recipientUid}/blocks/${ownerUid}',
  'trendScoreUsed: false',
]) requireIncludes(trigger, fragment, 'distribution trigger drift');

forbidIncludes(trigger, "after?.['trendScore']", 'distribution runtime must not read trendScore');
forbidIncludes(trigger, "after?.['engagementScore']", 'distribution runtime must not read engagementScore');
forbidIncludes(trigger, "after?.['rankingScore']", 'distribution runtime must not read rankingScore');

for (const fragment of [
  "['media.photo.published', 'media']",
  "['media.video.published', 'media']",
]) requireIncludes(preference, fragment, 'media preference mapping drift');

for (const fragment of [
  'isMediaDistributionNotificationType',
  'canReceiveMediaDistributionNotification',
  'evaluateCanonicalOwnerLifecycle',
  'push de Media suprimido por bloqueio bilateral',
]) requireIncludes(push, fragment, 'push revalidation drift');

requireIncludes(shadow, 'eligibleForNotifications: false', 'trend shadow must remain ineligible for notifications');
requireIncludes(rules, 'match /media_notification_delivery_state/{userId}', 'cap state must remain backend-only');
requireIncludes(rules, 'allow read, write: if false;', 'cap state must remain backend-only');

console.log('[media-notification-distribution] OK: capped, preference-aware, deduped, bilateral-block/lifecycle aware and independent from trendScore.');
