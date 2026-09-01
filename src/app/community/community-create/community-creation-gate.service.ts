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

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import {
  COMMUNITY_CREATE_RETURN_URL,
  subscriptionFlowQueryParams,
} from 'src/app/subscriptions/domain/subscription-flow-context.model';
import {
  CommunityCreationCapability,
  CommunityRecommendedUpgradeRole,
} from '../data-access/community-capacity.model';
import { CommunityCreateRepository } from '../data-access/community-create.repository';

type CommunityCreationGateDestination =
  | 'create'
  | 'communities'
  | 'manage'
  | 'plans';

type CommunityCreationUpgradeRole = Exclude<
  CommunityRecommendedUpgradeRole,
  null
>;

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
  private readonly applicationError = inject(ApplicationErrorService);
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

  upgradeRole(
    capability: CommunityCreationCapability
  ): CommunityCreationUpgradeRole | null {
    return capability.recommendedUpgradeRole;
  }

  upgradePlanLabel(
    capability: CommunityCreationCapability
  ): string | null {
    const role = this.upgradeRole(capability);
    if (!role) return null;
    if (role === 'basic') return 'Basic';
    if (role === 'premium') return 'Premium';
    return 'VIP';
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
    const current = capability.currentOwnedCommunities;
    const maximum = capability.maxOwnedCommunities;
    const ownsCommunities = current > 0;
    const aboveCurrentLimit = maximum !== null && current > maximum;

    if (capability.reason === 'subscription_required') {
      const upgradeRole = capability.recommendedUpgradeRole
        ?? capability.minimumRole;
      const upgradePlanLabel = this.upgradePlanLabel(capability) ?? 'Basic';

      if (ownsCommunities) {
        return {
          data: {
            eyebrow: 'Regularização de Comunidades',
            title: 'Seu plano atual não cobre suas Comunidades',
            message:
              `Você possui ${current} ${current === 1 ? 'Comunidade' : 'Comunidades'} e sua assinatura atual não libera a criação. Nenhuma Comunidade ou membro será removido automaticamente.`,
            detail:
              'Novas entradas podem ficar pausadas conforme a capacidade disponível. Regularize o plano ou use a gestão das Comunidades para transferir ou arquivar quando fizer sentido.',
            icon: 'manage_accounts',
            tone: 'warning',
            confirmLabel: 'Regularizar plano',
            cancelLabel: 'Gerenciar Comunidades',
          },
          confirmAction: { destination: 'plans', minimumRole: upgradeRole },
          cancelAction: { destination: 'manage', minimumRole: null },
        };
      }

      return {
        data: {
          eyebrow: 'Conta Gratuita',
          title: 'Crie sua própria Comunidade',
          message:
            `Participar das Comunidades continua gratuito. Para criar e administrar a sua, é necessário o plano ${upgradePlanLabel} ou superior.`,
          detail:
            'As quantidades de Comunidades e as capacidades disponíveis são confirmadas pela sua conta antes da criação.',
          icon: 'groups',
          tone: 'info',
          confirmLabel: 'Ver planos',
          cancelLabel: 'Continuar explorando',
        },
        confirmAction: { destination: 'plans', minimumRole: upgradeRole },
        cancelAction: { destination: 'communities', minimumRole: null },
      };
    }

    const nextRole = capability.recommendedUpgradeRole;
    const occupancy = maximum === null
      ? `${current} Comunidades próprias`
      : `${current} de ${maximum} ${maximum === 1 ? 'Comunidade' : 'Comunidades'}`;

    if (aboveCurrentLimit) {
      const overage = current - (maximum ?? current);
      const overageLabel = `${overage} ${overage === 1 ? 'Comunidade está' : 'Comunidades estão'}`;

      if (nextRole) {
        return {
          data: {
            eyebrow: 'Regularização de Comunidades',
            title: 'Seu plano mudou e excede o limite atual',
            message:
              `${occupancy}. ${overageLabel} acima do limite do ${this.planLabel(capability)}. Nenhuma será excluída automaticamente.`,
            detail:
              'Você pode comparar um plano compatível ou gerenciar as Comunidades atuais para transferir ou arquivar as que não pretende manter sob sua propriedade.',
            icon: 'manage_accounts',
            tone: 'warning',
            confirmLabel: 'Regularizar plano',
            cancelLabel: 'Gerenciar Comunidades',
          },
          confirmAction: { destination: 'plans', minimumRole: nextRole },
          cancelAction: { destination: 'manage', minimumRole: null },
        };
      }

      return {
        data: {
          eyebrow: 'Regularização de Comunidades',
          title: 'Você possui mais Comunidades que o limite atual',
          message:
            `${occupancy}. ${overageLabel} acima do limite atual, mas nenhuma será excluída automaticamente.`,
          detail:
            'Use a gestão para transferir ou arquivar Comunidades até que sua propriedade volte a ficar compatível.',
          icon: 'manage_accounts',
          tone: 'warning',
          confirmLabel: 'Gerenciar Comunidades',
          cancelLabel: 'Continuar explorando',
        },
        confirmAction: { destination: 'manage', minimumRole: null },
        cancelAction: { destination: 'communities', minimumRole: null },
      };
    }

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
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'requestCreation',
      fallbackMessage:
        'Não foi possível verificar a criação de Comunidades agora.',
      reasonMessages: {
        profile_incomplete: 'Complete seu perfil para criar uma Comunidade.',
        adult_access_required:
          'Confirme seu acesso adulto para criar uma Comunidade.',
        account_restricted:
          'Sua conta não pode criar Comunidades neste momento.',
      },
      metadata: {
        scope: 'CommunityCreationGateService',
      },
    });
  }

  private reportNavigationError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'navigateCreationGate',
      fallbackMessage:
        'Não foi possível abrir o próximo passo da criação agora.',
      metadata: {
        scope: 'CommunityCreationGateService',
      },
    });
  }
}
