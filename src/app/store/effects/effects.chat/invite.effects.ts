// src/app/store/effects/effects.chat/invite.effects.ts
// Owner global do inbox de convites para salas e das respostas via Cloud Functions.
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { EMPTY, merge, of } from 'rxjs';
import {
  catchError,
  concatMap,
  distinctUntilChanged,
  filter,
  map,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { InviteInboxService } from '@core/services/batepapo/invite-service/invite-inbox.service';
import { RoomInviteFlowService } from '@core/services/batepapo/room-services/room-invite-flow.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';

import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { authSessionChanged } from '../../actions/actions.user/auth.actions';

@Injectable()
export class InviteEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly inbox: InviteInboxService,
    private readonly roomInviteFlow: RoomInviteFlowService,
    private readonly authSession: AuthSessionService,
    private readonly notifier: ErrorNotificationService
  ) {}

  private readonly stopInvitesManual$ = this.actions$.pipe(
    ofType(InviteActions.StopInvites)
  );

  private readonly sessionUidChanged$ = this.actions$.pipe(
    ofType(authSessionChanged),
    map(({ uid }) => this.normalizeUid(uid)),
    distinctUntilChanged()
  );

  /**
   * Backstop canônico de sessão.
   *
   * O LayoutShell ainda dispara Load/Stop por compatibilidade, mas este effect
   * garante que authSessionChanged sempre produza um novo escopo após o
   * meta-reducer limpar dados vinculados ao UID anterior.
   */
  syncInvitesWithSession$ = createEffect(() =>
    this.sessionUidChanged$.pipe(
      map((uid) =>
        uid
          ? InviteActions.LoadInvites({ userId: uid })
          : InviteActions.StopInvites()
      )
    )
  );

  /** Cache nunca atravessa uma fronteira de sessão. */
  clearInviteCacheOnBoundary$ = createEffect(
    () =>
      merge(this.stopInvitesManual$, this.sessionUidChanged$).pipe(
        tap(() => this.inbox.clearAllCache())
      ),
    { dispatch: false }
  );

  /**
   * Listener realtime escopado pelo UID proprietário.
   *
   * SUPRESSÃO EXPLÍCITA:
   * - o effect não consome mais o inbox genérico de todos os tipos;
   * - somente convites `room` ou documentos legados com roomId entram na Store;
   * - solicitações de conexão e futuros convites comunitários permanecem fora.
   *
   * A troca A -> B encerra A mesmo antes de um eventual novo LoadInvites de B.
   * O reducer também limpa a lista imediatamente ao receber a nova carga.
   */
  loadInvites$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.LoadInvites),
      switchMap(({ userId }) => {
        const ownerUid = this.normalizeUid(userId);

        if (!ownerUid) {
          return of(
            InviteActions.LoadInvitesFailure({
              ownerUid: '',
              error: 'Sessão inválida para carregar convites para salas.',
            })
          );
        }

        const stopForOwner$ = merge(
          this.stopInvitesManual$,
          this.sessionUidChanged$.pipe(
            filter((currentUid) => currentUid !== ownerUid)
          )
        );

        return this.inbox.observeMyPendingRoomInvites(ownerUid).pipe(
          takeUntil(stopForOwner$),
          map((invites) =>
            InviteActions.LoadInvitesSuccess({ ownerUid, invites })
          ),
          catchError((error) =>
            of(
              InviteActions.LoadInvitesFailure({
                ownerUid,
                error: this.errorMessage(
                  error,
                  'Não foi possível carregar seus convites para salas.'
                ),
              })
            )
          )
        );
      })
    )
  );

  clearInvitesOnManualStop$ = createEffect(() =>
    this.stopInvitesManual$.pipe(
      map(() => InviteActions.ClearInvitesState())
    )
  );

  acceptInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.AcceptInvite),
      concatMap(({ ownerUid, inviteId }) => {
        const safeOwnerUid = this.normalizeUid(ownerUid);
        const safeInviteId = String(inviteId ?? '').trim();

        if (!safeOwnerUid || !safeInviteId) {
          return of(
            InviteActions.AcceptInviteFailure({
              ownerUid: safeOwnerUid,
              inviteId: safeInviteId,
              error: 'Convite para sala inválido.',
            })
          );
        }

        return this.roomInviteFlow.acceptRoomInvite$(safeInviteId).pipe(
          switchMap(() =>
            this.authSession.uid$.pipe(
              take(1),
              switchMap((currentUid) => {
                if (this.normalizeUid(currentUid) !== safeOwnerUid) {
                  return EMPTY;
                }

                this.notifier.showSuccess(
                  'Convite aceito. A sala já está disponível.'
                );
                return of(
                  InviteActions.AcceptInviteSuccess({
                    ownerUid: safeOwnerUid,
                    inviteId: safeInviteId,
                  })
                );
              })
            )
          ),
          catchError((error) =>
            this.responseFailureForCurrentSession$(
              'accepted',
              safeOwnerUid,
              safeInviteId,
              error
            )
          )
        );
      })
    )
  );

  declineInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.DeclineInvite),
      concatMap(({ ownerUid, inviteId }) => {
        const safeOwnerUid = this.normalizeUid(ownerUid);
        const safeInviteId = String(inviteId ?? '').trim();

        if (!safeOwnerUid || !safeInviteId) {
          return of(
            InviteActions.DeclineInviteFailure({
              ownerUid: safeOwnerUid,
              inviteId: safeInviteId,
              error: 'Convite para sala inválido.',
            })
          );
        }

        return this.roomInviteFlow.declineRoomInvite$(safeInviteId).pipe(
          switchMap(() =>
            this.authSession.uid$.pipe(
              take(1),
              switchMap((currentUid) => {
                if (this.normalizeUid(currentUid) !== safeOwnerUid) {
                  return EMPTY;
                }

                this.notifier.showSuccess('Convite para sala recusado.');
                return of(
                  InviteActions.DeclineInviteSuccess({
                    ownerUid: safeOwnerUid,
                    inviteId: safeInviteId,
                  })
                );
              })
            )
          ),
          catchError((error) =>
            this.responseFailureForCurrentSession$(
              'declined',
              safeOwnerUid,
              safeInviteId,
              error
            )
          )
        );
      })
    )
  );

  private responseFailureForCurrentSession$(
    decision: 'accepted' | 'declined',
    ownerUid: string,
    inviteId: string,
    error: unknown
  ) {
    return this.authSession.uid$.pipe(
      take(1),
      switchMap((currentUid) => {
        if (this.normalizeUid(currentUid) !== ownerUid) {
          return EMPTY;
        }

        const message = this.errorMessage(
          error,
          decision === 'accepted'
            ? 'Não foi possível aceitar o convite para sala.'
            : 'Não foi possível recusar o convite para sala.'
        );

        this.notifier.showError(message);

        return of(
          decision === 'accepted'
            ? InviteActions.AcceptInviteFailure({
                ownerUid,
                inviteId,
                error: message,
              })
            : InviteActions.DeclineInviteFailure({
                ownerUid,
                inviteId,
                error: message,
              })
        );
      })
    );
  }

  private normalizeUid(uid: string | null | undefined): string {
    return String(uid ?? '').trim();
  }

  private errorMessage(error: unknown, fallback: string): string {
    const code = String(
      (error as { code?: unknown } | null)?.code ?? ''
    ).toLowerCase();
    const rawMessage = String(
      (error as { message?: unknown } | null)?.message ?? ''
    ).trim();

    if (code.includes('unauthenticated')) {
      return 'Entre novamente para responder ao convite para sala.';
    }

    if (code.includes('permission-denied')) {
      return 'Sua conta não pode responder a este convite para sala.';
    }

    if (code.includes('failed-precondition')) {
      return rawMessage || 'Este convite para sala não está mais disponível.';
    }

    if (code.includes('not-found')) {
      return 'O convite ou a sala não foi encontrado.';
    }

    return rawMessage || fallback;
  }
}
