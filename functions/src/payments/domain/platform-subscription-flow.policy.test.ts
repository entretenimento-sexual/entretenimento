import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_CREATE_RETURN_URL,
  buildPlatformSubscriptionProviderReturnUrl,
  normalizePlatformSubscriptionFlowContext,
  platformSubscriptionFlowMetadata,
  readPlatformSubscriptionFlowContext,
} from './platform-subscription-flow.policy';

test('normaliza somente a continuação interna reconhecida', () => {
  assert.deepEqual(
    normalizePlatformSubscriptionFlowContext({
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }),
    {
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    }
  );

  assert.deepEqual(
    normalizePlatformSubscriptionFlowContext({
      minimumRole: 'admin',
      returnUrl: 'https://example.com/capture',
    }),
    { minimumRole: null, returnUrl: null }
  );
});

test('persiste e relê apenas o contexto sanitizado', () => {
  const metadata = platformSubscriptionFlowMetadata({
    minimumRole: 'premium',
    returnUrl: COMMUNITY_CREATE_RETURN_URL,
  });

  assert.deepEqual(readPlatformSubscriptionFlowContext(metadata), {
    minimumRole: 'premium',
    returnUrl: COMMUNITY_CREATE_RETURN_URL,
  });

  assert.deepEqual(
    readPlatformSubscriptionFlowContext({
      subscriptionFlow: {
        minimumRole: 'root',
        returnUrl: '//example.com',
      },
    }),
    { minimumRole: null, returnUrl: null }
  );
});

test('inclui o contexto seguro no retorno do provedor', () => {
  const result = new URL(buildPlatformSubscriptionProviderReturnUrl({
    appBaseUrl: 'http://127.0.0.1:4200',
    billing: 'success',
    checkoutSessionId: 'checkout-1',
    flowContext: {
      minimumRole: 'basic',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    },
  }));

  assert.equal(result.pathname, '/billing/return');
  assert.equal(result.searchParams.get('billing'), 'success');
  assert.equal(result.searchParams.get('scope'), 'platform_subscription');
  assert.equal(result.searchParams.get('checkoutSessionId'), 'checkout-1');
  assert.equal(result.searchParams.get('minimumRole'), 'basic');
  assert.equal(
    result.searchParams.get('returnUrl'),
    COMMUNITY_CREATE_RETURN_URL
  );
});
