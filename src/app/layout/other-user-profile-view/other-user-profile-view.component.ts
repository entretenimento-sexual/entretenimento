// src/app/layout/other-user-profile-view/other-user-profile-view.component.ts
// Não esquecer dos comentários explicativos e ferramentas de debug
//
// Ajustes desta versão:
// - mantém leitura do perfil público
// - adiciona ações REAIS para amizade e preparo de chat direto
// - remove falso CTA de convite direto por perfil
// - mantém navegação útil para fotos e inbox de convites
//
// Supressão explícita:
// - NÃO existe mais botão de "enviar convite para este perfil"
// - motivo: InviteService atual é orientado a convites de sala, não perfil-a-perfil

import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { SharedModule } from "../../shared/shared.module";
import { BehaviorSubject, catchError, finalize, of, switchMap, take, throwError } from 'rxjs';

import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { SocialLinksAccordionComponent } from 'src/app/user-profile/user-profile-view/user-social-links-accordion/user-social-links-accordion.component';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { ChatService } from 'src/app/core/services/batepapo/chat-service/chat.service';

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
  ]
})
export class OtherUserProfileViewComponent implements OnInit {
  uid: string | null = null;
  userProfile: IUserDados | null = null;

  categoriasDePreferencias = {
    genero: [] as string[],
    praticaSexual: [] as string[],
  };

  isLoading = true;

  readonly friendRequestBusy$ = new BehaviorSubject<boolean>(false);
  readonly directChatBusy$ = new BehaviorSubject<boolean>(false);

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private firestoreUserQuery: FirestoreUserQueryService,
    private authSession: AuthSessionService,
    private friendshipService: FriendshipService,
    private chatService: ChatService,
    private cdr: ChangeDetectorRef,
    private globalErrorHandler: GlobalErrorHandlerService,
    private errorNotification: ErrorNotificationService
  ) { }

  ngOnInit(): void {
    this.uid = (this.route.snapshot.paramMap.get('uid') ?? this.route.snapshot.paramMap.get('id'))?.trim() ?? null;

    if (!this.uid) {
      this.reportError('UID não encontrado na rota.', { routeParams: this.route.snapshot.params });
      this.isLoading = false;
      return;
    }

    this.loadUserProfile(this.uid);
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
    return ['/dashboard/online'];
  }

  get photosLink(): any[] | null {
    return this.uid ? ['/perfil', this.uid, 'fotos'] : null;
  }

  get invitesLink(): any[] {
    return ['/chat/invite-list'];
  }

  private reportError(message: string, extra?: Record<string, unknown>, cause?: unknown): void {
    const err = new Error(message);

    (err as any).context = 'OtherUserProfileViewComponent';
    (err as any).extra = { uid: this.uid, ...extra };
    if (cause !== undefined) (err as any).cause = cause;

    this.globalErrorHandler.handleError(err);
    this.errorNotification?.showError?.(message);
  }

  loadUserProfile(uid: string): void {
    this.isLoading = true;

    this.firestoreUserQuery.getPublicUserById$(uid)
      .pipe(
        catchError((error: unknown) => {
          this.reportError('Falha ao carregar perfil público do usuário.', { uid }, error);
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        })
      )
      .subscribe((profile: IUserDados | null) => {
        if (!profile) {
          this.reportError('Usuário não encontrado.', { uid });
          this.userProfile = null;
          return;
        }

        this.userProfile = {
          ...profile,
          preferences: Array.isArray(profile.preferences) ? profile.preferences : [],
        };

        this.cdr.detectChanges();
      });
  }

  /**
   * Ação REAL:
   * envia solicitação de amizade usando FriendshipService.
   */
  sendFriendRequest(): void {
    const targetUid = (this.uid ?? '').trim();
    if (!targetUid || this.friendRequestBusy$.value) return;

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
          this.cdr.detectChanges();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível enviar a solicitação de amizade.',
            { op: 'sendFriendRequest', targetUid },
            error
          );
          return of(null);
        })
      )
      .subscribe((result) => {
        if (result === null) return;
        this.errorNotification.showSuccess('Solicitação de amizade enviada.');
      });
  }

  /**
   * Ação REAL:
   * cria ou reutiliza um chat 1:1.
   *
   * Observação honesta:
   * - a conversa é preparada de verdade;
   * - a navegação segue para /chat, que é a área operacional atual do módulo.
   */
  startDirectChat(): void {
    const targetUid = (this.uid ?? '').trim();
    if (!targetUid || this.directChatBusy$.value) return;

    this.directChatBusy$.next(true);

    this.authSession.uid$
      .pipe(
        take(1),
        switchMap((loggedUid) => {
          const safeLoggedUid = (loggedUid ?? '').trim();

          if (!safeLoggedUid) {
            return throwError(() => new Error('Sessão não identificada para iniciar chat.'));
          }

          if (safeLoggedUid === targetUid) {
            return throwError(() => new Error('Você não pode iniciar um chat com seu próprio perfil.'));
          }

          return this.chatService.getOrCreateChatId([safeLoggedUid, targetUid]);
        }),
        finalize(() => {
          this.directChatBusy$.next(false);
          this.cdr.detectChanges();
        }),
        catchError((error) => {
          this.reportError(
            'Não foi possível preparar a conversa.',
            { op: 'startDirectChat', targetUid },
            error
          );
          return of(null);
        })
      )
      .subscribe((chatId) => {
        if (!chatId) return;

        this.chatService.refreshParticipantDetailsIfNeeded(chatId);
        this.errorNotification.showSuccess('Conversa preparada. Abrindo área de chats.');

        this.router.navigate(['/chat'], {
          queryParams: {
            openChatId: chatId,
            withUser: targetUid,
          },
        }).catch((error) => {
          this.reportError(
            'A conversa foi criada, mas a navegação para chats falhou.',
            { op: 'navigateToChat', chatId, targetUid },
            error
          );
        });
      });
  }
} // Linha 260