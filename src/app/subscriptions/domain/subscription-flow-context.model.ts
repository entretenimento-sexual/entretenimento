// -----------------------------------------------------------------------------
// SUBSCRIPTION FLOW CONTEXT
// -----------------------------------------------------------------------------
// Preserva somente continuações internas conhecidas durante planos e checkout.
// O contexto organiza a navegação; nunca concede assinatura ou autorização.
// -----------------------------------------------------------------------------

import type { PlatformPlanKey } from 'src/app/payments-core/domain/models/billing-plan.model';

export const SUBSCRIPTION_PLAN_ROUTE = '/subscription-plan' as const;
export const COMMUNITY_CREATE_RETURN_URL =
  '/dashboard/comunidades/nova' as const;

export type SubscriptionReturnUrl = typeof COMMUNITY_CREATE_RETURN_URL;

export interface SubscriptionFlowContext {
  minimumRole: PlatformPlanKey | null;
  returnUrl: SubscriptionReturnUrl | null;
}

export const EMPTY_SUBSCRIPTION_FLOW_CONTEXT: Readonly<SubscriptionFlowContext> =
  Object.freeze({
    minimumRole: null,
    returnUrl: null,
  });

export function normalizeSubscriptionMinimumRole(
  value: unknown
): PlatformPlanKey | null {
  return value === 'basic' || value === 'premium' || value === 'vip'
    ? value
    : null;
}

export function normalizeSubscriptionReturnUrl(
  value: unknown
): SubscriptionReturnUrl | null {
  return String(value ?? '').trim() === COMMUNITY_CREATE_RETURN_URL
    ? COMMUNITY_CREATE_RETURN_URL
    : null;
}

export function normalizeSubscriptionFlowContext(input: {
  minimumRole?: unknown;
  returnUrl?: unknown;
}): SubscriptionFlowContext {
  return {
    minimumRole: normalizeSubscriptionMinimumRole(input.minimumRole),
    returnUrl: normalizeSubscriptionReturnUrl(input.returnUrl),
  };
}

export function subscriptionFlowQueryParams(
  context: SubscriptionFlowContext
): Record<string, string> {
  return {
    ...(context.minimumRole ? { minimumRole: context.minimumRole } : {}),
    ...(context.returnUrl ? { returnUrl: context.returnUrl } : {}),
  };
}

/**
 * URL interna canônica para iniciar o fluxo de assinatura preservando somente
 * parâmetros previamente normalizados pelo contrato desta camada.
 */
export function subscriptionFlowUrl(
  context: SubscriptionFlowContext
): string {
  const query = new URLSearchParams(subscriptionFlowQueryParams(context))
    .toString();

  return query ? `${SUBSCRIPTION_PLAN_ROUTE}?${query}` : SUBSCRIPTION_PLAN_ROUTE;
}

export function isCommunityCreationSubscriptionFlow(
  context: SubscriptionFlowContext
): boolean {
  return context.returnUrl === COMMUNITY_CREATE_RETURN_URL;
}

export function resolveConfirmedSubscriptionReturnUrl(
  authoritativeReturnUrl: unknown,
  requestedReturnUrl: unknown
): SubscriptionReturnUrl | '/conta' {
  return normalizeSubscriptionReturnUrl(authoritativeReturnUrl)
    ?? normalizeSubscriptionReturnUrl(requestedReturnUrl)
    ?? '/conta';
}
