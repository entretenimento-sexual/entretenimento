// src/app/core/access/content-access-navigation.service.ts
// -----------------------------------------------------------------------------
// CONTENT ACCESS NAVIGATION SERVICE
// -----------------------------------------------------------------------------
// Traduz decisões de acesso em rotas canônicas da aplicação.
// Não cria checkout, não interpreta pagamentos e não concede entitlement.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Params, Router } from '@angular/router';

import { ApplicationErrorService } from '../services/error-handler/application-error.service';
import {
  ContentAccessDecision,
  ContentAccessRecommendedAction,
} from './content-access-policy.model';

export interface ContentAccessNavigationTarget {
  commands: string[];
  queryParams?: Params;
}

const ROUTE_BY_ACTION: Readonly<
  Record<Exclude<ContentAccessRecommendedAction, null>, readonly string[]>
> = Object.freeze({
  sign_in: ['/login'],
  review_account: ['/conta/status'],
  accept_current_terms: ['/register/aceitar-termos'],
  complete_age_reverification: ['/adulto/revalidar'],
  confirm_adult_access: ['/adulto/confirmar'],
  complete_profile: ['/register/finalizar-cadastro'],
  upgrade_subscription: ['/subscription-plan'],
});

function normalizeInternalReturnUrl(
  value: string | null | undefined
): string | null {
  const route = String(value ?? '').trim();

  if (
    !route ||
    route === '/' ||
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('\\')
  ) {
    return null;
  }

  return route;
}

function normalizePathForComparison(value: string): string {
  const [path] = value.split(/[?#]/, 1);
  return (path || '/').replace(/\/+/g, '/');
}

export function resolveContentAccessNavigationTarget(
  decision: ContentAccessDecision,
  currentUrl?: string | null
): ContentAccessNavigationTarget | null {
  const action = decision.recommendedAction;

  if (decision.allowed || action === null) {
    return null;
  }

  const commands = [...ROUTE_BY_ACTION[action]];
  const returnUrl = normalizeInternalReturnUrl(currentUrl);
  const targetPath = normalizePathForComparison(commands.join('/'));
  const queryParams: Params = {};

  if (
    returnUrl &&
    normalizePathForComparison(returnUrl) !== targetPath
  ) {
    queryParams['returnUrl'] = returnUrl;
  }

  if (
    action === 'upgrade_subscription' &&
    decision.minimumRole &&
    decision.minimumRole !== 'free'
  ) {
    queryParams['minimumRole'] = decision.minimumRole;
  }

  return {
    commands,
    ...(Object.keys(queryParams).length ? { queryParams } : {}),
  };
}

@Injectable({ providedIn: 'root' })
export class ContentAccessNavigationService {
  private readonly router = inject(Router);
  private readonly applicationError = inject(ApplicationErrorService);

  async navigateForDecision(
    decision: ContentAccessDecision,
    currentUrl = this.router.url
  ): Promise<boolean> {
    const target = resolveContentAccessNavigationTarget(decision, currentUrl);

    if (!target) {
      return false;
    }

    try {
      return await this.router.navigate(target.commands, {
        queryParams: target.queryParams,
      });
    } catch (error) {
      this.reportNavigationError(error, decision);
      return false;
    }
  }

  private reportNavigationError(
    error: unknown,
    decision: ContentAccessDecision
  ): void {
    this.applicationError.report(error, {
      feature: 'access',
      operation: 'navigateForDecision',
      fallbackMessage: 'Não foi possível abrir esta etapa.',
      metadata: {
        scope: 'ContentAccessNavigationService',
        reason: decision.reason,
        recommendedAction: decision.recommendedAction,
      },
    });
  }
}
