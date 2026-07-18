// src/app/shared/components/content-access-notice/content-access-notice.component.ts
// -----------------------------------------------------------------------------
// CONTENT ACCESS NOTICE COMPONENT
// -----------------------------------------------------------------------------
// Estado visual enxuto para decisões negadas.
//
// Segurança:
// - não projeta conteúdo protegido;
// - não busca dados;
// - não concede acesso;
// - deve ser renderizado pelo pai somente no ramo negado da decisão.
// -----------------------------------------------------------------------------

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import {
  ContentAccessDecision,
  ContentAccessMinimumRole,
} from 'src/app/core/access/content-access-policy.model';

export interface ContentAccessNoticeViewModel {
  message: string;
  actionLabel: string | null;
  icon: string;
  actionIcon: string | null;
  ariaLabel: string;
}

const ROLE_LABELS: Readonly<Record<ContentAccessMinimumRole, string>> =
  Object.freeze({
    free: 'Grátis',
    basic: 'Basic',
    premium: 'Premium',
    vip: 'VIP',
  });

export function buildContentAccessNoticeViewModel(
  decision: ContentAccessDecision
): ContentAccessNoticeViewModel {
  switch (decision.reason) {
    case 'unauthenticated':
      return {
        message: 'Entre para continuar.',
        actionLabel: 'Entrar',
        icon: 'fa-right-to-bracket',
        actionIcon: 'fa-arrow-right',
        ariaLabel: 'Acesso disponível após entrar na conta.',
      };

    case 'account_restricted':
      return {
        message: 'Revise o status da sua conta.',
        actionLabel: 'Ver conta',
        icon: 'fa-shield-halved',
        actionIcon: 'fa-arrow-right',
        ariaLabel: 'Acesso indisponível enquanto a conta estiver restrita.',
      };

    case 'adult_access_required':
      return {
        message: 'Confirme seu acesso adulto.',
        actionLabel: 'Confirmar',
        icon: 'fa-id-card',
        actionIcon: 'fa-arrow-right',
        ariaLabel: 'Confirmação de acesso adulto necessária.',
      };

    case 'profile_incomplete':
    case 'profile_field_missing':
      return {
        message: 'Complete seu perfil para continuar.',
        actionLabel: 'Completar',
        icon: 'fa-user-pen',
        actionIcon: 'fa-arrow-right',
        ariaLabel: 'Perfil incompleto para esta experiência.',
      };

    case 'role_insufficient': {
      const roleLabel = decision.minimumRole
        ? ROLE_LABELS[decision.minimumRole]
        : 'assinante';

      return {
        message: `Disponível a partir do plano ${roleLabel}.`,
        actionLabel: 'Ver planos',
        icon: 'fa-crown',
        actionIcon: 'fa-arrow-right',
        ariaLabel: `Acesso disponível a partir do plano ${roleLabel}.`,
      };
    }

    case 'subscription_inactive':
      return {
        message: 'Ative sua assinatura para continuar.',
        actionLabel: 'Ver planos',
        icon: 'fa-credit-card',
        actionIcon: 'fa-arrow-right',
        ariaLabel: 'Assinatura ativa necessária para esta experiência.',
      };

    case 'access_check_unavailable':
      return {
        message: 'Não foi possível verificar o acesso agora.',
        actionLabel: 'Tentar novamente',
        icon: 'fa-circle-exclamation',
        actionIcon: 'fa-rotate-right',
        ariaLabel: 'Verificação de acesso temporariamente indisponível.',
      };

    case null:
    default:
      return {
        message: 'Acesso indisponível no momento.',
        actionLabel: null,
        icon: 'fa-lock',
        actionIcon: null,
        ariaLabel: 'Acesso indisponível no momento.',
      };
  }
}

@Component({
  selector: 'app-content-access-notice',
  standalone: true,
  templateUrl: './content-access-notice.component.html',
  styleUrl: './content-access-notice.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContentAccessNoticeComponent {
  private readonly navigation = inject(ContentAccessNavigationService);

  readonly decision = input.required<ContentAccessDecision>();
  readonly compact = input(false);
  readonly retryRequested = output<void>();

  readonly navigating = signal(false);
  readonly viewModel = computed(() =>
    buildContentAccessNoticeViewModel(this.decision())
  );

  async handleAction(): Promise<void> {
    const decision = this.decision();

    if (this.navigating() || decision.allowed) {
      return;
    }

    if (decision.reason === 'access_check_unavailable') {
      this.retryRequested.emit();
      return;
    }

    if (decision.recommendedAction === null) {
      return;
    }

    this.navigating.set(true);

    try {
      await this.navigation.navigateForDecision(decision);
    } finally {
      this.navigating.set(false);
    }
  }
}
