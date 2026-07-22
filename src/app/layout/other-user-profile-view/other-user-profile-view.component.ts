// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL VISITADO
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - Exibir outro usuário como vitrine de descoberta.
// - Priorizar mídia pública, identidade, afinidades e interação.
// - Consumir somente a projeção pública moderada.
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
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
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

  readonly friendRequestBusy$ = new BehaviorSubject<boolean>(false);
  readonly directChatBusy$ = new BehaviorSubject<boolean>(false);

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly firestoreUserQuery: FirestoreUserQueryService,
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

  get discoveryLink(): any[] {
    return ['/dashboard/explorar'];
  }

  get hasPreferenceChips(): boolean {
    return this.preferenceChips.length > 0;
  }

  get preferenceChips(): string[] {
    return (this.userProfile?.preferences ?? [])
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 8);
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
    this.markView();

    this.debug('loadUserProfile start', {
      hasUid: true,
    });

    this.firestoreUserQuery
      .getPublicUserById$(safeUid)
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
        finalize(() => {
          this.isLoading = false;
          this.markView();
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((profile: IUserDados | null) => {
        if (!profile) {
          this.userProfile = null;

          this.reportError('Usuário não encontrado ou indisponível.', {
            op: 'loadUserProfile.empty',
            hasUid: true,
          });

          this.markView();
          return;
        }

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
