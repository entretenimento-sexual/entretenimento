// src/app/community/preview/community-preview-page.component.ts
import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  from,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
} from 'rxjs';

import {
  ContentAccessDecision,
  ContentAccessDenialReason,
  ContentAccessMinimumRole,
  ContentAccessRecommendedAction,
} from 'src/app/core/access/content-access-policy.model';
import { ContentAccessNavigationService } from 'src/app/core/access/content-access-navigation.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import { ImageFallbackDirective } from 'src/app/shared/directives/image-fallback.directive';
import { CommunityMembershipRepository } from '../data-access/community-membership.repository';
import {
  CommunityPreviewCard,
  CommunityPreviewLifecycleStatus,
  CommunityPreviewResponse,
  CommunityPreviewSourceType,
  CommunityPreviewViewerMode,
  CommunityPreviewViewerRole,
} from '../data-access/community-preview.model';
import { CommunityPreviewRepository } from '../data-access/community-preview.repository';
import { CommunityMembersPageComponent } from '../members/community-members-page.component';
import { CommunitySearchComponent } from '../search/community-search.component';
import { CommunityFeedComponent } from '../feed/community-feed.component';
import { CommunityTopicsComponent } from '../topics/community-topics.component';
import { CommunityInviteManagementComponent } from '../invite-management/community-invite-management.component';
import { CommunityMembershipManagementComponent } from '../membership-management/community-membership-management.component';
import { OfficialEntityCommunitySectionComponent } from '../official-entity-community-section/official-entity-community-section.component';
import {
  COMMUNITY_MEMBERSHIP_ACTION_CODE_MESSAGES,
  COMMUNITY_MEMBERSHIP_ACTION_REASON_MESSAGES,
  COMMUNITY_PREVIEW_LOAD_CODE_MESSAGES,
} from '../presentation/community-error.messages';
import {
  COMMUNITY_MEMBERSHIP_ACTION_REASON_PRESENTATIONS,
} from '../presentation/community-error.presentations';
import { CommunityOfficialBadgeComponent } from '../presentation/community-official-badge.component';
import { getCommunitySocialSpaceAdapter } from '../presentation/community-social-space.adapter';
import {
  COMMUNITY_SECTION_ICONS,
  resolveCommunityMembershipRolePresentation,
} from '../presentation/community-ui.presentation';
import {
  communityInitials as buildCommunityInitials,
  communityVisualVariant as resolveCommunityVisualVariant,
} from '../presentation/community-visual-identity';
import { CommunityMembershipProfileVisibilityComponent } from './community-membership-profile-visibility.component';

export type CommunityPreviewSection =
  | 'feed'
  | 'search'
  | 'topics'
  | 'photos'
  | 'members'
  | 'about'
  | 'invites'
  | 'requests';

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

interface CommunityLifecycleNotice {
  title: string;
  message: string;
  icon: string;
}

const COMMUNITY_LIFECYCLE_NOTICES: Readonly<
  Partial<Record<CommunityPreviewLifecycleStatus, CommunityLifecycleNotice>>
> = Object.freeze({
  paused: {
    title: 'Comunidade pausada',
    message:
      'As interações estão pausadas. A gestão de membros continua disponível apenas para pessoas autorizadas.',
    icon: 'fa-pause',
  },
  dormant: {
    title: 'Comunidade pouco ativa',
    message:
      'Esta Comunidade está fora da descoberta por inatividade. A atividade dos membros pode reativá-la.',
    icon: 'fa-moon',
  },
  archived: {
    title: 'Comunidade arquivada',
    message:
      'O conteúdo foi preservado para consulta dos vínculos existentes. Novas interações estão encerradas.',
    icon: 'fa-box-archive',
  },
  scheduled_for_deletion: {
    title: 'Comunidade em encerramento',
    message:
      'Novas interações estão indisponíveis enquanto o período de retenção aplicável é concluído.',
    icon: 'fa-hourglass-end',
  },
});

const ACCESS_ACTIONS = new Set<Exclude<ContentAccessRecommendedAction, null>>([
  'sign_in',
  'review_account',
  'confirm_adult_access',
  'complete_profile',
]);

const ACCESS_REASONS = new Set<ContentAccessDenialReason>([
  'unauthenticated',
  'account_restricted',
  'adult_access_required',
  'profile_incomplete',
  'profile_field_missing',
  'role_insufficient',
  'access_check_unavailable',
]);

const COMMUNITY_FEED_TARGET_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeCommunityFeedTargetId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return COMMUNITY_FEED_TARGET_ID_PATTERN.test(normalized) ? normalized : null;
}

const SECTION_QUERY_VALUES: Readonly<Record<CommunityPreviewSection, string | null>> =
  Object.freeze({
    feed: null,
    search: 'buscar',
    topics: 'topicos',
    photos: 'fotos',
    members: 'membros',
    about: 'sobre',
    invites: 'convites',
    requests: 'gestao',
  });

@Component({
  selector: 'app-community-preview-page',
  standalone: true,
  imports: [
    AsyncPipe,
    RouterLink,
    ImageFallbackDirective,
    CommunityFeedComponent,
    CommunitySearchComponent,
    CommunityTopicsComponent,
    CommunityMembersPageComponent,
    CommunityInviteManagementComponent,
    CommunityMembershipManagementComponent,
    OfficialEntityCommunitySectionComponent,
    CommunityOfficialBadgeComponent,
    CommunityMembershipProfileVisibilityComponent,
  ],
  templateUrl: './community-preview-page.component.html',
  styleUrl: './community-preview-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityPreviewPageComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly previewRepository = inject(CommunityPreviewRepository);
  private readonly membershipRepository = inject(CommunityMembershipRepository);
  private readonly accessNavigation = inject(ContentAccessNavigationService);
  private readonly errorNotifier = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly refreshPreview$ = new Subject<void>();
  private readonly membershipCommands$ = new Subject<CommunityMembershipCommand>();

  readonly sectionIcons = COMMUNITY_SECTION_ICONS;
  readonly backRoute = String(
    this.route.snapshot.data['backRoute'] ?? '/dashboard/comunidades'
  );
  readonly activeSection = signal<CommunityPreviewSection>(
    this.sectionFromQuery(this.route.snapshot.queryParamMap?.get('secao'))
  );
  readonly returnTarget = signal<string>(
    this.resolveReturnTarget(this.route.snapshot.queryParamMap?.get('retorno'))
  );
  readonly focusedPostId = signal<string | null>(
    normalizeCommunityFeedTargetId(
      this.route.snapshot.queryParamMap?.get('post')
    )
  );
  readonly focusedCommentId = signal<string | null>(
    this.focusedPostId()
      ? normalizeCommunityFeedTargetId(
          this.route.snapshot.queryParamMap?.get('comentario')
        )
      : null
  );
  readonly focusedTopicId = signal<string | null>(
    normalizeCommunityFeedTargetId(
      this.route.snapshot.queryParamMap?.get('topico')
    )
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
        tap((preview) => this.ensureSectionAvailable(preview)),
        map(
          (preview): CommunityPreviewState => ({
            status: 'ready',
            preview,
          })
        ),
        catchError((error: unknown) => {
          this.reportPreviewError(error);
          return of<CommunityPreviewState>({ status: 'error', preview: null });
        }),
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
          this.selectSection('feed', true);
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

  constructor() {
    const queryParamMap$ = this.route.queryParamMap;
    if (!queryParamMap$) return;

    queryParamMap$
      .pipe(
        map((params) => {
          const rawSection = String(params.get('secao') ?? '').trim().toLowerCase();
          const postId = normalizeCommunityFeedTargetId(params.get('post'));
          const commentId = postId
            ? normalizeCommunityFeedTargetId(params.get('comentario'))
            : null;
          const topicId = normalizeCommunityFeedTargetId(params.get('topico'));

          return {
            section: postId
              ? 'feed' as const
              : topicId
                ? 'topics' as const
                : this.sectionFromQuery(rawSection),
            returnTarget: this.resolveReturnTarget(params.get('retorno')),
            postId,
            commentId,
            topicId,
          };
        }),
        distinctUntilChanged(
          (previous, current) =>
            previous.section === current.section
            && previous.returnTarget === current.returnTarget
            && previous.postId === current.postId
            && previous.commentId === current.commentId
            && previous.topicId === current.topicId
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({
        section,
        returnTarget,
        postId,
        commentId,
        topicId,
      }) => {
        this.activeSection.set(section);
        this.returnTarget.set(returnTarget);
        this.focusedPostId.set(postId);
        this.focusedCommentId.set(commentId);
        this.focusedTopicId.set(topicId);
      });
  }

  selectSection(
    section: CommunityPreviewSection,
    replaceUrl = false
  ): void {
    this.activeSection.set(section);
    const clearFeedTarget = section !== 'feed' && !!this.focusedPostId();
    const clearTopicTarget = section !== 'topics' && !!this.focusedTopicId();

    if (clearFeedTarget) {
      this.focusedPostId.set(null);
      this.focusedCommentId.set(null);
    }
    if (clearTopicTarget) {
      this.focusedTopicId.set(null);
    }

    const queryParams: Record<string, string | null> = {
      secao: SECTION_QUERY_VALUES[section],
    };
    if (clearFeedTarget) {
      queryParams['post'] = null;
      queryParams['comentario'] = null;
    }
    if (clearTopicTarget) {
      queryParams['topico'] = null;
    }

    try {
      const navigation = this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge',
        replaceUrl,
      });
      void navigation.catch((error: unknown) =>
        this.reportTechnicalError(error, 'navigateSection')
      );
    } catch (error) {
      this.reportTechnicalError(error, 'navigateSection');
    }
  }

  openTopicFromSearch(topicId: string): void {
    const normalizedTopicId = normalizeCommunityFeedTargetId(topicId);
    if (!normalizedTopicId) return;

    this.activeSection.set('topics');
    this.focusedTopicId.set(normalizedTopicId);
    this.focusedPostId.set(null);
    this.focusedCommentId.set(null);

    try {
      const navigation = this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {
          secao: SECTION_QUERY_VALUES.topics,
          topico: normalizedTopicId,
          post: null,
          comentario: null,
        },
        queryParamsHandling: 'merge',
      });
      void navigation.catch((error: unknown) =>
        this.reportTechnicalError(error, 'navigateSearchTopic')
      );
    } catch (error) {
      this.reportTechnicalError(error, 'navigateSearchTopic');
    }
  }

  retryPreview(): void {
    this.refreshPreview$.next();
  }

  returnRoute(): string {
    return this.returnTarget().split('?')[0].split('#')[0] || this.backRoute;
  }

  returnQueryParams(): Record<string, string> | null {
    const target = this.returnTarget();
    const queryIndex = target.indexOf('?');
    if (queryIndex < 0) return null;

    const query = target.slice(queryIndex + 1).split('#')[0];
    const interest = new URLSearchParams(query).get('interesse')?.trim() ?? '';
    return /^[A-Za-z0-9:_-]{1,128}$/.test(interest)
      ? { interesse: interest }
      : null;
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
    viewerMode: CommunityPreviewViewerMode,
    viewerRole: CommunityPreviewViewerRole | null = null
  ): void {
    const pending = viewerMode === 'pending';

    if (pending) {
      this.membershipCommands$.next({
        kind: 'leave',
        community,
        pending: true,
      });
      return;
    }

    const dialogData = this.buildLeaveConfirmationData(
      community,
      viewerMode,
      viewerRole
    );
    const ref = this.dialog.open<
      ConfirmationDialogComponent,
      ConfirmationDialogData,
      boolean
    >(ConfirmationDialogComponent, {
      panelClass: 'confirmation-dialog-panel',
      width: 'min(94vw, 460px)',
      maxWidth: '94vw',
      autoFocus: false,
      restoreFocus: true,
      data: dialogData,
    });

    ref.afterClosed()
      .pipe(take(1))
      .subscribe((confirmed) => {
        if (!confirmed) return;

        this.membershipCommands$.next({
          kind: 'leave',
          community,
          pending: false,
        });
      });
  }

  membershipActionLabel(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).membership.actionLabel(community.access.join);
  }

  membershipReviewed(): void {
    this.refreshPreview$.next();
  }

  sourceLabel(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).definition.label;
  }

  sourceDescription(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).definition.description;
  }

  spaceCapabilities(community: CommunityPreviewCard) {
    return getCommunitySocialSpaceAdapter(community.source.type).capabilities;
  }

  officialEntityTargetType(
    community: CommunityPreviewCard
  ): 'venue' | null {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).officialEntityTargetType;
  }

  feedSectionLabel(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).feed('feed').sectionLabel;
  }

  leaveMembershipLabel(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).membership.leaveActionLabel(community.access.join);
  }

  interactionRestrictedLabel(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).membership.interactionRestrictedLabel;
  }

  communityInitials(community: CommunityPreviewCard): string {
    return buildCommunityInitials(community);
  }

  communityVisualVariant(community: CommunityPreviewCard): number {
    return resolveCommunityVisualVariant(community);
  }

  viewerRelationshipPresentation(
    mode: CommunityPreviewViewerMode,
    role: CommunityPreviewViewerRole | null = null,
    sourceType: CommunityPreviewSourceType = 'community'
  ) {
    if (mode !== 'moderator' && mode !== 'manager') return null;

    return resolveCommunityMembershipRolePresentation(role, sourceType) ?? {
      label: mode === 'moderator' ? 'Moderação' : 'Gestão',
      icon: mode === 'moderator' ? 'fa-shield' : 'fa-shield-halved',
    };
  }

  viewerLabel(
    mode: CommunityPreviewViewerMode,
    role: CommunityPreviewViewerRole | null = null,
    sourceType: CommunityPreviewSourceType = 'community'
  ): string {
    if (role === 'owner') {
      return getCommunitySocialSpaceAdapter(sourceType).ownerRoleLabel;
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

  joinLabel(community: CommunityPreviewCard): string {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).membership.joinLabel(community.access.join);
  }

  metricsAriaLabel(community: CommunityPreviewCard): string {
    return `Resumo do ${this.sourceLabel(community)}`;
  }

  lifecycleNotice(
    status: CommunityPreviewLifecycleStatus | null
  ): CommunityLifecycleNotice | null {
    return status ? COMMUNITY_LIFECYCLE_NOTICES[status] ?? null : null;
  }

  private ensureSectionAvailable(preview: CommunityPreviewResponse): void {
    const section = this.activeSection();
    const capabilities = this.spaceCapabilities(preview.community);
    const allowed = section === 'requests'
      ? preview.canManageMemberships
      : section === 'invites'
        ? preview.canInviteCommunityMembers
        : section === 'members'
          ? capabilities.memberDirectory
          : section === 'search'
            ? capabilities.internalSearch
            : section === 'topics'
            ? capabilities.topics
            : true;

    if (!allowed) {
      this.selectSection('about', true);
    }
  }

  private sectionFromQuery(value: unknown): CommunityPreviewSection {
    switch (String(value ?? '').trim().toLowerCase()) {
      case 'buscar':
        return 'search';
      case 'topicos':
        return 'topics';
      case 'fotos':
        return 'photos';
      case 'membros':
        return 'members';
      case 'sobre':
        return 'about';
      case 'convites':
        return 'invites';
      case 'gestao':
        return 'requests';
      default:
        return 'feed';
    }
  }

  private resolveReturnTarget(value: unknown): string {
    const candidate = String(value ?? '').trim();
    if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
      return this.backRoute;
    }

    const path = candidate.split('?')[0].split('#')[0];
    const allowed = path === '/dashboard/comunidades'
      || path === '/dashboard/comunidades/minhas'
      || path === '/dashboard/comunidades/convites'
      || path === '/dashboard/locais';

    return allowed ? candidate : this.backRoute;
  }

  private buildLeaveConfirmationData(
    community: CommunityPreviewCard,
    viewerMode: CommunityPreviewViewerMode,
    viewerRole: CommunityPreviewViewerRole | null
  ): ConfirmationDialogData {
    return getCommunitySocialSpaceAdapter(
      community.source.type
    ).membership.leaveConfirmation({
      viewerMode,
      viewerRole,
      join: community.access.join,
    });
  }

  private membershipSuccessMessage(
    command: CommunityMembershipCommand,
    resultStatus: 'active' | 'pending' | 'left'
  ): string {
    return getCommunitySocialSpaceAdapter(
      command.community.source.type
    ).membership.successMessage({
      kind: command.kind,
      resultStatus,
      pending: command.pending,
    });
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
        ),
        catchError((navigationError: unknown) => {
          this.reportAccessNavigationError(navigationError, community, kind);
          return of<CommunityMembershipActionState>({ status: 'error', kind });
        })
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
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadPreview',
      fallbackMessage: 'Não foi possível carregar esta Comunidade agora.',
      notification: 'none',
      codeMessages: COMMUNITY_PREVIEW_LOAD_CODE_MESSAGES,
      metadata: {
        scope: 'CommunityPreviewPageComponent',
        section: this.activeSection(),
      },
    });
  }

  private reportAccessNavigationError(
    error: unknown,
    community: CommunityPreviewCard,
    kind: CommunityMembershipActionKind
  ): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'navigateMembershipAccess',
      fallbackMessage: 'Não foi possível abrir a etapa necessária para continuar.',
      metadata: {
        scope: 'CommunityPreviewPageComponent',
        communityId: community.communityId,
        sourceType: community.source.type,
        action: kind,
        section: this.activeSection(),
      },
    });
  }

  private reportMembershipError(
    error: unknown,
    community: CommunityPreviewCard,
    kind: CommunityMembershipActionKind
  ): void {
    const fallbackMessage = getCommunitySocialSpaceAdapter(
      community.source.type
    ).membership.errorFallback(kind);

    this.applicationError.report(error, {
      feature: 'community',
      operation: kind === 'leave' ? 'leaveMembership' : 'requestMembership',
      fallbackMessage,
      codeMessages: COMMUNITY_MEMBERSHIP_ACTION_CODE_MESSAGES,
      reasonMessages: COMMUNITY_MEMBERSHIP_ACTION_REASON_MESSAGES,
      reasonPresentations: COMMUNITY_MEMBERSHIP_ACTION_REASON_PRESENTATIONS,
      metadata: {
        scope: 'CommunityPreviewPageComponent',
        communityId: community.communityId,
        sourceType: community.source.type,
        section: this.activeSection(),
      },
    });
  }

  private reportTechnicalError(error: unknown, operation: string): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation,
      fallbackMessage: 'Não foi possível concluir esta ação agora.',
      notification: 'none',
      metadata: {
        scope: 'CommunityPreviewPageComponent',
        section: this.activeSection(),
      },
    });
  }
}
