import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_CREATE_RETURN_URL,
  isCommunityCreationSubscriptionFlow,
  normalizeSubscriptionFlowContext,
  resolveConfirmedSubscriptionReturnUrl,
  subscriptionFlowQueryParams,
} from './subscription-flow-context.model';

describe('subscription flow context', () => {
  it('preserva o contexto conhecido de criação de Comunidade', () => {
    const context = normalizeSubscriptionFlowContext({
      minimumRole: 'premium',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    });

    expect(context).toEqual({
      minimumRole: 'premium',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    });
    expect(isCommunityCreationSubscriptionFlow(context)).toBe(true);
    expect(subscriptionFlowQueryParams(context)).toEqual({
      minimumRole: 'premium',
      returnUrl: COMMUNITY_CREATE_RETURN_URL,
    });
  });

  it('descarta níveis e destinos externos ou desconhecidos', () => {
    expect(
      normalizeSubscriptionFlowContext({
        minimumRole: 'admin',
        returnUrl: 'https://example.com/capture',
      })
    ).toEqual({ minimumRole: null, returnUrl: null });

    expect(
      normalizeSubscriptionFlowContext({
        minimumRole: 'basic',
        returnUrl: '//example.com',
      })
    ).toEqual({ minimumRole: 'basic', returnUrl: null });
  });

  it('prioriza a continuação confirmada e mantém fallback seguro', () => {
    expect(
      resolveConfirmedSubscriptionReturnUrl(
        COMMUNITY_CREATE_RETURN_URL,
        null
      )
    ).toBe(COMMUNITY_CREATE_RETURN_URL);

    expect(
      resolveConfirmedSubscriptionReturnUrl(
        'https://example.com',
        COMMUNITY_CREATE_RETURN_URL
      )
    ).toBe(COMMUNITY_CREATE_RETURN_URL);

    expect(resolveConfirmedSubscriptionReturnUrl('/admin', '//evil.test'))
      .toBe('/conta');
  });
});
