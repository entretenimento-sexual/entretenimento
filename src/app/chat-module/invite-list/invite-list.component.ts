// src/app/chat-module/invite-list/invite-list.component.ts
// Convites legados de Sala.
// - novos convites e aceite foram descontinuados;
// - a lista permanece para o destinatário recusar/limpar convites persistidos;
// - Store continua sendo a projeção global do inbox.
import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, tap } from 'rxjs/operators';

import { InviteInboxItem } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { DeclineInvite } from 'src/app/store/actions/actions.chat/invite.actions';
import {
  selectInvitesError,
  selectInvitesLoading,
  selectPendingInvites,
  selectPendingInvitesCount,
} from 'src/app/store/selectors/selectors.chat/invite.selectors';
import { AppState } from 'src/app/store/states/app.state';

@Component({
  selector: 'app-invite-list',
  templateUrl: './invite-list.component.html',
  styleUrls: ['./invite-list.component.css', './invite-list.clean.css'],
  standalone: false,
})
export class InviteListComponent implements OnInit, OnDestroy {
  private readonly destroyRef = inject(DestroyRef);

  userId: string | null = null;

  readonly pendingCount$: Observable<number> =
    this.store.select(selectPendingInvitesCount);
  readonly loading$: Observable<boolean> =
    this.store.select(selectInvitesLoading);
  readonly error$: Observable<string | null> =
    this.store.select(selectInvitesError);
  readonly invites$: Observable<readonly InviteInboxItem[]> =
    this.store.select(selectPendingInvites);

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly store: Store<AppState>,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  ngOnInit(): void {
    this.observeAuthenticatedUid();
  }

  ngOnDestroy(): void {
    this.userId = null;
  }

  private observeAuthenticatedUid(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => String(uid ?? '').trim() || null),
        distinctUntilChanged(),
        tap((uid) => {
          this.userId = uid;
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao carregar dados da sessão do usuário.',
            error,
            { op: 'observeAuthenticatedUid' }
          );
          this.userId = null;
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /**
   * Método preservado para compatibilidade de chamadas existentes.
   * Aceite é explicitamente bloqueado; apenas recusa continua operacional.
   */
  respondToInvite(
    invite: InviteInboxItem,
    status: 'accepted' | 'declined'
  ): void {
    const ownerUid = String(this.userId ?? '').trim();
    const inviteId = String(invite?.id ?? '').trim();
    const receiverId = String(invite?.receiverId ?? '').trim();

    if (!ownerUid || !inviteId || receiverId !== ownerUid) {
      this.errorNotifier.showError('Erro ao processar resposta ao convite.');
      return;
    }

    if (status === 'accepted') {
      this.errorNotifier.showInfo(
        'Salas foram descontinuadas. Use Comunidades para interações coletivas.'
      );
      return;
    }

    this.store.dispatch(DeclineInvite({ ownerUid, inviteId }));
  }

  trackByInviteId = (_: number, invite: InviteInboxItem): string => invite.id;

  getInviteTitle(invite: InviteInboxItem): string {
    return invite.targetName?.trim() || invite.roomName?.trim() || 'Convite de sala antigo';
  }

  getInviteSubtitle(_invite: InviteInboxItem): string {
    return 'Convite legado — não é mais possível aceitar';
  }

  formatInviteDate(value: number | null | undefined): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return new Date(value).toLocaleString('pt-BR');
  }

  private reportError(
    userMessage: string,
    error: unknown,
    context?: Record<string, unknown>
  ): void {
    try {
      this.errorNotifier.showError(userMessage);
    } catch {
      // noop
    }

    try {
      const err = error instanceof Error ? error : new Error(userMessage);
      (err as any).original = error;
      (err as any).context = {
        scope: 'InviteListComponent',
        ...(context ?? {}),
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
}
