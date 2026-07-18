// src/app/subscriber-experiences/exclusive-connections/exclusive-connections-access.service.ts
// -----------------------------------------------------------------------------
// EXCLUSIVE CONNECTIONS ACCESS SERVICE
// -----------------------------------------------------------------------------
// Combina, em ordem:
// 1. conta, consentimento adulto e perfil pelo CurrentUserStore;
// 2. snapshot financeiro sanitizado baseado no entitlement do backend.
//
// A callable do feed repete toda a autorização antes de devolver dados.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import {
  catchError,
  distinctUntilChanged,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
} from 'rxjs';

import {
  areContentAccessDecisionsEqual,
  ContentAccessDecision,
} from 'src/app/core/access/content-access-policy.service';
import { ContentAccessPolicyService } from 'src/app/core/access/content-access-policy.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { BillingSnapshotResult } from 'src/app/payments-core/domain/models/billing-return.model';
import { BillingRepository } from 'src/app/payments-core/infrastructure/repositories/billing.repository';
import {
  EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE,
  EXCLUSIVE_CONNECTIONS_PROFILE_ACCESS_POLICY,
} from './exclusive-connections-access.policy';

const ROLE_WEIGHT = Object.freeze({
  basic: 1,
  premium: 2,
  vip: 3,
});

function denied(
  reason: 'role_insufficient' | 'subscription_inactive'
): ContentAccessDecision {
  return {
    allowed: false,
    reason,
    recommendedAction: 'upgrade_subscription',
    minimumRole: EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE,
    missingProfileFields: [],
  };
}

function allowed(): ContentAccessDecision {
  return {
    allowed: true,
    reason: null,
    recommendedAction: null,
    minimumRole: EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE,
    missingProfileFields: [],
  };
}

function withMinimumRole(
  decision: ContentAccessDecision
): ContentAccessDecision {
  return {
    ...decision,
    minimumRole: EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE,
  };
}

export function evaluateExclusiveConnectionsBillingSnapshot(
  snapshot: BillingSnapshotResult | null | undefined
): ContentAccessDecision {
  const role = String(snapshot?.tier ?? snapshot?.role ?? '')
    .trim()
    .toLowerCase() as keyof typeof ROLE_WEIGHT;
  const roleWeight = ROLE_WEIGHT[role] ?? 0;
  const minimumWeight = ROLE_WEIGHT[EXCLUSIVE_CONNECTIONS_MINIMUM_ROLE];
  const hasPlatformEntitlement =
    snapshot?.entitlements?.includes('platform_subscription') === true;

  if (
    snapshot?.isSubscriber !== true
    || !hasPlatformEntitlement
  ) {
    return denied('subscription_inactive');
  }

  if (roleWeight < minimumWeight) {
    return denied('role_insufficient');
  }

  return allowed();
}

@Injectable({ providedIn: 'root' })
export class ExclusiveConnectionsAccessService {
  private readonly contentAccess = inject(ContentAccessPolicyService);
  private readonly billingRepository = inject(BillingRepository);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);

  evaluate$(): Observable<ContentAccessDecision> {
    return this.contentAccess
      .evaluate$(EXCLUSIVE_CONNECTIONS_PROFILE_ACCESS_POLICY)
      .pipe(
        switchMap((profileDecision) => {
          if (!profileDecision.allowed) {
            return of(withMinimumRole(profileDecision));
          }

          return this.billingRepository.getMyBillingSnapshot$().pipe(
            map(evaluateExclusiveConnectionsBillingSnapshot),
            catchError((error: unknown) => {
              this.reportSnapshotError(error);
              return of(denied('subscription_inactive'));
            })
          );
        }),
        distinctUntilChanged(areContentAccessDecisionsEqual),
        shareReplay({ bufferSize: 1, refCount: true })
      );
  }

  private reportSnapshotError(error: unknown): void {
    try {
      this.errorNotifier.showError(
        'Não foi possível verificar sua assinatura agora.'
      );
    } catch {
      // O diagnóstico técnico abaixo continua se o feedback visual falhar.
    }

    try {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      const contextualError = normalizedError as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };

      contextualError.context = {
        scope: 'ExclusiveConnectionsAccessService',
        op: 'getMyBillingSnapshot',
      };
      contextualError.skipUserNotification = true;

      this.globalError.handleError(contextualError);
    } catch {
      // Observabilidade não deve produzir uma nova falha para o usuário.
    }
  }
}
