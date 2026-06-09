// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
// -----------------------------------------------------------------------------
// PERFIL ALHEIO / PERFIL PÚBLICO
// -----------------------------------------------------------------------------
//
// Este componente é o único responsável por exibir perfil de outro usuário.
//
// Regra definitiva:
// - Lê perfil público.
// - Não lê users/{uid} privado.
// - Não mostra edição de dados.
// - Não mostra edição de redes sociais.
// - Não usa UserPhotoManagerComponent.
// - Fotos de terceiro sempre usam /media/perfil/:id/fotos-publicas.
//
// Segurança:
// - amizade passa por FriendshipService;
// - chat direto passa por DirectChatService/callable;
// - fotos públicas passam pela camada public_photos já moderada.

import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, DestroyRef, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { BehaviorSubject, of, switchMap, take, throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SharedModule } from '../../shared/shared.module';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { DirectChatService } from 'src/app/messaging/direct-chat/services/direct-chat.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';

@Component({
  selector: 'app-other-user-profile-view',
  templateUrl: './other-user-profile-view.component.html',
  styleUrls: ['./other-user-profile-view.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    SharedModule,
    SocialLinksAccordionComponent,
  ],
})
export class OtherUserProfileViewComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly privacyDebug = inject(PrivacyDebugLoggerService);

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
  ) {}

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

        this.loadUserProfile(targetUid);
      });
  }

  get hasProfile(): boolean {
    return !!this.userProfile;
  }

  get hasLocation(): boolean {
    return !!this.userProfile?.municipio?.trim() && !!this.userProfile?.estado?.trim();
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

  get photosLink(): any[] | null {
    return this.uid ? ['/media', 'perfil', this.uid, 'fotos-publicas'] : null;
  }

  get invitesLink(): any[] {
    return ['/chat/invite-list'];
  }

  loadUserProfile(uid: string): void {
    const safeUid = (uid ?? '').trim();

    if (!safeUid) {
      this.reportError('UID inválido para carregar perfil público.', {
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

    this.firestoreUserQuery.getPublicUserById$(safeUid)
      .pipe(
        catchError((error: unknown) => {
          this.reportError(
            'Falha ao carregar perfil público do usuário.',
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
          preferences: Array.isArray(profile.preferences) ? profile.preferences : [],
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

    this.authSession.uid$
      .pipe(
        take(1),
        switchMap((requesterUid) => {
          const safeRequesterUid = (requesterUid ?? '').trim();

          if (!safeRequesterUid) {
            return throwError(() => new Error('Sessão não identificada para solicitar amizade.'));
          }

          if (safeRequesterUid === targetUid) {
            return throwError(() => new Error('Você não pode enviar solicitação para si mesmo.'));
          }

          return this.friendshipService.sendRequest(
            safeRequesterUid,
            targetUid,
            `Olá! Gostaria de adicionar ${this.displayName}.`
          );
        }),
        finalize(() => {
          this.friendRequestBusy$.next(false);
          this.markView();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível enviar a solicitação de amizade.',
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

        this.errorNotification.showSuccess('Solicitação de amizade enviada.');
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

        this.errorNotification.showSuccess('Conversa disponível. Abrindo área de chats.');

        this.router.navigate(['/chat'], {
          queryParams: {
            openChatId: chatId,
            withUser: targetUid,
          },
        }).catch((error) => {
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

  private getUidFromRoute(): string | null {
    const uid =
      this.route.snapshot.paramMap.get('uid') ??
      this.route.snapshot.paramMap.get('id');

    return uid?.trim() || null;
  }

  private markView(): void {
    try {
      this.cdr.detectChanges();
    } catch {
      // noop
    }
  }

  private debug(message: string, extra?: unknown): void {
    this.privacyDebug.log('profile', `OtherUserProfileView: ${message}`, extra);
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