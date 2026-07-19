// src/app/community/preview/community-preview-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  exhaustMap,
  from,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';

import {
  ContentAccessDecision,
  ContentAccessDenialReason,
  ContentAccessMinimumRole,
  ContentAccessRecommendedAction,
} from 'src/app/core/access/content-access-policy.model';
import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import {
  CommunityPreviewCard,
  CommunityPreviewResponse,
  CommunityPreviewSourceType,
  CommunityPreviewViewerMode,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityFeedComponent } from '../feed/community-feed.component';
import { CommunityMembershipManagementComponent } from '../membership-management/community-membership-management.component';

export type CommunityPreviewSection = 'feed' | 'photos' | 'about' | 'requests';

type CommunityPreviewState =
  | { status: 'loading'; preview: null }
  | { status: 'ready'; preview: CommunityPreviewResponse }
  | { status: 'error'; preview: null };

type CommunityMembershipActionKind = 'request' | 'leave';

type CommunityMembershipActionState =
  | { status: 'idle'; kind: null }
  | { status: 'loading'; kind: CommunityMembershipActionKind }
  | { status: 'error'; kind: CommunityMembershipActionKind };

interface CommunityMembershipCommand {
  kind: CommunityMembershipActionKind;
  community: CommunityPreviewCard;
  pending: boolean;
}

const ACCESS_ACTIONS = new Set<Exclude<ContentAccessRecommendedAction, null>>([
  'sign_in',
  'review_account',
  'confirm_adult_access',
  'complete_profile',
  'upgrade_subscription',
]);

const ACCESS_REASONS = new Set<ContentAccessDenialReason>([
  'unauthenticated',
  'account_restricted',
  'adult_access_required',
  'profile_incomplete',
  'profile_field_missing',
  'role_insufficient',
  'subscription_inactive',
  'access_check_unavailable',
]);

@Component({
  selector: 'app-community-preview-page',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    ImageFallbackDirective,
    CommunityFeedComponent,
    CommunityMembershipManagementComponent,
  ],
  templateUrl: './community-preview-page.component.html',
  styleUrl: './community-preview-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly previewRepository = inject(CommunityPreviewRepository);
  private readonly membershipRepository = inject(CommunityMembershipRepository);
  private readonly accessNavigation = inject(ContentAccessNavigationService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly refreshPreview$ = new Subject<void>();
  private readonly membershipCommands$ = new Subject<CommunityMembershipCommand>();

  readonly activeSection = signal<CommunityPreviewSection>('feed');
  readonly backRoute = String(
    this.route.snapshot.data['backRoute'] ?? '/dashboard/comunidades'
  );

  private readonly communityId$ = this.route.paramMap.pipe(
    map((params) => String(params.get('communityId') ?? '').trim()),
    map((communityId) => {
      if (!communityId) throw new Error('Identificador do espaço social ausente.');
      return communityId;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly state$ = combineLatest([
    this.communityId$,
    this.refreshPreview$.pipe(startWith(undefined)),
  ]).pipe(
    switchMap(([communityId]) =>
      this.previewRepository.getPreview$(communityId).pipe(
        map(
          (preview): CommunityPreviewState => ({
            status: 'ready',
            preview,
          })
        ),
        startWith<CommunityPreviewState>({ status: 'loading', preview: null })
      )
    ),
    catchError((error: unknown) => {
      this.reportPreviewError(error);
      return of<CommunityPreviewState>({ status: 'error', preview: null });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly membershipAction$ = this.membershipCommands$.pipe(
    exhaustMap((command) => {
      const operation$ = command.kind === 'request'
        ? this.membershipRepository.requestMembership$(
            command.community.communityId
          )
        : this.membershipRepository.leaveMembership$(
            command.community.communityId
          );

      return operation$.pipe(
        tap((result) => {
          this.errorNotifier.showSuccess(
            this.membershipSuccessMessage(command, result.status)
          );
          this.activeSection.set('feed');
          this.refreshPreview$.next();
        }),
        map(
          (): CommunityMembershipActionState => ({
            status: 'idle',
            kind: null,
          })
        ),
        startWith<CommunityMembershipActionState>({
          status: 'loading',
          kind: command.kind,
        }),
        catchError((error: unknown) =>
          this.handleMembershipError(error, command.community, command.kind)
        )
      );
    }),
    startWith<CommunityMembershipActionState>({ status: 'idle', kind: null }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  selectSection(section: CommunityPreviewSection): void {
    this.activeSection.set(section);
  }

  requestMembership(community: CommunityPreviewCard): void {
    if (community.access.join === 'invite_only') return;
    this.membershipCommands$.next({
      kind: 'request',
      community,
      pending: false,
    });
  }

  leaveMembership(
    community: CommunityPreviewCard,
    viewerMode: CommunityPreviewViewerMode
  ): void {
    this.membershipCommands$.next({
      kind: 'leave',
      community,
      pending: viewerMode === 'pending',
    });
  }

  membershipActionLabel(community: CommunityPreviewCard): string {
    if (community.source.type === 'venue') {
      return community.access.join === 'open' ? 'Seguir' : 'Solicitar acesso';
    }

    return community.access.join === 'open' ? 'Participar' : 'Solicitar';
  }

  canLeave(mode: CommunityPreviewViewerMode): boolean {
    return mode === 'pending' || mode === 'member' || mode === 'moderator';
  }

  canManage(mode: CommunityPreviewViewerMode): boolean {
    return mode === 'moderator' || mode === 'manager';
  }

  membershipReviewed(): void {
    this.refreshPreview$.next();
  }

  sourceLabel(community: CommunityPreviewCard): string {
    return getSocialSpaceDefinition(community.source.type).label;
  }

  sourceDescription(community: CommunityPreviewCard): string {
    return getSocialSpaceDefinition(community.source.type).description;
  }

  viewerLabel(
    mode: CommunityPreviewViewerMode,
    role: CommunityPreviewViewerRole | null = null,
    sourceType: CommunityPreviewSourceType = 'community'
  ): string {
    if (role === 'owner') {
      return sourceType === 'venue' ? 'Proprietário' : 'Criador';
    }
    if (role === 'admin') return 'Administração';

    const labels: Record<CommunityPreviewViewerMode, string> = {
      visitor: 'Visitante',
      pending: 'Pendente',
      member: 'Membro',
      moderator: 'Moderação',
      manager: 'Gestão',
    };

    return labels[mode];
  }

  accessLabel(community: CommunityPreviewCard): string | null {
    if (!community.access.requiresActiveSubscription) return null;

    const minimumRole = community.access.minimumRole;
    return minimumRole === 'vip'
      ? 'VIP'
      : minimumRole === 'premium'
        ? 'Premium'
        : 'Assinantes';
  }

  joinLabel(community: CommunityPreviewCard): string {
    if (community.source.type === 'venue') {
      const venueLabels = {
        open: 'Acompanhamento aberto',
        approval: 'Acesso por aprovação',
        invite_only: 'Acesso por convite',
      } as const;
      return venueLabels[community.access.join];
    }

    const communityLabels = {
      open: 'Participação aberta',
      approval: 'Entrada por aprovação',
      invite_only: 'Somente convite',
    } as const;
    return communityLabels[community.access.join];
  }

  metricsAriaLabel(community: CommunityPreviewCard): string {
    return `Resumo do ${this.sourceLabel(community)}`;
  }

  private membershipSuccessMessage(
    command: CommunityMembershipCommand,
    resultStatus: 'active' | 'pending' | 'left'
  ): string {
    const isVenue = command.community.source.type === 'venue';

    if (command.kind === 'request') {
      if (resultStatus === 'active') {
        return isVenue
          ? 'Você começou a seguir o Local.'
          : 'Você entrou na Comunidade.';
      }
      return isVenue ? 'Solicitação de acesso enviada.' : 'Solicitação enviada.';
    }

    if (command.pending) return 'Solicitação cancelada.';
    return isVenue ? 'Você saiu do Local.' : 'Você saiu da Comunidade.';
  }

  private handleMembershipError(
    error: unknown,
    community: CommunityPreviewCard,
    kind: CommunityMembershipActionKind
  ): Observable<CommunityMembershipActionState> {
    const accessDecision = this.resolveAccessDecision(error, community);

    if (accessDecision) {
      return from(
        this.accessNavigation.navigateForDecision(accessDecision)
      ).pipe(
        map(
          (): CommunityMembershipActionState => ({
            status: 'idle',
            kind: null,
          })
        )
      );
    }

    this.reportMembershipError(error, community, kind);
    return of<CommunityMembershipActionState>({ status: 'error', kind });
  }

  private resolveAccessDecision(
    error: unknown,
    community: CommunityPreviewCard
  ): ContentAccessDecision | null {
    const details = ((error as { details?: unknown } | null)?.details ?? {}) as
      Record<string, unknown>;
    const recommendedAction = details['recommendedAction'];
    const reason = details['reason'];

    if (
      typeof recommendedAction !== 'string'
      || !ACCESS_ACTIONS.has(
        recommendedAction as Exclude<ContentAccessRecommendedAction, null>
      )
      || typeof reason !== 'string'
      || !ACCESS_REASONS.has(reason as ContentAccessDenialReason)
    ) {
      return null;
    }

    const rawMinimumRole = details['minimumRole'];
    const minimumRole: ContentAccessMinimumRole | null =
      rawMinimumRole === 'basic'
      || rawMinimumRole === 'premium'
      || rawMinimumRole === 'vip'
      || rawMinimumRole === 'free'
        ? rawMinimumRole
        : community.access.minimumRole;

    return {
      allowed: false,
      reason: reason as ContentAccessDenialReason,
      recommendedAction:
        recommendedAction as Exclude<ContentAccessRecommendedAction, null>,
      minimumRole,
      missingProfileFields: [],
    };
  }

  private reportPreviewError(error: unknown): void {
    this.reportError(
      error,
      'Não foi possível abrir este espaço agora.',
      'loadPreview'
    );
  }

  private reportMembershipError(
    error: unknown,
    community: CommunityPreviewCard,
    kind: CommunityMembershipActionKind
  ): void {
    const isVenue = community.source.type === 'venue';
    const message = kind === 'leave'
      ? isVenue
        ? 'Não foi possível sair deste Local agora.'
        : 'Não foi possível sair desta Comunidade agora.'
      : isVenue
        ? 'Não foi possível solicitar acesso a este Local agora.'
        : 'Não foi possível concluir a participação nesta Comunidade agora.';

    this.reportError(
      error,
      message,
      kind === 'leave' ? 'leaveMembership' : 'requestMembership'
    );
  }

  private reportError(error: unknown, message: string, op: string): void {
    try {
      this.errorNotifier.showError(message);
    } catch {
      // O diagnóstico técnico abaixo permanece ativo.
    }

    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityPreviewPageComponent',
        op,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
