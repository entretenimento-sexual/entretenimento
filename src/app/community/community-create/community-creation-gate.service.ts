// src/app/community/community-create/community-creation-gate.service.ts
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import {
  catchError,
  defer,
  from,
  map,
  Observable,
  of,
  switchMap,
  take,
} from 'rxjs';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import {
  COMMUNITY_CREATE_RETURN_URL,
  subscriptionFlowQueryParams,
} from 'src/app/subscriptions/domain/subscription-flow-context.model';
import { CommunityCreationCapability } from '../data-access/community-capacity.model';
import { CommunityCreateRepository } from '../data-access/community-create.repository';

type CommunityCreationGateDestination =
  | 'create'
  | 'communities'
  | 'manage'
  | 'plans';

type CommunityCreationUpgradeRole = 'basic' | 'premium' | 'vip';

interface CommunityCreationGateAction {
  destination: CommunityCreationGateDestination;
  minimumRole: CommunityCreationUpgradeRole | null;
}

interface CommunityCreationGateDialogConfig {
  data: ConfirmationDialogData;
  confirmAction: CommunityCreationGateAction;
  cancelAction: CommunityCreationGateAction;
}

@Injectable({ providedIn: 'root' })
export class CommunityCreationGateService {
  private readonly repository = inject(CommunityCreateRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);

  requestCreation$(): Observable<void> {
    return defer(() => this.repository.getCreationCapability$()).pipe(
      take(1),
      switchMap((capability) => capability.canCreate
        ? this.navigate$({ destination: 'create', minimumRole: null })
        : this.handleBlockedCapability$(capability)),
      catchError((error: unknown) => {
        this.reportCapabilityError(error);
        return of(void 0);
      })
    );
  }

  handleBlockedCapability$(
    capability: CommunityCreationCapability
  ): Observable<void> {
    if (capability.canCreate) return of(void 0);

    return this.openCreationGateDialog$(capability).pipe(
      switchMap((action) => this.navigate$(action)),
      catchError((error: unknown) => {
        this.reportNavigationError(error);
        return of(void 0);
      })
    );
  }

  planLabel(capability: CommunityCreationCapability): string {
    return capability.sponsorRole === 'admin'
      ? 'perfil administrativo'
      : capability.sponsorRole === 'basic'
        ? 'plano Basic'
        : capability.sponsorRole === 'premium'
          ? 'plano Premium'
          : capability.sponsorRole === 'vip'
            ? 'plano VIP'
            : 'perfil Gratuito';
  }

  private openCreationGateDialog$(
    capability: CommunityCreationCapability
  ): Observable<CommunityCreationGateAction> {
    const config = this.buildDialogConfig(capability);
    const ref = this.dialog.open<
      ConfirmationDialogComponent,
      ConfirmationDialogData,
      boolean
    >(ConfirmationDialogComponent, {
      data: config.data,
      disableClose: false,
      autoFocus: 'first-tabbable',
      restoreFocus: false,
    });

    return ref.afterClosed().pipe(
      take(1),
      map((confirmed) => confirmed === true
        ? config.confirmAction
        : config.cancelAction)
    );
  }

  private buildDialogConfig(
    capability: CommunityCreationCapability
  ): CommunityCreationGateDialogConfig {
    if (capability.reason === 'subscription_required') {
      return {
        data: {
          eyebrow: 'Conta Gratuita',
          title: 'Crie sua própria Comunidade',
          message:
            'Participar das Comunidades continua gratuito. Para criar e administrar a sua, é necessário o plano Basic ou superior.',
          detail:
            'O Basic permite 1 Comunidade com até 100 membros. Premium e VIP ampliam a quantidade de Comunidades e a capacidade de cada uma.',
          icon: 'groups',
          tone: 'info',
          confirmLabel: 'Ver planos',
          cancelLabel: 'Continuar explorando',
        },
        confirmAction: { destination: 'plans', minimumRole: 'basic' },
        cancelAction: { destination: 'communities', minimumRole: null },
      };
    }

    const nextRole = this.nextUpgradeRole(capability.sponsorRole);
    const current = capability.currentOwnedCommunities;
    const maximum = capability.maxOwnedCommunities;
    const occupancy = maximum === null
      ? `${current} Comunidades próprias`
      : `${current} de ${maximum} ${maximum === 1 ? 'Comunidade' : 'Comunidades'}`;

    if (nextRole) {
      return {
        data: {
          eyebrow: `Limite do ${this.planLabel(capability)}`,
          title: 'Você atingiu o limite de Comunidades',
          message: `${occupancy}. Suas Comunidades continuam funcionando normalmente.`,
          detail:
            'Você pode gerenciar as Comunidades atuais ou comparar um plano com mais espaço para criar outra.',
          icon: 'group_work',
          tone: 'info',
          confirmLabel: 'Comparar planos',
          cancelLabel: 'Gerenciar Comunidades',
        },
        confirmAction: { destination: 'plans', minimumRole: nextRole },
        cancelAction: { destination: 'manage', minimumRole: null },
      };
    }

    return {
      data: {
        eyebrow: `Limite do ${this.planLabel(capability)}`,
        title: 'Você atingiu o limite de Comunidades',
        message: `${occupancy}. Suas Comunidades continuam funcionando normalmente.`,
        detail:
          'Gerencie, transfira ou arquive uma Comunidade antes de criar outra.',
        icon: 'group_work',
        tone: 'info',
        confirmLabel: 'Gerenciar Comunidades',
        cancelLabel: 'Continuar explorando',
      },
      confirmAction: { destination: 'manage', minimumRole: null },
      cancelAction: { destination: 'communities', minimumRole: null },
    };
  }

  private nextUpgradeRole(
    role: CommunityCreationCapability['sponsorRole']
  ): CommunityCreationUpgradeRole | null {
    if (role === 'free') return 'basic';
    if (role === 'basic') return 'premium';
    if (role === 'premium') return 'vip';
    return null;
  }

  private navigate$(action: CommunityCreationGateAction): Observable<void> {
    if (action.destination === 'plans') {
      return from(this.router.navigate(['/subscription-plan'], {
        queryParams: subscriptionFlowQueryParams({
          minimumRole: action.minimumRole ?? 'basic',
          returnUrl: COMMUNITY_CREATE_RETURN_URL,
        }),
      })).pipe(map(() => void 0));
    }

    const target = action.destination === 'create'
      ? '/dashboard/comunidades/nova'
      : action.destination === 'manage'
        ? '/dashboard/comunidades/minhas'
        : '/dashboard/comunidades';

    return from(this.router.navigate([target])).pipe(map(() => void 0));
  }

  private reportCapabilityError(error: unknown): void {
    try {
      this.notifications.showError(
        'Não foi possível verificar a criação de Comunidades agora.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'requestCreation');
  }

  private reportNavigationError(error: unknown): void {
    try {
      this.notifications.showError(
        'Não foi possível abrir o próximo passo da criação agora.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'navigateCreationGate');
  }

  private reportTechnicalError(error: unknown, op: string): void {
    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityCreationGateService',
        op,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o fluxo visual.
    }
  }
}
