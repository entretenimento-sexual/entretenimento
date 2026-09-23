import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPushNotificationDeliveryOptions,
  PUSH_NOTIFICATION_TTL_SECONDS,
  shouldAttemptExternalPush,
} from './push-notification-delivery.policy';

test('limita retenção externa do push a sete dias em todas as plataformas', () => {
  assert.equal(PUSH_NOTIFICATION_TTL_SECONDS, 7 * 24 * 60 * 60);

  const now = 2_000_000_000_000;
  const options = buildPushNotificationDeliveryOptions(now);
  const expectedExpirationSeconds =
    Math.floor(now / 1000) + PUSH_NOTIFICATION_TTL_SECONDS;

  assert.deepEqual(options, {
    android: {
      ttl: PUSH_NOTIFICATION_TTL_SECONDS * 1000,
    },
    apns: {
      headers: {
        'apns-expiration': String(expectedExpirationSeconds),
      },
    },
    webpush: {
      headers: {
        TTL: String(PUSH_NOTIFICATION_TTL_SECONDS),
      },
    },
  });
});

test('não tenta push para notificações explicitamente in-app only', () => {
  assert.equal(shouldAttemptExternalPush('IN_APP_ONLY'), false);
  assert.equal(shouldAttemptExternalPush('in_app_only'), false);
  assert.equal(shouldAttemptExternalPush('ESSENTIAL'), true);
  assert.equal(shouldAttemptExternalPush(undefined), true);
});
