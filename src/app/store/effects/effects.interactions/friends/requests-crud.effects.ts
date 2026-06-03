// src/app/store/effects/effects.interactions/friends/requests-crud.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';
import {
  catchError,
  concatMap,
  exhaustMap,
  filter,
  finalize,
  map,
  mergeMap,
  switchMap,
  withLatestFrom,
} from 'rxjs/operators';

import * as A from '../../../actions/actions.interactions/actions.friends';

import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AppState } from 'src/app/store/states/app.state';
import { selectCurrentUserUid } from 'src/app/store/selectors/selectors.user/user.selectors';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

@Injectable()
export class FriendsRequestsCrudEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store<AppState>);
  private readonly svc = inject(FriendshipService);
  private readonly notifier = inject(ErrorNotificationService);

  /**
   * Trava local por requestId.
   *
   * Motivo:
   * - impede múltiplos cancelamentos simultâneos da mesma solicitação;
   * - protege contra clique duplo/triplo antes do Angular aplicar [disabled];
   * - evita chamadas repetidas ao Firestore/Emulator para o mesmo documento.
   */
  private readonly cancelingRequestIds = new Set<string>();

  private tryLockCancelRequest(requestId: string): boolean {
    const safeId = String(requestId ?? '').trim();

    if (!safeId || this.cancelingRequestIds.has(safeId)) {
      return false;
    }

    this.cancelingRequestIds.add(safeId);
    return true;
  }

  private unlockCancelRequest(requestId: string): void {
    const safeId = String(requestId ?? '').trim();

    if (safeId) {
      this.cancelingRequestIds.delete(safeId);
    }
  }

  /**
   * Envia solicitação de amizade.
   *
   * exhaustMap:
   * - evita spam de envio enquanto uma solicitação está em andamento;
   * - preserva comportamento mais seguro para ação social sensível.
   */
  sendFriendRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.sendFriendRequest),
      exhaustMap(({ requesterUid, targetUid, message }) =>
        this.svc.sendRequest(requesterUid, targetUid, message).pipe(
          map(() => A.sendFriendRequestSuccess()),
          catchError((err) => {
            const msg = String(
              err?.message ?? 'Falha ao enviar solicitação.'
            );

            this.notifier.showError(msg);

            return of(A.sendFriendRequestFailure({ error: msg }));
          })
        )
      )
    )
  );

  /**
   * Carrega solicitações enviadas pendentes.
   */
  loadOutboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadOutboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listOutboundRequests(uid).pipe(
          map((requests) =>
            A.loadOutboundRequestsSuccess({ requests })
          ),
          catchError((err) =>
            of(
              A.loadOutboundRequestsFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );


  /**
 * Cancela solicitação enviada.
 *
 * Agora o cancelamento passa por Cloud Function:
 * - somente quem enviou pode cancelar;
 * - somente solicitação pending pode ser cancelada;
 * - o documento é preservado como "canceled" para auditoria;
 * - a UI remove o item localmente no success e sincroniza em seguida.
 *
 * Este effect:
 * - bloqueia repetição por requestId;
 * - libera o lock em success ou failure;
 * - mostra erro via ErrorNotificationService.
 */
  cancelOutbound$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.cancelFriendRequest),

      /**
       * Se o mesmo requestId for disparado várias vezes,
       * apenas a primeira action passa.
       */
      filter(({ requestId }) => this.tryLockCancelRequest(requestId)),

      mergeMap(({ requestId }) =>
        this.svc.cancelOutboundRequest(requestId).pipe(
          map(() => A.cancelFriendRequestSuccess({ requestId })),

          catchError((err) => {
            const msg = String(
              err?.message ?? 'Não foi possível cancelar a solicitação.'
            );

            this.notifier.showError(msg);

            return of(
              A.cancelFriendRequestFailure({
                requestId,
                error: msg,
              })
            );
          }),

          finalize(() => {
            this.unlockCancelRequest(requestId);
          })
        )
      )
    )
  );

   /**
   * Carrega solicitações recebidas pendentes.
   */
  loadInboundRequests$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.loadInboundRequests),
      filter(({ uid }) => !!uid),
      switchMap(({ uid }) =>
        this.svc.listInboundRequests(uid).pipe(
          map((requests) =>
            A.loadInboundRequestsSuccess({ requests })
          ),
          catchError((err) =>
            of(
              A.loadInboundRequestsFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );

  /**
   * Aceita solicitação recebida.
   *
   * concatMap:
   * - preserva ordem;
   * - evita corrida entre múltiplas aceitações.
   */
  acceptRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.acceptFriendRequest),
      concatMap(({ requestId, requesterUid, targetUid }) =>
        this.svc.acceptRequest(requestId, requesterUid, targetUid).pipe(
          map(() => A.acceptFriendRequestSuccess({ requestId })),
          catchError((err) =>
            of(
              A.acceptFriendRequestFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );

  /**
   * Recusa solicitação recebida.
   */
  declineRequest$ = createEffect(() =>
    this.actions$.pipe(
      ofType(A.declineFriendRequest),
      concatMap(({ requestId }) =>
        this.svc.declineRequest(requestId).pipe(
          map(() => A.declineFriendRequestSuccess({ requestId })),
          catchError((err) =>
            of(
              A.declineFriendRequestFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );

  /**
 * Sincronização curta após mutações sociais de solicitação.
 *
 * Motivo:
 * - o realtime continua sendo a fonte principal;
 * - mas, após uma ação social sensível, a UI precisa reagir imediatamente;
 * - isso reduz atraso visual entre enviar, cancelar, aceitar e recusar;
 * - também mantém badges e abas coerentes sem depender apenas da ordem
 *   em que os snapshots realtime chegam.
 *
 * Atualiza sempre:
 * - RECEBIDAS;
 * - ENVIADAS.
 *
 * Atualiza também AMIGOS quando:
 * - uma solicitação é aceita.
 */
syncAfterRequestMutation$ = createEffect(() =>
  this.actions$.pipe(
    ofType(
      A.sendFriendRequestSuccess,
      A.cancelFriendRequestSuccess,
      A.acceptFriendRequestSuccess,
      A.declineFriendRequestSuccess
    ),
    withLatestFrom(this.store.select(selectCurrentUserUid)),
    filter(([, uid]) => !!uid),
    mergeMap(([action, uid]) => {
      const safeUid = uid!;

      const refreshRequests = [
        A.loadInboundRequests({ uid: safeUid }),
        A.loadOutboundRequests({ uid: safeUid }),
      ];

      if (action.type === A.acceptFriendRequestSuccess.type) {
        return of(
          ...refreshRequests,
          A.loadFriends({ uid: safeUid })
        );
      }

      return of(...refreshRequests);
    })
  )
);
} // Linha 232, fim do arquivo