// src/app/core/access/content-access-navigation.service.ts
// -----------------------------------------------------------------------------
// CONTENT ACCESS NAVIGATION SERVICE
// -----------------------------------------------------------------------------
// Traduz decisões de acesso em rotas canônicas da aplicação.
// Não cria checkout, não interpreta pagamentos e não concede entitlement.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Params, Router } from '@angular/router';

import { ErrorNotificationService } from '../services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../services/error-handler/global-error-handler.service';
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
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

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
    try {
      this.errorNotifier.showError('Não foi possível abrir esta etapa.');
    } catch {
      // O tratamento técnico abaixo continua mesmo se o canal visual falhar.
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));

      (normalizedError as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      }).context = {
        scope: 'ContentAccessNavigationService',
        op: 'navigateForDecision',
        reason: decision.reason,
        recommendedAction: decision.recommendedAction,
      };

      (normalizedError as Error & { skipUserNotification?: boolean })
        .skipUserNotification = true;

      this.globalError.handleError(normalizedError);
    } catch {
      // Evita transformar uma falha secundária de observabilidade em novo erro.
    }
  }
}
