// src/app/chat-module/invite-list/invite-list.component.ts
// Lista de convites do usuário autenticado.
//
// Ajustes desta versão:
// - usa AuthSessionService como fonte canônica do UID
// - evita subscriptions sem teardown
// - centraliza tratamento de erro
// - mantém nomenclaturas públicas (loadInvites / respondToInvite)
// - envia StopInvites() quando a sessão some ou quando o componente é destruído,
//   para garantir que o listener realtime do effect seja desligado
import { Component, DestroyRef, OnDestroy, OnInit, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import { catchError, distinctUntilChanged, map, tap } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AppState } from 'src/app/store/states/app.state';
import { Invite } from 'src/app/core/interfaces/interfaces-chat/invite.interface';
import {
  LoadInvites,
  StopInvites,
} from 'src/app/store/actions/actions.chat/invite.actions';
import { selectInvites } from 'src/app/store/selectors/selectors.chat/invite.selectors';

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

  invites: Invite[] = [];
  userId: string | null = null;

  constructor(
    private readonly authSession: AuthSessionService,
    private readonly store: Store<AppState>,
    private readonly errorNotifier: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {}

  ngOnInit(): void {
    this.observeAuthenticatedUid();
    this.observeInvitesState();
  }

  ngOnDestroy(): void {
    /**
     * Importante:
     * - takeUntilDestroyed() desmonta as subscriptions do componente
     * - mas o inbox realtime vive no effect
     * - por isso precisamos sinalizar parada explícita da feature
     */
    this.store.dispatch(StopInvites());
    this.invites = [];
    this.userId = null;
  }

  /**
   * Observa o UID autenticado.
   * - Quando existe UID, carrega convites.
   * - Quando não existe, dispara StopInvites e limpa o estado local sem toast agressivo.
   */
  private observeAuthenticatedUid(): void {
    this.authSession.uid$
      .pipe(
        map((uid) => (uid ?? '').trim() || null),
        distinctUntilChanged(),
        tap((uid) => {
          this.userId = uid;

          if (uid) {
            this.loadInvites(uid);
            return;
          }

          /**
           * Sessão terminou / uid sumiu:
           * - para o inbox realtime da feature
           * - limpa estado local do componente
           */
          this.store.dispatch(StopInvites());
          this.invites = [];
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao carregar dados da sessão do usuário.',
            error,
            { op: 'observeAuthenticatedUid' }
          );

          this.store.dispatch(StopInvites());
          this.userId = null;
          this.invites = [];
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  /**
   * Observa a lista de convites no store.
   */
  private observeInvitesState(): void {
    this.store.select(selectInvites)
      .pipe(
        tap((invites) => {
          this.invites = Array.isArray(invites) ? invites : [];
          console.log('Convites carregados:', this.invites);
        }),
        catchError((error) => {
          this.reportError(
            'Erro ao carregar convites do estado.',
            error,
            { op: 'observeInvitesState' }
          );

          this.invites = [];
          return of([]);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  loadInvites(userId: string): void {
    const uid = (userId ?? '').trim();
    if (!uid) return;

    this.store.dispatch(LoadInvites({ userId: uid }));
  }

  respondToInvite(invite: Invite, status: 'accepted' | 'declined'): void {
    if (!this.userId || !invite.id) {
      this.errorNotifier.showError('Erro ao processar resposta ao convite.');
      return;
    }

    // Mantido como placeholder porque a implementação da action/effect
    // de resposta não foi incluída neste trecho.
  }

  /**
   * Tratamento centralizado de erros.
   */
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
} // Linha 177