// src/app/store/effects/effects.chat/invite.effects.ts
//
// Efeitos do inbox de convites.
//
// Objetivos desta revisão:
// - manter o stream realtime de convites somente enquanto a feature/sessão estiver ativa
// - cancelar explicitamente o listener no logout ou saída da tela
// - limpar cache do InviteInboxService no momento da parada
// - limpar o estado NgRx do inbox ao parar
// - preservar a lógica de aceitar/recusar convite sem ampliar o raio da mudança
//
// Ajustes principais:
// - remoção do uso de `any` na composição do stop
// - separação entre stop manual da feature e stop por fim de sessão
// - manutenção de `takeUntil(stopInvites$)` no stream realtime
//
// Observação:
// - este arquivo NÃO resolve sozinho o problema pós-logout;
//   ele depende também de:
//   1) InviteInboxService com Injection Context correto
//   2) reducer tratando StopInvites / ClearInvitesState
//   3) componente disparando StopInvites() no destroy
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as InviteActions from '../../actions/actions.chat/invite.actions';
import { authSessionChanged } from '../../actions/actions.user/auth.actions';

import {
  map,
  switchMap,
  catchError,
  mergeMap,
  filter,
  takeUntil,
  tap,
} from 'rxjs/operators';
import { merge, of } from 'rxjs';

import { InviteInboxService } from '@core/services/batepapo/invite-service/invite-inbox.service';
import { RoomInviteFlowService } from '@core/services/batepapo/room-services/room-invite-flow.service';

@Injectable()
export class InviteEffects {
  constructor(
    private readonly actions$: Actions,
    private readonly inbox: InviteInboxService,
    private readonly roomInviteFlow: RoomInviteFlowService
  ) {}

  /**
   * Stop manual da feature.
   *
   * Casos típicos:
   * - componente saiu da rota
   * - usuário fechou a tela
   * - fluxo decidiu encerrar o inbox explicitamente
   */
  private readonly stopInvitesManual$ = this.actions$.pipe(
    ofType(InviteActions.StopInvites)
  );

  /**
   * Stop por encerramento de sessão.
   *
   * Regra:
   * - quando uid -> null, qualquer listener realtime do inbox deve ser encerrado
   */
  private readonly stopInvitesOnSessionEnd$ = this.actions$.pipe(
    ofType(authSessionChanged),
    filter(({ uid }) => uid == null)
  );

  /**
   * Stream unificado de parada.
   *
   * Importante:
   * - faz a limpeza do cache no mesmo ponto em que o cancelamento é sinalizado
   * - isso evita reaproveitar stream antigo em sessão encerrada/trocada
   */
  private readonly stopInvites$ = merge(
    this.stopInvitesManual$,
    this.stopInvitesOnSessionEnd$
  ).pipe(
    tap(() => {
      this.inbox.clearAllCache();
    })
  );

  /**
   * Inbox realtime com cancelamento explícito.
   *
   * Regras:
   * - cada LoadInvites abre/reativa o stream do usuário atual
   * - se StopInvites ou authSessionChanged(uid:null) acontecer, o stream é cancelado
   * - o effect então para de observar invites imediatamente
   */
  loadInvites$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.LoadInvites),
      switchMap(({ userId }) =>
        this.inbox.observeMyPendingInvitesSafe(userId).pipe(
          takeUntil(this.stopInvites$),
          map((invites) => InviteActions.LoadInvitesSuccess({ invites })),
          catchError((err) =>
            of(
              InviteActions.LoadInvitesFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );

  /**
   * Limpa o estado visual/store quando a feature para.
   *
   * Isso evita:
   * - invites antigos persistidos na UI
   * - estado "fantasma" após logout
   * - reuso indevido de lista de outra sessão
   */
  clearInvitesOnStop$ = createEffect(() =>
    this.stopInvites$.pipe(
      map(() => InviteActions.ClearInvitesState())
    )
  );

  /**
   * Aceitar convite de sala via transação.
   *
   * Mantido intencionalmente sem refatoração extra nesta etapa,
   * porque o problema principal analisado está no ciclo de vida
   * do inbox realtime, não no fluxo de resposta.
   */
  acceptInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.AcceptInvite),
      mergeMap(({ inviteId }) =>
        this.roomInviteFlow.acceptRoomInvite$(inviteId).pipe(
          map(() => InviteActions.AcceptInviteSuccess({ inviteId })),
          catchError((err) =>
            of(
              InviteActions.AcceptInviteFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );

  /**
   * Recusar convite de sala via transação.
   *
   * Mantido intencionalmente sem ampliar o raio da mudança.
   */
  declineInvite$ = createEffect(() =>
    this.actions$.pipe(
      ofType(InviteActions.DeclineInvite),
      mergeMap(({ inviteId }) =>
        this.roomInviteFlow.declineRoomInvite$(inviteId).pipe(
          map(() => InviteActions.DeclineInviteSuccess({ inviteId })),
          catchError((err) =>
            of(
              InviteActions.DeclineInviteFailure({
                error: String(err?.message ?? err),
              })
            )
          )
        )
      )
    )
  );
} // Linha 177