// src/app/chat-module/invite-list/invite-list.component.ts
// Lista de convites do usuário autenticado.
//
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica do UID
// - consome o store sem ser owner do inbox
// - centraliza tratamento de erro
// - mantém nomenclaturas públicas (respondToInvite)
// - o owner global de LoadInvites / StopInvites agora fica no LayoutShellComponent
// - fecha o fluxo real de aceitar/recusar
import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import {
  AcceptInvite,
  DeclineInvite,
} from 'src/app/store/actions/actions.chat/invite.actions';
import {
  selectInvitesError,
  selectInvitesLoading,
  selectPendingInvites,
  selectPendingInvitesCount,
} from 'src/app/store/selectors/selectors.chat/invite.selectors';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Component({
  selector: 'app-invite-list',
  templateUrl: './invite-list.component.html',
  styleUrls: ['./invite-list.component.css'],
  standalone: false
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

  readonly invites$: Observable<Invite[]> =
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
        map((uid) => (uid ?? '').trim() || null),
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

  respondToInvite(invite: Invite, status: 'accepted' | 'declined'): void {
    if (!this.userId || !invite?.id) {
      this.errorNotifier.showError('Erro ao processar resposta ao convite.');
      return;
    }

    if (status === 'accepted') {
      this.store.dispatch(AcceptInvite({ inviteId: invite.id }));
      return;
    }

    this.store.dispatch(DeclineInvite({ inviteId: invite.id }));
  }

  trackByInviteId = (_: number, invite: Invite): string =>
    invite.id ?? `${invite.receiverId ?? 'unknown'}-${invite.targetId ?? invite.roomId ?? 'unknown'}`;

  getInviteTitle(invite: Invite): string {
    return (
      invite.targetName?.trim() ||
      invite.roomName?.trim() ||
      'Convite'
    );
  }

  getInviteSubtitle(invite: Invite): string {
    return (
      invite.senderId?.trim() ||
      invite.receiverId?.trim() ||
      'Usuário não identificado'
    );
  }

  formatInviteDate(value: unknown): string | null {
    if (!value) return null;

    if (value instanceof Date) {
      return value.toLocaleString('pt-BR');
    }

    if (typeof value === 'number') {
      return new Date(value).toLocaleString('pt-BR');
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('pt-BR');
    }

    if (typeof value === 'object' && value !== null) {
      const maybeTimestamp = value as { toDate?: () => Date };
      if (typeof maybeTimestamp.toDate === 'function') {
        return maybeTimestamp.toDate().toLocaleString('pt-BR');
      }
    }

    return null;
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
        ...(context ?? {})
      };
      (err as any).skipUserNotification = true;
      this.globalError.handleError(err);
    } catch {
      // noop
    }
  }
} // Linha 178