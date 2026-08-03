// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL VISITADO
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - Exibir outro usuário como vitrine pública completa.
// - Priorizar identidade, dados públicos autorizados, mídias e interação.
// - Consumir somente projeções públicas e políticas de acesso especializadas.
// - Manter amizade, chat, erro global e debug fora da camada visual.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  BehaviorSubject,
  Observable,
  combineLatest,
  map,
  of,
  shareReplay,
  switchMap,
  take,
  throwError,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  finalize,
} from 'rxjs/operators';

import { Friend } from 'src/app/core/interfaces/friendship/friend.interface';
import { FriendRequest } from 'src/app/core/interfaces/friendship/friend-request.interface';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { PublicProfileViewService } from 'src/app/core/services/user-profile/public-profile-view.service';
import { ProfileMediaShowcaseComponent } from 'src/app/media/shared/components/profile-media-showcase/profile-media-showcase.component';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';
import { SharedModule } from '../../shared/shared.module';

interface FriendshipInteractionState {
  isFriend: boolean;
  canSendFriendRequest: boolean;
  friendRequestIcon: string;
  friendRequestLabel: string;
  friendRequestAriaLabel: string;
  liveStatus: string;
}

const DEFAULT_PROFILE_PHOTO_URL = 'assets/imagem-padrao.webp';

const RELATIONSHIP_INTENT_LABELS: Readonly<Record<string, string>> = {
  friendship: 'Amizade',
  casual: 'Encontros casuais',
  dating: 'Conhecer pessoas',
  serious: 'Relacionamento sério',
  open_relationship: 'Relacionamento aberto',
  polyamory: 'Poliamor',
  swing: 'Swing',
  fetish_exploration: 'Explorar fetiches',
};

const SEXUAL_PRACTICE_LABELS: Readonly<Record<string, string>> = {
  vanilla: 'Sexo convencional',
  bdsm: 'BDSM',
  voyeurism: 'Voyeurismo',
  exhibitionism: 'Exibicionismo',
  swing: 'Swing',
  menage: 'Ménage',
  group_sex: 'Sexo em grupo',
  roleplay: 'Fantasias e personagens',
  tantra: 'Tantra',
  dom_sub: 'Dominação e submissão',
  outdoor: 'Ao ar livre',
  fetishes: 'Fetiches',
  edge_play: 'Práticas intensas',
  shibari: 'Shibari',
  cuckold: 'Cuckold',
  pegging: 'Pegging',
  sensory_play: 'Experiências sensoriais',
  dirty_talk: 'Dirty talk',
};

const BODY_TRAIT_LABELS: Readonly<Record<string, string>> = {
  athletic: 'Atlético',
  plus_size: 'Plus size',
  tattoos: 'Tatuagens',
  piercings: 'Piercings',
  beard: 'Barba',
  long_hair: 'Cabelos longos',
  curly_hair: 'Cabelos cacheados',
  light_eyes: 'Olhos claros',
  muscular: 'Musculoso',
  slim: 'Magro',
  curvy: 'Curvilíneo',
};

@Component({
  selector: 'app-other-user-profile-view',
  templateUrl: './other-user-profile-view.component.html',
  styleUrls: ['./other-user-profile-view.component.css'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    SharedModule,
    ProfileMediaShowcaseComponent,
    SocialLinksAccordionComponent,
  ],
})
export class OtherUserProfileViewComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);
  private readonly viewedProfileUid$ = new BehaviorSubject<string | null>(null);

  readonly friendshipInteractionState$: Observable<FriendshipInteractionState>;

  uid: string | null = null;
  userProfile: IUserDados | null = null;
  isLoading = true;
  profilePhotoFailed = false;

  readonly friendRequestBusy$ = new BehaviorSubject<boolean>(false);
  readonly directChatBusy$ = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly publicProfileView: PublicProfileViewService,
    private readonly authSession: AuthSessionService,
    private readonly friendshipService: FriendshipService,
    private readonly directChatService: DirectChatService,
    private readonly cdr: ChangeDetectorRef,
    private readonly globalErrorHandler: GlobalErrorHandlerService,
    private readonly errorNotification: ErrorNotificationService
  ) {
    this.friendshipInteractionState$ = this.buildFriendshipInteractionStateStream();
  }

  ngOnInit(): void {
    this.uid = this.getUidFromRoute();

    if (!this.uid) {
      this.reportError('UID não encontrado na rota.', {
        op: 'ngOnInit',
      });

      this.isLoading = false;
      this.markView();
      return;
    }

    this.authSession.uid$
      .pipe(
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((authUid) => {
        const safeAuthUid = (authUid ?? '').trim();
        const targetUid = (this.uid ?? '').trim();

        if (safeAuthUid && targetUid && safeAuthUid === targetUid) {
          this.debug('own profile opened here; redirecting to /perfil', {
            hasUid: true,
          });

          this.isLoading = false;
          this.markView();

          this.router.navigate(['/perfil'], { replaceUrl: true }).catch((error) => {
            this.reportError(
              'Não foi possível redirecionar para seu perfil.',
              { op: 'redirectOwnProfile' },
              error
            );
          });

          return;
        }

        this.viewedProfileUid$.next(targetUid);
        this.loadUserProfile(targetUid);
      });
  }

  ngOnDestroy(): void {
    this.viewedProfileUid$.complete();
    this.friendRequestBusy$.complete();
    this.directChatBusy$.complete();
  }

  get hasLocation(): boolean {
    return (
      !!this.userProfile?.municipio?.trim() &&
      !!this.userProfile?.estado?.trim()
    );
  }

  get hasDescription(): boolean {
    return !!this.userProfile?.descricao?.trim();
  }

  get displayName(): string {
    return this.userProfile?.nickname?.trim() || 'Perfil de usuário';
  }

  get profilePhotoUrl(): string {
    const photoUrl = this.userProfile?.photoURL?.trim() ?? '';

    return !this.profilePhotoFailed && photoUrl
      ? photoUrl
      : DEFAULT_PROFILE_PHOTO_URL;
  }

  get discoveryLink(): any[] {
    return ['/dashboard/explorar'];
  }

  get profileAge(): number | null {
    const value = this.userProfile?.idade ?? this.userProfile?.age;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : null;
  }

  get distanceLabel(): string | null {
    const distance = this.userProfile?.distanciaKm;

    if (typeof distance !== 'number' || !Number.isFinite(distance)) {
      return null;
    }

    if (distance < 1) {
      return 'Menos de 1 km';
    }

    return `${Math.round(distance)} km`;
  }

  get memberSinceLabel(): string | null {
    const createdAt = this.userProfile?.createdAt;

    if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
      return null;
    }

    const year = new Date(createdAt).getFullYear();
    return year >= 2000 ? `Desde ${year}` : null;
  }

  get orientationLabel(): string | null {
    const orientation = this.userProfile?.orientation?.trim();
    if (orientation) {
      return this.toDisplayLabel(orientation);
    }

    const partner1 = this.userProfile?.partner1Orientation?.trim();
    const partner2 = this.userProfile?.partner2Orientation?.trim();
    const labels = [partner1, partner2]
      .filter((value): value is string => !!value)
      .map((value) => this.toDisplayLabel(value));

    return labels.length > 0 ? labels.join(' / ') : null;
  }

  get hasPreferenceChips(): boolean {
    return this.preferenceChips.length > 0;
  }

  get preferenceChips(): string[] {
    return this.toUniqueLabels(this.userProfile?.preferences ?? []).slice(0, 12);
  }

  get relationshipIntentChips(): string[] {
    if (this.userProfile?.preferenceBadgesVisible !== true) {
      return [];
    }

    return this.toMappedLabels(
      this.userProfile.publicRelationshipIntents,
      RELATIONSHIP_INTENT_LABELS
    );
  }

  get sexualPracticeChips(): string[] {
    if (this.userProfile?.preferenceBadgesVisible !== true) {
      return [];
    }

    return this.toMappedLabels(
      this.userProfile.publicSexualPractices,
      SEXUAL_PRACTICE_LABELS
    );
  }

  get bodyTraitChips(): string[] {
    if (this.userProfile?.preferenceBadgesVisible !== true) {
      return [];
    }

    return this.toMappedLabels(
      this.userProfile.publicBodyTraits,
      BODY_TRAIT_LABELS
    );
  }

  get hasProfileDetails(): boolean {
    return (
      this.hasPreferenceChips ||
      this.relationshipIntentChips.length > 0 ||
      this.sexualPracticeChips.length > 0 ||
      this.bodyTraitChips.length > 0
    );
  }

  onProfilePhotoError(): void {
    if (this.profilePhotoFailed) {
      return;
    }

    this.profilePhotoFailed = true;
    this.debug('profile photo failed; using local fallback', {
      hasConfiguredPhoto: !!this.userProfile?.photoURL,
    });
    this.markView();
  }

  loadUserProfile(uid: string): void {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      this.reportError('UID inválido para carregar perfil.', {
        op: 'loadUserProfile',
      });

      this.isLoading = false;
      this.markView();
      return;
    }

    this.isLoading = true;
    this.profilePhotoFailed = false;
    this.markView();

    this.debug('loadUserProfile start', {
      hasUid: true,
    });

    this.publicProfileView
      .watchProfile$(safeUid)
      .pipe(
        catchError((error: unknown) => {
          this.reportError(
            'Falha ao carregar perfil do usuário.',
            {
              op: 'loadUserProfile',
              hasUid: true,
            },
            error
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((profile: IUserDados | null) => {
        this.isLoading = false;

        if (!profile) {
          this.userProfile = null;

          this.reportError('Usuário não encontrado ou indisponível.', {
            op: 'loadUserProfile.empty',
            hasUid: true,
          });

          this.markView();
          return;
        }

        this.profilePhotoFailed = false;
        this.userProfile = {
          ...profile,
          preferences: Array.isArray(profile.preferences)
            ? profile.preferences
            : [],
        };

        this.debug('loadUserProfile success', {
          hasProfile: true,
          hasNickname: !!this.userProfile.nickname,
          hasPhoto: !!this.userProfile.photoURL,
          hasDescription: this.hasDescription,
          hasDistance: !!this.distanceLabel,
          publicDetailChipCount:
            this.preferenceChips.length +
            this.relationshipIntentChips.length +
            this.sexualPracticeChips.length +
            this.bodyTraitChips.length,
        });

        this.markView();
      });
  }

  sendFriendRequest(): void {
    const targetUid = (this.uid ?? '').trim();

    if (!targetUid || this.friendRequestBusy$.value) {
      return;
    }

    this.friendRequestBusy$.next(true);

    combineLatest([
      this.authSession.uid$.pipe(take(1)),
      this.friendshipInteractionState$.pipe(take(1)),
    ])
      .pipe(
        switchMap(([requesterUid, interactionState]) => {
          const safeRequesterUid = (requesterUid ?? '').trim();

          if (!safeRequesterUid) {
            return throwError(
              () => new Error('Sessão não identificada para demonstrar interesse.')
            );
          }

          if (safeRequesterUid === targetUid) {
            return throwError(
              () => new Error('Você não pode demonstrar interesse no próprio perfil.')
            );
          }

          if (!interactionState.canSendFriendRequest) {
            return throwError(() => new Error(interactionState.liveStatus));
          }

          return this.friendshipService.sendRequest(
            safeRequesterUid,
            targetUid,
            'Olá! Gostaria de conhecer você.'
          );
        }),
        finalize(() => {
          this.friendRequestBusy$.next(false);
          this.markView();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível enviar o interesse.',
            {
              op: 'sendFriendRequest',
              hasTargetUid: !!targetUid,
            },
            error
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (result === null) {
          return;
        }

        this.errorNotification.showSuccess('Interesse enviado.');
      });
  }

  startDirectChat(): void {
    const targetUid = (this.uid ?? '').trim();

    if (!targetUid || this.directChatBusy$.value) {
      return;
    }

    this.directChatBusy$.next(true);

    this.directChatService
      .ensureDirectChatIdWithUser$(targetUid)
      .pipe(
        take(1),
        finalize(() => {
          this.directChatBusy$.next(false);
          this.markView();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível preparar a conversa.',
            {
              op: 'startDirectChat',
              hasTargetUid: !!targetUid,
            },
            error
          );

          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((chatId) => {
        if (!chatId) {
          return;
        }

        this.errorNotification.showSuccess(
          'Conversa disponível. Abrindo área de chats.'
        );

        this.router
          .navigate(['/chat'], {
            queryParams: {
              openChatId: chatId,
              withUser: targetUid,
            },
          })
          .catch((error) => {
            this.reportError(
              'A conversa foi aberta, mas a navegação para chats falhou.',
              {
                op: 'navigateToChat',
                hasChatId: !!chatId,
                hasTargetUid: !!targetUid,
              },
              error
            );
          });
      });
  }

  private buildFriendshipInteractionStateStream(): Observable<FriendshipInteractionState> {
    return combineLatest([
      this.authSession.uid$.pipe(
        map((uid) => (uid ?? '').trim()),
        distinctUntilChanged()
      ),
      this.viewedProfileUid$.pipe(
        map((uid) => (uid ?? '').trim()),
        distinctUntilChanged()
      ),
    ]).pipe(
      switchMap(([viewerUid, targetUid]) => {
        if (!viewerUid || !targetUid || viewerUid === targetUid) {
          return of(this.buildFriendshipInteractionState(targetUid, [], []));
        }

        return combineLatest([
          this.friendshipService.watchOutboundRequests(viewerUid).pipe(
            catchError((error) => {
              this.reportError(
                'Não foi possível verificar interesses enviados.',
                {
                  op: 'friendshipInteractionState.outbound',
                  hasTargetUid: !!targetUid,
                },
                error
              );

              return of([] as FriendRequest[]);
            })
          ),
          this.friendshipService.watchFriends(viewerUid).pipe(
            catchError((error) => {
              this.reportError(
                'Não foi possível verificar suas conexões.',
                {
                  op: 'friendshipInteractionState.friends',
                  hasTargetUid: !!targetUid,
                },
                error
              );

              return of([] as Friend[]);
            })
          ),
        ]).pipe(
          map(([outboundRequests, friends]) =>
            this.buildFriendshipInteractionState(
              targetUid,
              outboundRequests,
              friends
            )
          )
        );
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private buildFriendshipInteractionState(
    targetUid: string,
    outboundRequests: FriendRequest[],
    friends: Friend[]
  ): FriendshipInteractionState {
    const safeTargetUid = (targetUid ?? '').trim();
    const isFriend = friends.some(
      (friend) => friend.friendUid === safeTargetUid
    );
    const hasPendingOutboundRequest = outboundRequests.some(
      (request) =>
        request.targetUid === safeTargetUid && request.status === 'pending'
    );

    if (isFriend) {
      return {
        isFriend: true,
        canSendFriendRequest: false,
        friendRequestIcon: 'fas fa-user-check',
        friendRequestLabel: 'Conectados',
        friendRequestAriaLabel: `${this.displayName} já está conectado com você.`,
        liveStatus: 'Vocês estão conectados. O chat está disponível.',
      };
    }

    if (hasPendingOutboundRequest) {
      return {
        isFriend: false,
        canSendFriendRequest: false,
        friendRequestIcon: 'fas fa-clock',
        friendRequestLabel: 'Interesse enviado',
        friendRequestAriaLabel: `Interesse em ${this.displayName} já enviado.`,
        liveStatus: 'Interesse enviado. Aguarde a resposta do perfil.',
      };
    }

    return {
      isFriend: false,
      canSendFriendRequest: !!safeTargetUid,
      friendRequestIcon: 'fas fa-heart',
      friendRequestLabel: 'Mostrar interesse',
      friendRequestAriaLabel: `Mostrar interesse em ${this.displayName}`,
      liveStatus: 'Você pode demonstrar interesse neste perfil.',
    };
  }

  private getUidFromRoute(): string | null {
    const uid =
      this.route.snapshot.paramMap.get('uid') ??
      this.route.snapshot.paramMap.get('id');

    return uid?.trim() || null;
  }

  private toMappedLabels(
    values: readonly string[] | null | undefined,
    labels: Readonly<Record<string, string>>
  ): string[] {
    return this.toUniqueLabels(values).map(
      (value) => labels[value.toLowerCase()] ?? this.toDisplayLabel(value)
    );
  }

  private toUniqueLabels(
    values: readonly string[] | null | undefined
  ): string[] {
    return Array.from(
      new Set(
        (values ?? [])
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
      )
    );
  }

  private toDisplayLabel(value: string): string {
    const normalized = String(value ?? '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return normalized
      ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
      : '';
  }

  private markView(): void {
    this.cdr.markForCheck();
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log(
      'profile',
      `OtherUserProfileView: ${message}`,
      extra
    );
  }

  private reportError(
    message: string,
    extra?: Record<string, unknown>,
    cause?: unknown
  ): void {
    const err = new Error(message);

    (err as any).context = {
      scope: 'OtherUserProfileViewComponent',
      hasUid: !!this.uid,
      ...(extra ?? {}),
    };

    if (cause !== undefined) {
      (err as any).cause = cause;
      (err as any).original = cause;
    }

    (err as any).skipUserNotification = true;

    try {
      this.globalErrorHandler.handleError(err);
    } catch {
      // noop
    }

    try {
      this.errorNotification.showError(message);
    } catch {
      // noop
    }
  }
}
