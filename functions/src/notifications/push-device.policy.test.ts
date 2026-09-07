import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPushInstallationDocumentId,
  buildPushTokenDocumentId,
  isPermanentPushTokenErrorCode,
  MAX_PUSH_DEVICES_PER_USER,
  normalizePushInstallationId,
  normalizePushToken,
  resolveInvalidPushDeliveryTargets,
  resolveInvalidPushRegistryDocumentIds,
  resolvePushDeliveryTargets,
  resolvePushDevicePlatform,
  shouldPruneCurrentPushToken,
} from './push-device.policy';

const TOKEN = 'fcm-token-value-that-is-long-enough-for-validation-1234567890';
const TOKEN_B = 'second-fcm-token-value-that-is-long-enough-0987654321';
const INSTALLATION_ID = '550e8400-e29b-41d4-a716-446655440000';

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

test('normaliza installation id sem aceitar fingerprint ou payload arbitrário', () => {
  assert.equal(
    normalizePushInstallationId(`  ${INSTALLATION_ID}  `),
    INSTALLATION_ID
  );
  assert.equal(normalizePushInstallationId('short'), null);
  assert.equal(normalizePushInstallationId('x'.repeat(129)), null);
  assert.equal(normalizePushInstallationId('device id with spaces'), null);
  assert.equal(normalizePushInstallationId('device/../../other'), null);
  assert.equal(normalizePushInstallationId(undefined), null);
});

test('aceita somente plataformas canônicas previstas para expansão mobile', () => {
  assert.equal(resolvePushDevicePlatform('web'), 'web');
  assert.equal(resolvePushDevicePlatform(' IOS '), 'ios');
  assert.equal(resolvePushDevicePlatform('android'), 'android');
  assert.equal(resolvePushDevicePlatform('desktop'), null);
  assert.equal(resolvePushDevicePlatform(undefined), null);
});

test('gera id estável da instalação sem expor o identificador no caminho', () => {
  const id = buildPushInstallationDocumentId(INSTALLATION_ID);

  assert.equal(id.length, 64);
  assert.equal(id, buildPushInstallationDocumentId(INSTALLATION_ID));
  assert.notEqual(id, INSTALLATION_ID);
  assert.match(id, /^[a-f0-9]{64}$/);
});

test('mantém id legado por token somente para migração do registro v1', () => {
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

test('seleciona somente alvos ligados a falhas permanentes', () => {
  const targets = resolvePushDeliveryTargets(TOKEN_B, [
    { documentId: 'device-a', token: TOKEN },
  ]);

  assert.deepEqual(
    resolveInvalidPushDeliveryTargets(targets, [
      'messaging/registration-token-not-registered',
      'messaging/internal-error',
    ]),
    [
      {
        token: TOKEN,
        registryDocumentIds: ['device-a'],
      },
    ]
  );
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

test('expõe fallback legado para limpeza quando ele falha permanentemente', () => {
  const targets = resolvePushDeliveryTargets(TOKEN, []);

  assert.deepEqual(
    resolveInvalidPushDeliveryTargets(targets, [
      'messaging/registration-token-not-registered',
    ]),
    [
      {
        token: TOKEN,
        registryDocumentIds: [],
      },
    ]
  );
  assert.deepEqual(
    resolveInvalidPushRegistryDocumentIds(targets, [
      'messaging/registration-token-not-registered',
    ]),
    []
  );
});

test('não seleciona fallback legado para limpeza em falha transitória', () => {
  const targets = resolvePushDeliveryTargets(TOKEN, []);

  assert.deepEqual(
    resolveInvalidPushDeliveryTargets(targets, ['messaging/internal-error']),
    []
  );
});

test('cleanup condicional preserva token que já rotacionou', () => {
  assert.equal(shouldPruneCurrentPushToken(TOKEN, TOKEN), true);
  assert.equal(shouldPruneCurrentPushToken(TOKEN_B, TOKEN), false);
  assert.equal(shouldPruneCurrentPushToken(undefined, TOKEN), false);
});
