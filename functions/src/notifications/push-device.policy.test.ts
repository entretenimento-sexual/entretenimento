import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPushTokenDocumentId,
  isPermanentPushTokenErrorCode,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushToken,
  resolveInvalidPushRegistryDocumentIds,
  resolvePushDeliveryTargets,
  resolvePushDevicePlatform,
} from './push-device.policy';

const TOKEN = 'fcm-token-value-that-is-long-enough-for-validation-1234567890';
const TOKEN_B = 'second-fcm-token-value-that-is-long-enough-0987654321';

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

test('mantém fallback legado quando ainda não há dispositivo no registro privado', () => {
  assert.deepEqual(resolvePushDeliveryTargets(TOKEN, []), [
    { token: TOKEN, registryDocumentIds: [] },
  ]);
});

test('combina registro privado e token legado sem enviar duplicado', () => {
  assert.deepEqual(
    resolvePushDeliveryTargets(TOKEN, [
      { documentId: 'device-a', token: TOKEN },
      { documentId: 'device-b', token: TOKEN_B },
    ]),
    [
      { token: TOKEN, registryDocumentIds: ['device-a'] },
      { token: TOKEN_B, registryDocumentIds: ['device-b'] },
    ]
  );
});

test('preserva todas as referências privadas quando houver token duplicado', () => {
  assert.deepEqual(
    resolvePushDeliveryTargets(undefined, [
      { documentId: 'device-a', token: TOKEN },
      { documentId: 'device-a-copy', token: TOKEN },
      { documentId: '', token: TOKEN_B },
      { documentId: 'invalid', token: 'short-token' },
    ]),
    [
      {
        token: TOKEN,
        registryDocumentIds: ['device-a', 'device-a-copy'],
      },
    ]
  );
});

test('classifica somente erros de token permanentemente inválido para limpeza', () => {
  assert.equal(
    isPermanentPushTokenErrorCode(
      'messaging/registration-token-not-registered'
    ),
    true
  );
  assert.equal(
    isPermanentPushTokenErrorCode('messaging/invalid-registration-token'),
    true
  );
  assert.equal(isPermanentPushTokenErrorCode('messaging/internal-error'), false);
  assert.equal(
    isPermanentPushTokenErrorCode('messaging/server-unavailable'),
    false
  );
  assert.equal(isPermanentPushTokenErrorCode('messaging/invalid-argument'), false);
  assert.equal(isPermanentPushTokenErrorCode(undefined), false);
});

test('limpa somente referências privadas ligadas a falhas permanentes', () => {
  const targets = resolvePushDeliveryTargets(TOKEN_B, [
    { documentId: 'device-a', token: TOKEN },
  ]);

  assert.deepEqual(
    resolveInvalidPushRegistryDocumentIds(targets, [
      'messaging/registration-token-not-registered',
      'messaging/internal-error',
    ]),
    ['device-a']
  );
});

test('não tenta remover o campo legado quando a falha permanente é só dele', () => {
  const targets = resolvePushDeliveryTargets(TOKEN, []);

  assert.deepEqual(
    resolveInvalidPushRegistryDocumentIds(targets, [
      'messaging/registration-token-not-registered',
    ]),
    []
  );
});
