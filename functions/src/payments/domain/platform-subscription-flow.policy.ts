// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION FLOW POLICY
// -----------------------------------------------------------------------------
// Limita a continuação do checkout a destinos internos conhecidos. Esses dados
// organizam navegação e apresentação; nunca confirmam pagamento ou entitlement.
// -----------------------------------------------------------------------------

import type { PlatformRole } from './billing.model';

export const COMMUNITY_CREATE_RETURN_URL =
  '/dashboard/comunidades/nova' as const;

export type PlatformSubscriptionReturnUrl =
  typeof COMMUNITY_CREATE_RETURN_URL;

export interface PlatformSubscriptionFlowContext {
  minimumRole: PlatformRole | null;
  returnUrl: PlatformSubscriptionReturnUrl | null;
}

export function normalizePlatformSubscriptionMinimumRole(
  value: unknown
): PlatformRole | null {
  return value === 'basic' || value === 'premium' || value === 'vip'
    ? value
    : null;
}

export function normalizePlatformSubscriptionReturnUrl(
  value: unknown
): PlatformSubscriptionReturnUrl | null {
  return String(value ?? '').trim() === COMMUNITY_CREATE_RETURN_URL
    ? COMMUNITY_CREATE_RETURN_URL
    : null;
}

export function normalizePlatformSubscriptionFlowContext(input: {
  minimumRole?: unknown;
  returnUrl?: unknown;
}): PlatformSubscriptionFlowContext {
  return {
    minimumRole: normalizePlatformSubscriptionMinimumRole(input.minimumRole),
    returnUrl: normalizePlatformSubscriptionReturnUrl(input.returnUrl),
  };
}

export function platformSubscriptionFlowMetadata(
  context: PlatformSubscriptionFlowContext
): Record<string, unknown> {
  if (!context.minimumRole && !context.returnUrl) return {};

  return {
    subscriptionFlow: {
      ...(context.minimumRole ? { minimumRole: context.minimumRole } : {}),
      ...(context.returnUrl ? { returnUrl: context.returnUrl } : {}),
    },
  };
}

export function readPlatformSubscriptionFlowContext(
  metadata: Record<string, unknown> | undefined
): PlatformSubscriptionFlowContext {
  const source = metadata?.['subscriptionFlow'];
  const context = source && typeof source === 'object'
    ? source as Record<string, unknown>
    : {};

  return normalizePlatformSubscriptionFlowContext({
    minimumRole: context['minimumRole'],
    returnUrl: context['returnUrl'],
  });
}

export function buildPlatformSubscriptionProviderReturnUrl(params: {
  appBaseUrl: string;
  billing: 'success' | 'cancel';
  checkoutSessionId: string;
  flowContext: PlatformSubscriptionFlowContext;
}): string {
  const url = new URL('/billing/return', params.appBaseUrl);

  url.searchParams.set('billing', params.billing);
  url.searchParams.set('scope', 'platform_subscription');
  url.searchParams.set('checkoutSessionId', params.checkoutSessionId);

  if (params.flowContext.minimumRole) {
    url.searchParams.set('minimumRole', params.flowContext.minimumRole);
  }

  if (params.flowContext.returnUrl) {
    url.searchParams.set('returnUrl', params.flowContext.returnUrl);
  }

  return url.toString();
}
