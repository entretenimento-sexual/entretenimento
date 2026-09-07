import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPushTokenDocumentId,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushToken,
  resolvePushDevicePlatform,
} from './push-device.policy';

const TOKEN = 'fcm-token-value-that-is-long-enough-for-validation-1234567890';

test('normaliza token FCM sem aceitar payload curto, vazio ou não textual', () => {
  assert.equal(normalizePushToken(`  ${TOKEN}  `), TOKEN);
  assert.equal(normalizePushToken('short-token'), null);
  assert.equal(normalizePushToken('   '), null);
  assert.equal(normalizePushToken(undefined), null);
  assert.equal(normalizePushToken({ token: TOKEN }), null);
});

test('limita tamanho máximo do token recebido', () => {
  assert.equal(normalizePushToken('x'.repeat(4096)), 'x'.repeat(4096));
  assert.equal(normalizePushToken('x'.repeat(4097)), null);
});

test('aceita somente plataformas canônicas previstas para expansão mobile', () => {
  assert.equal(resolvePushDevicePlatform('web'), 'web');
  assert.equal(resolvePushDevicePlatform(' IOS '), 'ios');
  assert.equal(resolvePushDevicePlatform('android'), 'android');
  assert.equal(resolvePushDevicePlatform('desktop'), null);
  assert.equal(resolvePushDevicePlatform(undefined), null);
});

test('gera id determinístico sem persistir o token no caminho do documento', () => {
  const id = buildPushTokenDocumentId(TOKEN);

  assert.equal(id.length, 64);
  assert.equal(id, buildPushTokenDocumentId(TOKEN));
  assert.notEqual(id, TOKEN);
  assert.match(id, /^[a-f0-9]{64}$/);
});

test('mantém limite explícito de dispositivos por usuário', () => {
  assert.equal(MAX_PUSH_DEVICES_PER_USER, 10);
});
