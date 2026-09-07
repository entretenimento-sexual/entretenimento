import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isPushNotificationEnabledByPreference,
  resolvePushNotificationPreferenceKey,
} from './notification-preference.policy';

test('mapeia tipos opcionais para a preferência canônica', () => {
  assert.equal(resolvePushNotificationPreferenceKey('chat'), 'messages');
  assert.equal(resolvePushNotificationPreferenceKey('social'), 'connections');
  assert.equal(
    resolvePushNotificationPreferenceKey('community.comment.received'),
    'communities'
  );
  assert.equal(
    resolvePushNotificationPreferenceKey('community.comment.reply.received'),
    'communities'
  );
  assert.equal(
    resolvePushNotificationPreferenceKey('user_intent_status.compatible'),
    'compatibleStatus'
  );
});

test('mantém moderação, compliance, billing, system e tipos desconhecidos como essenciais', () => {
  assert.equal(
    resolvePushNotificationPreferenceKey('community.content.moderated'),
    null
  );
  assert.equal(
    resolvePushNotificationPreferenceKey('compliance.terms.update_required'),
    null
  );
  assert.equal(resolvePushNotificationPreferenceKey('billing'), null);
  assert.equal(resolvePushNotificationPreferenceKey('system'), null);
  assert.equal(resolvePushNotificationPreferenceKey('future.unknown.type'), null);
  assert.equal(resolvePushNotificationPreferenceKey(undefined), null);
});

test('desativa push opcional somente quando a preferência é false explícito', () => {
  assert.equal(
    isPushNotificationEnabledByPreference('messages', {messages: false}),
    false
  );
  assert.equal(
    isPushNotificationEnabledByPreference('connections', {connections: false}),
    false
  );
  assert.equal(
    isPushNotificationEnabledByPreference('communities', {communities: false}),
    false
  );
  assert.equal(
    isPushNotificationEnabledByPreference('compatibleStatus', {
      compatibleStatus: false,
    }),
    false
  );
});

test('preferência ausente ou inválida preserva o default ativo', () => {
  assert.equal(isPushNotificationEnabledByPreference('messages', undefined), true);
  assert.equal(isPushNotificationEnabledByPreference('messages', null), true);
  assert.equal(isPushNotificationEnabledByPreference('messages', []), true);
  assert.equal(isPushNotificationEnabledByPreference('messages', {}), true);
  assert.equal(
    isPushNotificationEnabledByPreference('messages', {messages: 'false'}),
    true
  );
});
