import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertAsaasApiKeyMatchesEnvironment,
  requireCloudAppBaseUrl,
  resolveAsaasEnvironment,
} from './asaas.config';

test('resolve ambiente Asaas apenas para sandbox ou production', () => {
  assert.equal(resolveAsaasEnvironment('sandbox'), 'sandbox');
  assert.equal(resolveAsaasEnvironment(' PRODUCTION '), 'production');

  assert.throws(
    () => resolveAsaasEnvironment('staging'),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'failed-precondition'
  );
});

test('não mistura chave de sandbox e produção', () => {
  assert.doesNotThrow(() =>
    assertAsaasApiKeyMatchesEnvironment(
      '$aact_prod_example',
      'production'
    )
  );
  assert.doesNotThrow(() =>
    assertAsaasApiKeyMatchesEnvironment(
      '$aact_hmlg_example',
      'sandbox'
    )
  );

  assert.throws(
    () =>
      assertAsaasApiKeyMatchesEnvironment(
        '$aact_hmlg_example',
        'production'
      ),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'failed-precondition'
  );
});

test('APP_BASE_URL de cloud precisa ser HTTPS e retorna somente origin', () => {
  assert.equal(
    requireCloudAppBaseUrl(
      'https://example.com/qualquer/caminho?query=1'
    ),
    'https://example.com'
  );

  assert.throws(
    () => requireCloudAppBaseUrl('http://example.com'),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'failed-precondition'
  );
});
