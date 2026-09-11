import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCommunityPushMuted,
  isPushNotificationEnabledByPreference,
  normalizeCommunityPushPreferenceId,
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

test('normaliza somente ids seguros para preferência push por Comunidade', () => {
  assert.equal(normalizeCommunityPushPreferenceId('community-1'), 'community-1');
  assert.equal(normalizeCommunityPushPreferenceId(' community:official_2 '), 'community:official_2');
  assert.equal(normalizeCommunityPushPreferenceId(''), null);
  assert.equal(normalizeCommunityPushPreferenceId('community/1'), null);
  assert.equal(normalizeCommunityPushPreferenceId('a'.repeat(129)), null);
});

test('mute por Comunidade exige true explícito', () => {
  assert.equal(isCommunityPushMuted({muted: true}), true);
  assert.equal(isCommunityPushMuted({muted: false}), false);
  assert.equal(isCommunityPushMuted({muted: 'true'}), false);
  assert.equal(isCommunityPushMuted({}), false);
  assert.equal(isCommunityPushMuted(null), false);
});
